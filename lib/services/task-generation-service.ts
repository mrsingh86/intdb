/**
 * Task Generation Service
 *
 * Generates tasks from various triggers:
 * - Deadline approaching (SI cutoff, VGM cutoff, etc.)
 * - Notification received (rollover, customs hold, etc.)
 * - Document received/missing
 * - Milestone reached/missed
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { TaskRepository } from '@/lib/repositories/task-repository';
import { TaskPriorityService } from '@/lib/services/task-priority-service';
import {
  ActionTask,
  TaskTemplate,
  Notification,
  TaskCategory,
  TaskTriggerType,
  NotificationPriority,
} from '@/types/intelligence-platform';

// ============================================================================
// INTERFACES
// ============================================================================

export interface TaskGenerationContext {
  shipmentId?: string;
  notificationId?: string;
  documentId?: string;
  stakeholderId?: string;
  bookingNumber?: string;
  vesselName?: string;
  carrierName?: string;
  deadlineDate?: string;
  additionalData?: Record<string, unknown>;
}

export interface TaskGenerationResult {
  generated: boolean;
  task?: ActionTask;
  reason: string;
  existingTaskId?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class TaskGenerationService {
  private repository: TaskRepository;
  private priorityService: TaskPriorityService;
  private templateCache: Map<string, TaskTemplate> = new Map();

  constructor(private supabase: SupabaseClient) {
    this.repository = new TaskRepository(supabase);
    this.priorityService = new TaskPriorityService(supabase);
  }

  // --------------------------------------------------------------------------
  // MAIN GENERATION METHODS
  // --------------------------------------------------------------------------

  async generateFromNotification(
    notification: Notification,
    context: TaskGenerationContext = {}
  ): Promise<TaskGenerationResult> {
    // Check if notification type should auto-generate task
    const { data: typeConfig } = await this.supabase
      .from('notification_type_configs')
      .select('auto_generate_task, task_template_code')
      .eq('notification_type', notification.notification_type)
      .single();

    if (!typeConfig?.auto_generate_task) {
      return {
        generated: false,
        reason: 'Notification type does not auto-generate tasks',
      };
    }

    // Determine template code
    const templateCode = typeConfig.task_template_code ||
      this.getDefaultTemplateForNotification(notification.notification_type || '');

    if (!templateCode) {
      return {
        generated: false,
        reason: 'No template found for notification type',
      };
    }

    // Check for existing task
    const existingTask = await this.repository.findExistingTask(
      templateCode,
      notification.shipment_id || undefined,
      notification.id
    );

    if (existingTask) {
      return {
        generated: false,
        reason: 'Task already exists for this notification',
        existingTaskId: existingTask.id,
      };
    }

    // Generate task
    const task = await this.createTaskFromTemplate(
      templateCode,
      'notification_received',
      {
        ...context,
        notificationId: notification.id,
        shipmentId: notification.shipment_id || context.shipmentId,
        deadlineDate: notification.deadline_date || undefined,
      },
      notification.priority
    );

    return {
      generated: true,
      task,
      reason: 'Task generated from notification',
    };
  }

  async generateFromDeadline(
    shipmentId: string,
    deadlineType: 'si_cutoff' | 'vgm_cutoff' | 'cargo_cutoff' | 'documentation',
    deadlineDate: string,
    context: TaskGenerationContext = {}
  ): Promise<TaskGenerationResult> {
    const templateCode = `submit_${deadlineType.replace('_cutoff', '')}`;

    // Check for existing task
    const existingTask = await this.repository.findExistingTask(
      templateCode,
      shipmentId
    );

    if (existingTask) {
      return {
        generated: false,
        reason: 'Task already exists for this deadline',
        existingTaskId: existingTask.id,
      };
    }

    // Check if deadline is in the past
    const deadline = new Date(deadlineDate);
    if (deadline < new Date()) {
      return {
        generated: false,
        reason: 'Deadline has already passed',
      };
    }

    // Generate task
    const task = await this.createTaskFromTemplate(
      templateCode,
      'deadline_approaching',
      {
        ...context,
        shipmentId,
        deadlineDate,
      }
    );

    return {
      generated: true,
      task,
      reason: 'Task generated for approaching deadline',
    };
  }

  async generateFromDocument(
    shipmentId: string,
    documentType: string,
    eventType: 'received' | 'missing',
    context: TaskGenerationContext = {}
  ): Promise<TaskGenerationResult> {
    const templateCode = eventType === 'received'
      ? `review_${documentType}`
      : `request_${documentType}`;

    // Check for existing task
    const existingTask = await this.repository.findExistingTask(
      templateCode,
      shipmentId
    );

    if (existingTask) {
      return {
        generated: false,
        reason: 'Task already exists for this document',
        existingTaskId: existingTask.id,
      };
    }

    // Generate task
    const task = await this.createTaskFromTemplate(
      templateCode,
      eventType === 'received' ? 'document_received' : 'document_missing',
      {
        ...context,
        shipmentId,
        documentId: context.documentId,
      }
    );

    return {
      generated: true,
      task,
      reason: `Task generated for ${eventType} document`,
    };
  }

  async generateManualTask(
    title: string,
    description: string,
    category: TaskCategory,
    context: TaskGenerationContext = {},
    options: {
      priority?: NotificationPriority;
      dueDate?: string;
      assignTo?: string;
      assignToName?: string;
    } = {}
  ): Promise<TaskGenerationResult> {
    // Calculate priority
    const { priority, score, factors } = await this.priorityService.calculatePriority({
      basePriority: options.priority || 'medium',
      dueDate: options.dueDate,
      shipmentId: context.shipmentId,
      stakeholderId: context.stakeholderId,
    });

    const task = await this.repository.create({
      template_code: 'manual',
      shipment_id: context.shipmentId,
      notification_id: context.notificationId,
      stakeholder_id: context.stakeholderId,
      title,
      description,
      category,
      priority,
      priority_score: score,
      priority_factors: factors,
      due_date: options.dueDate,
      assigned_to: options.assignTo,
      assigned_to_name: options.assignToName,
      assigned_at: options.assignTo ? new Date().toISOString() : undefined,
      status: options.assignTo ? 'in_progress' : 'pending',
      is_recurring: false,
    });

    return {
      generated: true,
      task,
      reason: 'Manual task created',
    };
  }

  // --------------------------------------------------------------------------
  // BATCH GENERATION
  // --------------------------------------------------------------------------

  async generateDeadlineTasks(): Promise<{
    generated: number;
    skipped: number;
    errors: string[];
  }> {
    let generated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Get shipments with approaching deadlines
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const { data: shipments, error } = await this.supabase
      .from('shipments')
      .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff')
      .or(`si_cutoff.gte.${now.toISOString()},vgm_cutoff.gte.${now.toISOString()},cargo_cutoff.gte.${now.toISOString()}`)
      .or(`si_cutoff.lte.${threeDaysFromNow.toISOString()},vgm_cutoff.lte.${threeDaysFromNow.toISOString()},cargo_cutoff.lte.${threeDaysFromNow.toISOString()}`);

    if (error) {
      errors.push(`Failed to fetch shipments: ${error.message}`);
      return { generated, skipped, errors };
    }

    for (const shipment of shipments || []) {
      const deadlines = [
        { type: 'si_cutoff' as const, date: shipment.si_cutoff },
        { type: 'vgm_cutoff' as const, date: shipment.vgm_cutoff },
        { type: 'cargo_cutoff' as const, date: shipment.cargo_cutoff },
      ];

      for (const deadline of deadlines) {
        if (!deadline.date) continue;

        const deadlineDate = new Date(deadline.date);
        if (deadlineDate < now || deadlineDate > threeDaysFromNow) continue;

        try {
          const result = await this.generateFromDeadline(
            shipment.id,
            deadline.type,
            deadline.date,
            { bookingNumber: shipment.booking_number }
          );

          if (result.generated) {
            generated++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors.push(`Shipment ${shipment.id} ${deadline.type}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    return { generated, skipped, errors };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private async createTaskFromTemplate(
    templateCode: string,
    triggerType: TaskTriggerType,
    context: TaskGenerationContext,
    overridePriority?: NotificationPriority
  ): Promise<ActionTask> {
    // Get or create template
    let template = this.templateCache.get(templateCode);
    if (!template) {
      template = await this.repository.getTemplateByCode(templateCode) || undefined;
      if (template) {
        this.templateCache.set(templateCode, template);
      }
    }

    // Build title from template or generate default
    const title = template
      ? this.interpolateTemplate(template.default_title_template, context)
      : this.generateDefaultTitle(templateCode, context);

    const description = template?.default_description_template
      ? this.interpolateTemplate(template.default_description_template, context)
      : undefined;

    const category = template?.template_category || this.inferCategory(templateCode);

    // Calculate priority
    const basePriority = overridePriority || template?.base_priority || 'medium';
    const { priority, score, factors } = await this.priorityService.calculatePriority({
      basePriority,
      dueDate: context.deadlineDate,
      shipmentId: context.shipmentId,
      notificationId: context.notificationId,
      stakeholderId: context.stakeholderId,
    });

    // Create task
    return this.repository.create({
      template_id: template?.id,
      template_code: templateCode,
      shipment_id: context.shipmentId,
      notification_id: context.notificationId,
      document_lifecycle_id: context.documentId,
      stakeholder_id: context.stakeholderId,
      title,
      description,
      category,
      priority,
      priority_score: score,
      priority_factors: factors,
      due_date: context.deadlineDate,
      status: 'pending',
      is_recurring: false,
    });
  }

  private interpolateTemplate(template: string, context: TaskGenerationContext): string {
    return template
      .replace(/{booking_number}/g, context.bookingNumber || 'N/A')
      .replace(/{vessel_name}/g, context.vesselName || 'N/A')
      .replace(/{carrier_name}/g, context.carrierName || 'N/A')
      .replace(/{deadline_date}/g, context.deadlineDate ? new Date(context.deadlineDate).toLocaleDateString() : 'N/A');
  }

  private generateDefaultTitle(templateCode: string, context: TaskGenerationContext): string {
    const booking = context.bookingNumber ? `: ${context.bookingNumber}` : '';

    const titles: Record<string, string> = {
      submit_si: `Submit SI${booking}`,
      submit_vgm: `Submit VGM${booking}`,
      submit_cargo: `Submit Cargo Details${booking}`,
      respond_rollover: `Respond to Rollover${booking}`,
      address_customs_hold: `Address Customs Hold${booking}`,
      review_si_draft: `Review SI Draft${booking}`,
      share_arrival_notice: `Share Arrival Notice${booking}`,
      follow_up_pod: `Follow Up POD${booking}`,
      manual: 'Manual Task',
    };

    return titles[templateCode] || `Task${booking}`;
  }

  private inferCategory(templateCode: string): TaskCategory {
    if (templateCode.includes('si') || templateCode.includes('vgm') || templateCode.includes('documentation')) {
      return 'deadline';
    }
    if (templateCode.includes('review') || templateCode.includes('share')) {
      return 'document';
    }
    if (templateCode.includes('respond') || templateCode.includes('address')) {
      return 'notification';
    }
    if (templateCode.includes('customs')) {
      return 'compliance';
    }
    return 'operational';
  }

  private getDefaultTemplateForNotification(notificationType: string): string | null {
    const mapping: Record<string, string> = {
      // Notification response tasks
      rollover: 'respond_rollover',
      customs_hold: 'respond_customs_hold',
      customs_hold_escalation: 'escalate_customs_hold',
      vessel_delay: 'notify_delay',
      arrival_notice: 'share_arrival_notice',
      detention_alert: 'address_detention',
      demurrage_warning: 'prevent_demurrage',

      // Deadline tasks (cutoffs)
      si_cutoff: 'submit_si',
      vgm_cutoff: 'submit_vgm',
      cargo_cutoff: 'submit_cargo',

      // Document tasks
      document_missing: 'request_missing_docs',
      invoice_received: 'review_invoice',
      si_draft_received: 'review_si_draft',

      // Operational tasks
      delivery_confirmation: 'confirm_delivery',
      transport_required: 'arrange_transport',
      customs_clearance: 'obtain_customs_clearance',

      // Communication tasks
      payment_reminder: 'send_payment_reminder',
      shipper_follow_up: 'follow_up_shipper',
      pod_required: 'follow_up_pod',
    };

    return mapping[notificationType] || null;
  }
}
