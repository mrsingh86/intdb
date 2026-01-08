/**
 * Email Intelligence Service
 *
 * Extracts structured facts from individual emails using AI.
 * These facts become raw material for shipment-level intelligence rollups.
 *
 * Single Responsibility: Extract and store intelligence facts for ONE email.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { AIAnalysisExtractor, AIAnalysisResult, quickSentimentAnalysis } from '../extraction/ai-analysis-extractor';

// ============================================================================
// Types
// ============================================================================

export type Sentiment = 'positive' | 'negative' | 'neutral' | 'urgent' | 'concerned';
export type Urgency = 'critical' | 'high' | 'medium' | 'low';
export type EventType =
  | 'booking_confirmed' | 'booking_amended' | 'si_submitted' | 'si_amendment'
  | 'draft_bl_issued' | 'bl_released' | 'arrival_notice' | 'invoice_received'
  | 'deadline_reminder' | 'issue_reported' | 'status_update' | 'general_communication' | 'unknown';

export interface EmailIntelligence {
  email_id: string;
  shipment_id: string | null;
  primary_booking_number: string | null;  // From email/doc extractions
  sentiment: Sentiment;
  sentiment_confidence: number;
  urgency: Urgency;
  urgency_confidence: number;
  urgency_triggers: string[];
  has_action: boolean;
  action_summary: string | null;
  action_owner: 'sender' | 'recipient' | 'unknown' | null;
  action_deadline: string | null;
  action_priority: 'high' | 'medium' | 'low' | null;
  event_type: EventType;
  event_description: string | null;
  one_line_summary: string | null;
  key_dates: Record<string, string>;
  issues: string[];
  key_facts: Record<string, unknown>;
  processing_time_ms: number;
  extraction_method: 'ai' | 'quick';
  model_used: string | null;
}

// Extracted entities from email_extractions and document_extractions
export interface ExtractedEntities {
  booking_number: string | null;
  bl_number: string | null;
  container_numbers: string[];
  vessel_name: string | null;
  voyage_number: string | null;
  etd: string | null;
  eta: string | null;
  pol: string | null;
  pod: string | null;
  shipper: string | null;
  consignee: string | null;
}

export interface ExtractionOptions {
  useQuickAnalysis?: boolean;  // Use keyword matching instead of AI
  forceReprocess?: boolean;    // Reprocess even if already exists
}

// ============================================================================
// Service
// ============================================================================

export class EmailIntelligenceService {
  private supabase: SupabaseClient;
  private aiExtractor: AIAnalysisExtractor;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.aiExtractor = new AIAnalysisExtractor();
  }

  /**
   * Extract intelligence from a single email.
   */
  async extractIntelligence(
    emailId: string,
    options: ExtractionOptions = {}
  ): Promise<EmailIntelligence | null> {
    // Check if already processed
    if (!options.forceReprocess) {
      const { data: existing } = await this.supabase
        .from('email_intelligence')
        .select('id')
        .eq('email_id', emailId)
        .single();

      if (existing) {
        return null; // Already processed
      }
    }

    // Fetch email data
    const email = await this.fetchEmailData(emailId);
    if (!email) {
      console.error(`[EmailIntelligence] Email not found: ${emailId}`);
      return null;
    }

    // Extract intelligence
    const intelligence = options.useQuickAnalysis
      ? await this.extractQuick(email)
      : await this.extractWithAI(email);

    // Get linked shipment if any
    const shipmentId = await this.getLinkedShipment(emailId);
    intelligence.shipment_id = shipmentId;

    // Store in database
    await this.storeIntelligence(intelligence);

    return intelligence;
  }

  /**
   * Extract using AI (Claude Haiku).
   */
  private async extractWithAI(email: EmailData): Promise<EmailIntelligence> {
    const result = await this.aiExtractor.analyze({
      subject: email.subject,
      bodyText: email.body_text,
      senderEmail: email.sender_email,
      senderCategory: email.sender_category || undefined,
      documentType: email.document_type || undefined,
      // Pass extracted entities for context-aware analysis
      entities: email.entities,
    });

    return this.mapAIResultToIntelligence(email.id, result, email);
  }

  /**
   * Extract using quick keyword analysis (no AI cost).
   */
  private async extractQuick(email: EmailData): Promise<EmailIntelligence> {
    const quick = quickSentimentAnalysis(email.subject, email.body_text);

    // Build key dates from entities
    const keyDates: Record<string, string> = {};
    if (email.entities.etd) keyDates['etd'] = email.entities.etd;
    if (email.entities.eta) keyDates['eta'] = email.entities.eta;

    return {
      email_id: email.id,
      shipment_id: null,
      primary_booking_number: email.entities.booking_number,
      sentiment: quick.sentiment,
      sentiment_confidence: quick.confidence,
      urgency: quick.urgency,
      urgency_confidence: quick.confidence,
      urgency_triggers: [],
      has_action: false,
      action_summary: null,
      action_owner: null,
      action_deadline: null,
      action_priority: null,
      event_type: this.mapDocTypeToEventType(email.document_type),
      event_description: null,
      one_line_summary: email.subject.substring(0, 200),
      key_dates: keyDates,
      issues: [],
      key_facts: {
        entities: {
          booking_number: email.entities.booking_number,
          bl_number: email.entities.bl_number,
          container_numbers: email.entities.container_numbers,
        },
      },
      processing_time_ms: 0,
      extraction_method: 'quick',
      model_used: null,
    };
  }

  /**
   * Map AI analysis result to EmailIntelligence structure.
   */
  private mapAIResultToIntelligence(
    emailId: string,
    result: AIAnalysisResult,
    email: EmailData
  ): EmailIntelligence {
    const primaryAction = result.actionItems.items[0];

    // Merge extracted dates with any AI-detected dates
    const keyDates = this.extractKeyDates(result);
    if (email.entities.etd) keyDates['etd'] = email.entities.etd;
    if (email.entities.eta) keyDates['eta'] = email.entities.eta;

    return {
      email_id: emailId,
      shipment_id: null,
      primary_booking_number: email.entities.booking_number,
      sentiment: result.sentiment.value,
      sentiment_confidence: result.sentiment.confidence,
      urgency: result.urgencyLevel.value,
      urgency_confidence: result.urgencyLevel.confidence,
      urgency_triggers: result.urgencyLevel.triggers,
      has_action: result.actionItems.items.length > 0,
      action_summary: primaryAction?.action || null,
      action_owner: primaryAction?.owner || null,
      action_deadline: primaryAction?.deadline || null,
      action_priority: primaryAction?.priority || null,
      event_type: this.mapDocTypeToEventType(email.document_type),
      event_description: result.conversationSummary.context || null,
      one_line_summary: result.conversationSummary.summary || null,
      key_dates: keyDates,
      issues: this.extractIssues(result),
      key_facts: {
        key_points: result.conversationSummary.keyPoints,
        all_actions: result.actionItems.items,
        has_deadline: result.actionItems.hasDeadline,
        // Include extracted entities for reference
        entities: {
          booking_number: email.entities.booking_number,
          bl_number: email.entities.bl_number,
          container_numbers: email.entities.container_numbers,
          vessel: email.entities.vessel_name,
          route: email.entities.pol && email.entities.pod
            ? `${email.entities.pol} → ${email.entities.pod}`
            : null,
        },
      },
      processing_time_ms: result.processingTimeMs,
      extraction_method: 'ai',
      model_used: 'claude-3-5-haiku-20241022',
    };
  }

  /**
   * Map document type to event type.
   */
  private mapDocTypeToEventType(docType: string | null): EventType {
    const mapping: Record<string, EventType> = {
      'booking_confirmation': 'booking_confirmed',
      'booking_amendment': 'booking_amended',
      'shipping_instructions': 'si_submitted',
      'si_confirmation': 'si_submitted',
      'draft_bl': 'draft_bl_issued',
      'bill_of_lading': 'bl_released',
      'arrival_notice': 'arrival_notice',
      'invoice': 'invoice_received',
      'freight_invoice': 'invoice_received',
    };

    return mapping[docType || ''] || 'unknown';
  }

  /**
   * Extract key dates from AI result.
   */
  private extractKeyDates(result: AIAnalysisResult): Record<string, string> {
    const dates: Record<string, string> = {};

    // Extract deadline from action items
    for (const action of result.actionItems.items) {
      if (action.deadline) {
        dates['action_deadline'] = action.deadline;
        break;
      }
    }

    return dates;
  }

  /**
   * Extract issues from AI result.
   */
  private extractIssues(result: AIAnalysisResult): string[] {
    const issues: string[] = [];

    // Check for negative/concerned sentiment
    if (result.sentiment.value === 'negative' || result.sentiment.value === 'concerned') {
      if (result.sentiment.reasoning) {
        issues.push(result.sentiment.reasoning);
      }
    }

    // Check urgency triggers for issue keywords
    const issueKeywords = ['delay', 'missing', 'error', 'problem', 'issue', 'failed'];
    for (const trigger of result.urgencyLevel.triggers) {
      if (issueKeywords.some(kw => trigger.toLowerCase().includes(kw))) {
        issues.push(trigger);
      }
    }

    return issues;
  }

  /**
   * Fetch email data from database.
   */
  private async fetchEmailData(emailId: string): Promise<EmailData | null> {
    const { data: email, error } = await this.supabase
      .from('raw_emails')
      .select(`
        id,
        subject,
        body_text,
        sender_email
      `)
      .eq('id', emailId)
      .single();

    if (error || !email) {
      console.error(`[EmailIntelligence] Fetch error for ${emailId}:`, error?.message);
      return null;
    }

    // Get document classification (includes sender_category)
    const { data: classification } = await this.supabase
      .from('document_classifications')
      .select('document_type, sender_category')
      .eq('email_id', emailId)
      .single();

    // Get extracted entities from both tables
    const entities = await this.fetchExtractedEntities(emailId);

    return {
      id: email.id,
      subject: email.subject || '',
      body_text: email.body_text || '',
      sender_email: email.sender_email || '',
      sender_category: classification?.sender_category || null,
      document_type: classification?.document_type || null,
      entities,
    };
  }

  /**
   * Fetch extracted entities from email_extractions and document_extractions.
   */
  private async fetchExtractedEntities(emailId: string): Promise<ExtractedEntities> {
    const entities: ExtractedEntities = {
      booking_number: null,
      bl_number: null,
      container_numbers: [],
      vessel_name: null,
      voyage_number: null,
      etd: null,
      eta: null,
      pol: null,
      pod: null,
      shipper: null,
      consignee: null,
    };

    // Fetch from email_extractions
    const { data: emailExtractions } = await this.supabase
      .from('email_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', emailId);

    // Fetch from document_extractions
    const { data: docExtractions } = await this.supabase
      .from('document_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', emailId);

    // Combine and deduplicate
    const allExtractions = [...(emailExtractions || []), ...(docExtractions || [])];

    for (const extraction of allExtractions) {
      const { entity_type, entity_value } = extraction;
      if (!entity_value) continue;

      switch (entity_type) {
        case 'booking_number':
          if (!entities.booking_number) entities.booking_number = entity_value;
          break;
        case 'bl_number':
        case 'mbl_number':
        case 'hbl_number':
          if (!entities.bl_number) entities.bl_number = entity_value;
          break;
        case 'container_number':
          if (!entities.container_numbers.includes(entity_value)) {
            entities.container_numbers.push(entity_value);
          }
          break;
        case 'vessel_name':
          if (!entities.vessel_name) entities.vessel_name = entity_value;
          break;
        case 'voyage_number':
          if (!entities.voyage_number) entities.voyage_number = entity_value;
          break;
        case 'etd':
          if (!entities.etd) entities.etd = entity_value;
          break;
        case 'eta':
          if (!entities.eta) entities.eta = entity_value;
          break;
        case 'pol':
        case 'port_of_loading':
          if (!entities.pol) entities.pol = entity_value;
          break;
        case 'pod':
        case 'port_of_discharge':
          if (!entities.pod) entities.pod = entity_value;
          break;
        case 'shipper':
        case 'shipper_name':
          if (!entities.shipper) entities.shipper = entity_value;
          break;
        case 'consignee':
        case 'consignee_name':
          if (!entities.consignee) entities.consignee = entity_value;
          break;
      }
    }

    return entities;
  }

  /**
   * Get linked shipment ID for email.
   */
  private async getLinkedShipment(emailId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', emailId)
      .single();

    return data?.shipment_id || null;
  }

  /**
   * Validate and sanitize date string.
   * Returns null if invalid date format.
   */
  private sanitizeDate(dateStr: string | null): string | null {
    if (!dateStr) return null;

    // Check if it's a valid ISO date or common format
    const isoPattern = /^\d{4}-\d{2}-\d{2}/;
    const commonPattern = /^\d{1,2}\/\d{1,2}\/\d{2,4}/;
    const monthDayPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i;

    if (isoPattern.test(dateStr)) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return dateStr.substring(0, 10); // Return YYYY-MM-DD
      }
    }

    if (commonPattern.test(dateStr) || monthDayPattern.test(dateStr)) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().substring(0, 10);
      }
    }

    // Invalid format (e.g., "Thursday", "Current date")
    return null;
  }

  /**
   * Store intelligence in database.
   */
  private async storeIntelligence(intelligence: EmailIntelligence): Promise<void> {
    const { error } = await this.supabase
      .from('email_intelligence')
      .upsert({
        email_id: intelligence.email_id,
        shipment_id: intelligence.shipment_id,
        primary_booking_number: intelligence.primary_booking_number,
        sentiment: intelligence.sentiment,
        sentiment_confidence: intelligence.sentiment_confidence,
        urgency: intelligence.urgency,
        urgency_confidence: intelligence.urgency_confidence,
        urgency_triggers: intelligence.urgency_triggers,
        has_action: intelligence.has_action,
        action_summary: intelligence.action_summary,
        action_owner: intelligence.action_owner,
        action_deadline: this.sanitizeDate(intelligence.action_deadline),
        action_priority: intelligence.action_priority,
        event_type: intelligence.event_type,
        event_description: intelligence.event_description,
        one_line_summary: intelligence.one_line_summary,
        key_dates: intelligence.key_dates,
        issues: intelligence.issues,
        key_facts: intelligence.key_facts,
        processing_time_ms: intelligence.processing_time_ms,
        extraction_method: intelligence.extraction_method,
        model_used: intelligence.model_used,
      }, {
        onConflict: 'email_id',
      });

    if (error) {
      console.error('[EmailIntelligence] Store error:', error);
      throw error;
    }
  }

  /**
   * Batch extract intelligence for multiple emails.
   */
  async extractBatch(
    emailIds: string[],
    options: ExtractionOptions = {}
  ): Promise<{ processed: number; skipped: number; errors: number }> {
    const stats = { processed: 0, skipped: 0, errors: 0 };

    for (const emailId of emailIds) {
      try {
        const result = await this.extractIntelligence(emailId, options);
        if (result) {
          stats.processed++;
        } else {
          stats.skipped++;
        }
      } catch (error) {
        console.error(`[EmailIntelligence] Error for ${emailId}:`, error);
        stats.errors++;
      }
    }

    return stats;
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface EmailData {
  id: string;
  subject: string;
  body_text: string;
  sender_email: string;
  sender_category: string | null;
  document_type: string | null;
  entities: ExtractedEntities;  // From email_extractions + document_extractions
}

// ============================================================================
// Factory
// ============================================================================

export function createEmailIntelligenceService(
  supabase: SupabaseClient
): EmailIntelligenceService {
  return new EmailIntelligenceService(supabase);
}
