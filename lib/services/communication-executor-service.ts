/**
 * Communication Executor Service
 *
 * Handles email drafting and sending for task communications.
 * Supports AI-assisted drafting with templates.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { TaskRepository } from '@/lib/repositories/task-repository';
import {
  CommunicationLog,
  CommunicationStatus,
  ActionTask,
  TaskTemplate,
} from '@/types/intelligence-platform';

// ============================================================================
// INTERFACES
// ============================================================================

export interface EmailDraftRequest {
  taskId: string;
  templateCode?: string;
  toEmails: string[];
  ccEmails?: string[];
  subject?: string;
  customPrompt?: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  toEmails: string[];
  ccEmails: string[];
  aiDrafted: boolean;
  templateUsed?: string;
}

export interface SendEmailRequest {
  taskId?: string;
  shipmentId?: string;
  notificationId?: string;
  toEmails: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  aiDrafted: boolean;
  aiDraftPrompt?: string;
  sentBy?: string;
  sentByName?: string;
}

export interface SendEmailResult {
  success: boolean;
  communicationId: string;
  error?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class CommunicationExecutorService {
  private repository: TaskRepository;

  constructor(private supabase: SupabaseClient) {
    this.repository = new TaskRepository(supabase);
  }

  // --------------------------------------------------------------------------
  // DRAFT GENERATION
  // --------------------------------------------------------------------------

  async generateDraft(request: EmailDraftRequest): Promise<EmailDraft> {
    const task = await this.repository.findById(request.taskId);
    if (!task) {
      throw new Error(`Task not found: ${request.taskId}`);
    }

    // Get template if specified
    let template: TaskTemplate | null = null;
    if (request.templateCode) {
      template = await this.repository.getTemplateByCode(request.templateCode);
    } else if (task.template_code) {
      template = await this.repository.getTemplateByCode(task.template_code);
    }

    // Build context for template interpolation
    const context = await this.buildEmailContext(task);

    // Generate subject
    let subject = request.subject;
    if (!subject && template?.email_subject_template) {
      subject = this.interpolateTemplate(template.email_subject_template, context);
    }
    if (!subject) {
      subject = this.generateDefaultSubject(task, context);
    }

    // Generate body
    let body: string;
    if (template?.email_body_template) {
      body = this.interpolateTemplate(template.email_body_template, context);
    } else {
      body = this.generateDefaultBody(task, context, request.customPrompt);
    }

    return {
      subject,
      body,
      toEmails: request.toEmails,
      ccEmails: request.ccEmails || [],
      aiDrafted: true,
      templateUsed: template?.template_code,
    };
  }

  // --------------------------------------------------------------------------
  // EMAIL SENDING
  // --------------------------------------------------------------------------

  async sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
    // Create communication log entry
    const communication = await this.repository.createCommunication({
      task_id: request.taskId,
      shipment_id: request.shipmentId,
      notification_id: request.notificationId,
      communication_type: 'email',
      to_emails: request.toEmails,
      cc_emails: request.ccEmails,
      bcc_emails: request.bccEmails,
      subject: request.subject,
      body_text: request.bodyText,
      body_html: request.bodyHtml,
      ai_drafted: request.aiDrafted,
      ai_draft_prompt: request.aiDraftPrompt,
      human_edited: !request.aiDrafted,
      status: 'queued',
      sent_by: request.sentBy,
      sent_by_name: request.sentByName,
      response_received: false,
    });

    try {
      // In production, this would integrate with Gmail API
      // For now, we'll mark as sent (actual Gmail integration would go here)
      const gmailResult = await this.sendViaGmail(request);

      // Update communication status
      await this.repository.updateCommunicationStatus(
        communication.id,
        'sent',
        gmailResult.messageId ? `Gmail ID: ${gmailResult.messageId}` : undefined
      );

      // Update task status if linked
      if (request.taskId) {
        const task = await this.repository.findById(request.taskId);
        if (task && task.status === 'pending') {
          await this.repository.updateStatus(request.taskId, 'in_progress');
        }
      }

      return {
        success: true,
        communicationId: communication.id,
      };
    } catch (error) {
      // Update communication status to failed
      await this.repository.updateCommunicationStatus(
        communication.id,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );

      return {
        success: false,
        communicationId: communication.id,
        error: error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }

  async markResponseReceived(
    communicationId: string,
    responseEmailId: string
  ): Promise<CommunicationLog> {
    const { data, error } = await this.supabase
      .from('communication_log')
      .update({
        response_received: true,
        response_email_id: responseEmailId,
        response_received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', communicationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to mark response: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // COMMUNICATION HISTORY
  // --------------------------------------------------------------------------

  async getTaskCommunications(taskId: string): Promise<CommunicationLog[]> {
    return this.repository.getCommunications(taskId);
  }

  async getShipmentCommunications(shipmentId: string): Promise<CommunicationLog[]> {
    const { data, error } = await this.supabase
      .from('communication_log')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch communications: ${error.message}`);
    }

    return data || [];
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private async buildEmailContext(task: ActionTask): Promise<Record<string, string>> {
    const context: Record<string, string> = {
      task_title: task.title,
      task_description: task.description || '',
      task_priority: task.priority,
      task_due_date: task.due_date ? new Date(task.due_date).toLocaleDateString() : 'Not set',
    };

    // Fetch shipment details
    if (task.shipment_id) {
      const { data: shipment } = await this.supabase
        .from('shipments')
        .select(`
          booking_number,
          vessel_name,
          voyage_number,
          etd,
          eta,
          origin_port,
          destination_port,
          container_count,
          carrier:carriers(carrier_name)
        `)
        .eq('id', task.shipment_id)
        .single();

      if (shipment) {
        context.booking_number = shipment.booking_number || '';
        context.vessel_name = shipment.vessel_name || '';
        context.voyage_number = shipment.voyage_number || '';
        context.etd = shipment.etd ? new Date(shipment.etd).toLocaleDateString() : '';
        context.eta = shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '';
        context.origin_port = shipment.origin_port || '';
        context.destination_port = shipment.destination_port || '';
        context.container_count = String(shipment.container_count || '');
        context.carrier_name = (shipment.carrier as { carrier_name?: string })?.carrier_name || '';
      }
    }

    // Fetch notification details
    if (task.notification_id) {
      const { data: notification } = await this.supabase
        .from('notifications')
        .select('title, summary, notification_type')
        .eq('id', task.notification_id)
        .single();

      if (notification) {
        context.notification_title = notification.title || '';
        context.notification_summary = notification.summary || '';
        context.notification_type = notification.notification_type?.replace(/_/g, ' ') || '';
      }
    }

    // Fetch stakeholder details
    if (task.stakeholder_id) {
      const { data: stakeholder } = await this.supabase
        .from('parties')
        .select('party_name, contact_email')
        .eq('id', task.stakeholder_id)
        .single();

      if (stakeholder) {
        context.stakeholder_name = stakeholder.party_name || '';
        context.stakeholder_email = stakeholder.contact_email || '';
      }
    }

    // Add sender info
    context.sender_name = 'Intoglo Team';
    context.sender_company = 'Intoglo Pvt Ltd';
    context.current_date = new Date().toLocaleDateString();

    return context;
  }

  private interpolateTemplate(template: string, context: Record<string, string>): string {
    let result = template;

    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`{${key}}`, 'g');
      result = result.replace(regex, value || '');
    }

    // Clean up any remaining placeholders
    result = result.replace(/{[^}]+}/g, '');

    return result.trim();
  }

  private generateDefaultSubject(task: ActionTask, context: Record<string, string>): string {
    const booking = context.booking_number ? ` - ${context.booking_number}` : '';

    const subjectPrefixes: Record<string, string> = {
      deadline: 'Action Required',
      notification: 'Important Update',
      document: 'Document Request',
      compliance: 'Compliance Notice',
      communication: 'Follow Up',
      financial: 'Financial Notice',
      operational: 'Operational Update',
    };

    const prefix = subjectPrefixes[task.category] || 'Task';

    return `${prefix}: ${task.title}${booking}`;
  }

  private generateDefaultBody(
    task: ActionTask,
    context: Record<string, string>,
    customPrompt?: string
  ): string {
    const lines: string[] = [];

    // Greeting
    lines.push('Dear Team,');
    lines.push('');

    // Main content based on task type
    if (customPrompt) {
      lines.push(customPrompt);
    } else {
      lines.push(`This is regarding: **${task.title}**`);
      lines.push('');

      if (task.description) {
        lines.push(task.description);
        lines.push('');
      }

      // Add context details
      if (context.booking_number) {
        lines.push(`**Booking Number**: ${context.booking_number}`);
      }
      if (context.vessel_name) {
        lines.push(`**Vessel**: ${context.vessel_name}`);
      }
      if (context.etd) {
        lines.push(`**ETD**: ${context.etd}`);
      }
      if (context.origin_port && context.destination_port) {
        lines.push(`**Route**: ${context.origin_port} → ${context.destination_port}`);
      }

      lines.push('');

      // Add deadline info if present
      if (task.due_date) {
        const dueDate = new Date(task.due_date);
        lines.push(`**Deadline**: ${dueDate.toLocaleString()}`);
        lines.push('');
      }

      // Call to action
      lines.push('Please take the necessary action at your earliest convenience.');
    }

    lines.push('');
    lines.push('Best regards,');
    lines.push(context.sender_name);
    lines.push(context.sender_company);

    return lines.join('\n');
  }

  private async sendViaGmail(request: SendEmailRequest): Promise<{ messageId?: string }> {
    // TODO: Integrate with Gmail API
    // This would use the Gmail client to actually send the email
    // For now, we'll simulate success

    console.log('[CommunicationExecutorService] Sending email:', {
      to: request.toEmails,
      subject: request.subject,
    });

    // In production:
    // const gmail = await getGmailClient();
    // const result = await gmail.users.messages.send({...});
    // return { messageId: result.data.id };

    return { messageId: `sim_${Date.now()}` };
  }
}
