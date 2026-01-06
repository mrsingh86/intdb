/**
 * AI Classification Service
 *
 * Fallback classification using LLM when pattern matching has low confidence.
 * Only called when:
 * - Sender category = 'unknown'
 * - Email type = 'unknown' or confidence < threshold
 * - Document type = 'unknown' (for emails with attachments)
 *
 * Uses a fast, cost-effective model for real-time classification.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  SenderCategory,
  EmailType,
  EmailCategory,
  EmailSentiment,
} from '../../config/email-type-config';

// =============================================================================
// TYPES
// =============================================================================

export interface AIClassificationInput {
  subject: string;
  senderEmail: string;
  trueSenderEmail?: string | null;
  bodyText?: string;
  attachmentFilenames?: string[];
}

export interface AIClassificationResult {
  senderCategory: SenderCategory;
  emailType: EmailType;
  emailCategory: EmailCategory;
  sentiment: EmailSentiment;
  confidence: number;
  reasoning: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const AI_MODEL = 'claude-haiku-4-5-20251001'; // Fastest and most cost-effective ($1/$5 per 1M tokens)
const MAX_BODY_LENGTH = 1000; // Limit body text to reduce tokens
const DEFAULT_TIMEOUT = 10000; // 10 seconds

// =============================================================================
// CLASSIFICATION PROMPT
// =============================================================================

const CLASSIFICATION_PROMPT = `You are an expert at classifying shipping/freight forwarding emails.

Given the email below, classify it into the following categories. Be precise and use ONLY the values listed.

EMAIL:
Subject: {subject}
Sender: {senderEmail}
True Sender: {trueSenderEmail}
Attachments: {attachments}
Body Preview: {bodyPreview}

CLASSIFY INTO:

1. SENDER_CATEGORY (who is the sender):
   - carrier: Shipping lines (Maersk, Hapag-Lloyd, CMA CGM, COSCO, MSC, etc.)
   - intoglo: Internal @intoglo.com team
   - cha_india: Indian customs house agents (CHA)
   - customs_broker_us: US customs brokers
   - shipper: Exporters/manufacturers sending goods
   - consignee: Importers/receivers of goods
   - trucker: Trucking/drayage companies
   - partner: Freight forwarder partners
   - platform: Logistics platforms, government portals (CBP, CBSA)
   - warehouse: Warehouse/CFS facilities
   - unknown: Cannot determine or newsletters/marketing

2. EMAIL_TYPE (what is the intent/action):
   - approval_request: Requesting approval on SI, BL, checklist
   - approval_granted: Approval given
   - approval_rejected: Rejected, needs revision
   - stuffing_update: Factory stuffing status
   - gate_in_update: Container gated in at port/ICD
   - handover_update: CHA handover/railout
   - departure_update: Vessel departed/sailed (SOB)
   - transit_update: In-transit status
   - arrival_update: Vessel arrived
   - pre_alert: Pre-arrival alert to customs
   - clearance_initiation: Customs clearance started
   - clearance_complete: Customs cleared
   - delivery_scheduling: Delivery appointment
   - pickup_scheduling: Pickup/drayage arrangement
   - delivery_complete: Delivered
   - quote_request: Requesting freight quote
   - quote_response: Providing freight quote
   - payment_request: Invoice/payment due
   - payment_confirmation: Payment received
   - amendment_request: Requesting changes
   - cancellation_notice: Booking cancelled
   - query: Question/inquiry
   - reminder: Follow-up/reminder
   - urgent_action: Urgent, immediate action needed
   - delay_notice: Delay notification
   - demurrage_action: Demurrage/detention notice
   - document_share: Sharing documents (BL, invoice, etc.)
   - acknowledgement: Acknowledging receipt
   - escalation: Escalated issue/complaint
   - general_correspondence: General discussion
   - unknown: Cannot determine

3. EMAIL_CATEGORY:
   - approval: Approval-related
   - status: Status updates
   - customs: Customs-related
   - delivery: Delivery-related
   - commercial: Commercial/financial
   - change: Changes/amendments
   - communication: General communication
   - unknown: Cannot determine

4. SENTIMENT:
   - urgent: Needs immediate attention
   - escalated: Complaint/issue escalated
   - negative: Problem, dissatisfaction
   - positive: Thanks, appreciation
   - neutral: Normal business

Respond in JSON format ONLY (no other text):
{"senderCategory":"...","emailType":"...","emailCategory":"...","sentiment":"...","confidence":0-100,"reasoning":"Brief explanation"}`;

// =============================================================================
// SERVICE
// =============================================================================

export class AIClassificationService {
  private readonly client: Anthropic;
  private readonly enabled: boolean;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    this.enabled = !!key;

    if (this.enabled) {
      this.client = new Anthropic({ apiKey: key });
    } else {
      // Create a placeholder - will check enabled flag before use
      this.client = null as unknown as Anthropic;
    }
  }

  /**
   * Check if AI classification is available
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Classify email using AI
   */
  async classify(input: AIClassificationInput): Promise<AIClassificationResult | null> {
    if (!this.enabled) {
      console.warn('[AIClassification] Service not enabled - missing ANTHROPIC_API_KEY');
      return null;
    }

    try {
      const prompt = this.buildPrompt(input);

      const response = await this.client.messages.create({
        model: AI_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      // Extract JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[AIClassification] Could not parse JSON from response');
        return null;
      }

      const result = JSON.parse(jsonMatch[0]);

      // Validate and normalize result
      return this.normalizeResult(result);
    } catch (error) {
      console.error('[AIClassification] Error:', error);
      return null;
    }
  }

  /**
   * Build prompt with email data
   */
  private buildPrompt(input: AIClassificationInput): string {
    const bodyPreview = input.bodyText
      ? input.bodyText.substring(0, MAX_BODY_LENGTH)
      : 'N/A';

    const attachments = input.attachmentFilenames?.length
      ? input.attachmentFilenames.join(', ')
      : 'None';

    return CLASSIFICATION_PROMPT
      .replace('{subject}', input.subject || 'N/A')
      .replace('{senderEmail}', input.senderEmail || 'N/A')
      .replace('{trueSenderEmail}', input.trueSenderEmail || 'N/A')
      .replace('{attachments}', attachments)
      .replace('{bodyPreview}', bodyPreview);
  }

  /**
   * Normalize and validate AI result
   */
  private normalizeResult(raw: Record<string, unknown>): AIClassificationResult {
    // Valid values for each field
    const validSenderCategories: SenderCategory[] = [
      'carrier', 'intoglo', 'cha_india', 'customs_broker_us', 'shipper',
      'consignee', 'trucker', 'partner', 'platform', 'warehouse', 'unknown'
    ];

    const validEmailTypes: EmailType[] = [
      'approval_request', 'approval_granted', 'approval_rejected',
      'stuffing_update', 'gate_in_update', 'handover_update',
      'departure_update', 'transit_update', 'arrival_update',
      'pre_alert', 'clearance_initiation', 'clearance_complete',
      'delivery_scheduling', 'pickup_scheduling', 'delivery_complete',
      'quote_request', 'quote_response', 'payment_request', 'payment_confirmation',
      'amendment_request', 'cancellation_notice',
      'query', 'reminder', 'urgent_action', 'delay_notice', 'demurrage_action',
      'document_share', 'acknowledgement', 'escalation', 'general_correspondence', 'unknown'
    ];

    const validCategories: EmailCategory[] = [
      'approval', 'status', 'customs', 'delivery', 'commercial', 'change', 'communication', 'unknown'
    ];

    const validSentiments: EmailSentiment[] = [
      'urgent', 'escalated', 'negative', 'positive', 'neutral', 'unknown'
    ];

    // Normalize with fallbacks
    const senderCategory = validSenderCategories.includes(raw.senderCategory as SenderCategory)
      ? (raw.senderCategory as SenderCategory)
      : 'unknown';

    const emailType = validEmailTypes.includes(raw.emailType as EmailType)
      ? (raw.emailType as EmailType)
      : 'unknown';

    const emailCategory = validCategories.includes(raw.emailCategory as EmailCategory)
      ? (raw.emailCategory as EmailCategory)
      : 'unknown';

    const sentiment = validSentiments.includes(raw.sentiment as EmailSentiment)
      ? (raw.sentiment as EmailSentiment)
      : 'neutral';

    const confidence = typeof raw.confidence === 'number'
      ? Math.min(100, Math.max(0, raw.confidence))
      : 70;

    const reasoning = typeof raw.reasoning === 'string'
      ? raw.reasoning
      : 'AI classification';

    return {
      senderCategory,
      emailType,
      emailCategory,
      sentiment,
      confidence,
      reasoning,
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

let instance: AIClassificationService | null = null;

/**
 * Get or create AIClassificationService instance (singleton)
 */
export function getAIClassificationService(): AIClassificationService {
  if (!instance) {
    instance = new AIClassificationService();
  }
  return instance;
}

/**
 * Create a new AIClassificationService instance
 */
export function createAIClassificationService(apiKey?: string): AIClassificationService {
  return new AIClassificationService(apiKey);
}
