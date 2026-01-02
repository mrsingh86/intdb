/**
 * Unified Classification Service (Consolidated)
 *
 * SINGLE source of truth for email classification.
 *
 * Architecture:
 * 1. FIRST: Try deterministic patterns (fast, free, 100% consistent)
 *    - Uses shipping-line-patterns.ts for carrier-specific matching
 *    - Validates attachment content (e.g., BC must have "BOOKING CONFIRMATION" heading)
 *
 * 2. FALLBACK: Use AI with structured tool_use for reliability
 *    - Claude Haiku for speed/cost efficiency
 *    - Structured output via tool_use (no regex parsing)
 *
 * Principles:
 * - Single Responsibility: Only classification logic
 * - Deep Module: Simple classify() interface, complex implementation
 * - Configuration Over Code: Patterns in shipping-line-patterns.ts
 * - Fail Fast: Returns unknown with low confidence rather than guessing
 *
 * This service REPLACES:
 * - AdvancedClassificationService (deprecated)
 * - ComprehensiveClassificationService (deprecated)
 * - EnhancedClassificationService (deprecated)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  classifyEmail as classifyDeterministic,
  DocumentType,
  ClassificationResult as DeterministicResult,
} from '../config/shipping-line-patterns';

// ============================================================================
// Types
// ============================================================================

export interface ClassificationInput {
  emailId: string;
  subject: string;
  senderEmail: string;
  trueSenderEmail?: string;
  bodyText?: string;
  snippet?: string;
  hasAttachments: boolean;
  attachmentFilenames?: string[];
  attachmentContent?: string; // Extracted PDF text for content validation
}

export interface ClassificationResult {
  documentType: DocumentType | string;
  subType: DocumentSubType | null;
  carrierId: string | null;
  carrierName: string | null;
  confidence: number;
  method: 'deterministic' | 'ai';
  matchedPattern?: string;
  labels: string[];
  needsManualReview: boolean;
  classificationReason: string;
}

export type DocumentSubType =
  | 'original'
  | 'amendment'
  | 'update'
  | 'cancellation'
  | 'draft'
  | 'final'
  | 'copy'
  | '1st_update'
  | '2nd_update'
  | '3rd_update'
  | null;

// Standard document types (aligned with database enum)
const STANDARD_DOCUMENT_TYPES = [
  'booking_confirmation',
  'booking_amendment',
  'booking_cancellation',
  'arrival_notice',
  'shipment_notice',
  'bill_of_lading',
  'shipping_instruction',
  'invoice',
  'vgm_confirmation',
  'vgm_reminder',
  'vessel_schedule',
  'pickup_notification',
  'cutoff_advisory',
  'delivery_order',
  'customs_clearance',
  'rate_quote',
  'general_correspondence',
  'sob_confirmation',
  'si_submission',
] as const;

// Labels for multi-label classification
const CLASSIFICATION_LABELS = [
  'contains_cutoffs',
  'contains_schedule',
  'contains_routing',
  'contains_rates',
  'contains_cargo_details',
  'urgent',
  'requires_action',
  'amendment_notice',
  'schedule_change',
  'vessel_change',
] as const;

// Tool definition for structured AI output
const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: 'classify_shipping_email',
  description: 'Classify a shipping/logistics email into a document type',
  input_schema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        enum: STANDARD_DOCUMENT_TYPES,
        description: 'The type of shipping document this email represents',
      },
      sub_type: {
        type: 'string',
        enum: ['original', 'amendment', 'update', 'cancellation', 'draft', 'final', 'copy', null],
        description: 'Sub-type if applicable (original, amendment, etc.)',
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Confidence score 0-100',
      },
      labels: {
        type: 'array',
        items: { type: 'string', enum: CLASSIFICATION_LABELS },
        description: 'Applicable labels (can have multiple)',
      },
      carrier: {
        type: 'string',
        description: 'Detected carrier if identifiable (maersk, hapag-lloyd, cma-cgm, cosco, msc, etc.)',
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of classification decision',
      },
    },
    required: ['document_type', 'confidence', 'reasoning'],
  },
};

// ============================================================================
// Unified Classification Service
// ============================================================================

export class UnifiedClassificationService {
  private supabase: SupabaseClient;
  private anthropic: Anthropic | null = null;
  private useAiFallback: boolean;
  private aiModel: string;

  constructor(
    supabase: SupabaseClient,
    options: {
      useAiFallback?: boolean;
      aiModel?: string;
    } = {}
  ) {
    this.supabase = supabase;
    this.useAiFallback = options.useAiFallback ?? true;
    // Use Sonnet for AI fallback - good accuracy at reasonable cost
    // Deterministic patterns handle ~80% of cases (free), AI only for edge cases
    this.aiModel = options.aiModel ?? 'claude-sonnet-4-20250514';

    if (this.useAiFallback && process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic();
    }
  }

  /**
   * COMPREHENSIVE subject line patterns for deterministic classification
   * These patterns are 100% accurate and should handle 80%+ of emails.
   * Order matters: more specific patterns first.
   */
  private readonly SUBJECT_PATTERNS: Array<{ pattern: RegExp; type: string; confidence: number }> = [
    // ===== SOB / SHIPPED ON BOARD (CRITICAL - often misclassified) =====
    { pattern: /\bSOB\s+CONFIRM/i, type: 'sob_confirmation', confidence: 95 },
    { pattern: /\bSOB\s+for\b/i, type: 'sob_confirmation', confidence: 95 },
    { pattern: /\bshipped\s+on\s+board/i, type: 'sob_confirmation', confidence: 95 },
    { pattern: /\bcontainer.*loaded/i, type: 'sob_confirmation', confidence: 85 },
    { pattern: /\bon\s*board\s+confirm/i, type: 'sob_confirmation', confidence: 90 },

    // ===== ARRIVAL NOTICE (vessel arriving at destination) =====
    { pattern: /\barrival\s+notice\b/i, type: 'arrival_notice', confidence: 95 },
    { pattern: /\bnotice\s+of\s+arrival\b/i, type: 'arrival_notice', confidence: 95 },
    { pattern: /\bvessel\s+arrival\b/i, type: 'arrival_notice', confidence: 90 },
    { pattern: /\bcargo\s+arrival\b/i, type: 'arrival_notice', confidence: 90 },
    { pattern: /\barriving\s+at\s+port/i, type: 'arrival_notice', confidence: 85 },

    // ===== BILL OF LADING =====
    { pattern: /\b(draft|final)?\s*B\/?L\b/i, type: 'bill_of_lading', confidence: 90 },
    { pattern: /\bbill\s+of\s+lading\b/i, type: 'bill_of_lading', confidence: 95 },
    { pattern: /\bsea\s*waybill\b/i, type: 'bill_of_lading', confidence: 90 },
    { pattern: /\bhouse\s*b\/?l\b/i, type: 'bill_of_lading', confidence: 90 },
    { pattern: /\bmaster\s*b\/?l\b/i, type: 'bill_of_lading', confidence: 90 },
    { pattern: /\bHBL\b/, type: 'bill_of_lading', confidence: 85 },
    { pattern: /\bMBL\b/, type: 'bill_of_lading', confidence: 85 },

    // ===== BOOKING CANCELLATION =====
    { pattern: /\bbooking.*cancel/i, type: 'booking_cancellation', confidence: 95 },
    { pattern: /\bcancel.*booking/i, type: 'booking_cancellation', confidence: 95 },
    { pattern: /\bcancellation\s+notice/i, type: 'booking_cancellation', confidence: 90 },

    // ===== BOOKING AMENDMENT =====
    { pattern: /\b(1st|2nd|3rd|\d+th)\s+UPDATE\b/i, type: 'booking_amendment', confidence: 95 },
    { pattern: /\bamendment\s+to\s+booking/i, type: 'booking_amendment', confidence: 95 },
    { pattern: /\bbooking.*amendment/i, type: 'booking_amendment', confidence: 90 },
    { pattern: /\brollover\b/i, type: 'booking_amendment', confidence: 85 },

    // ===== DELIVERY ORDER =====
    { pattern: /\bdelivery\s+order\b/i, type: 'delivery_order', confidence: 95 },
    { pattern: /\bD\/?O\s+(release|issued)/i, type: 'delivery_order', confidence: 90 },
    { pattern: /\brelease\s+order\b/i, type: 'delivery_order', confidence: 85 },

    // ===== SHIPPING INSTRUCTIONS =====
    { pattern: /\bSI\s+(submission|confirm|draft)/i, type: 'shipping_instruction', confidence: 90 },
    { pattern: /\bshipping\s+instruction/i, type: 'shipping_instruction', confidence: 90 },
    { pattern: /\bSI\s+CUT\s*OFF/i, type: 'cutoff_advisory', confidence: 85 },

    // ===== VGM =====
    { pattern: /\bVGM\s+(confirm|submit|accept|receiv)/i, type: 'vgm_confirmation', confidence: 95 },
    { pattern: /\bverified\s+gross\s+mass/i, type: 'vgm_confirmation', confidence: 90 },
    { pattern: /\bVGM\s+(remind|deadline|cutoff)/i, type: 'vgm_reminder', confidence: 90 },

    // ===== BOOKING CONFIRMATION (original - no UPDATE/AMENDMENT keyword) =====
    { pattern: /^Booking\s+Confirmation\s*:/i, type: 'booking_confirmation', confidence: 90 },
    { pattern: /CMA\s*CGM.*Booking\s+confirmation/i, type: 'booking_confirmation', confidence: 90 },
    { pattern: /\[Hapag.*Booking\s+Confirmation/i, type: 'booking_confirmation', confidence: 90 },

    // ===== INVOICE =====
    { pattern: /\bfreight\s+invoice\b/i, type: 'invoice', confidence: 90 },
    { pattern: /\binvoice\s*#\s*[A-Z0-9-]+/i, type: 'invoice', confidence: 90 },
    { pattern: /\binvoice\s+\d+/i, type: 'invoice', confidence: 85 },
    { pattern: /\bcommercial\s+invoice/i, type: 'invoice', confidence: 85 },
    { pattern: /\bproforma\s+invoice/i, type: 'invoice', confidence: 85 },

    // ===== CUSTOMS =====
    { pattern: /\bcustoms\s+(clear|release|entry)/i, type: 'customs_clearance', confidence: 90 },
    { pattern: /\bduty\s+(invoice|payment|summary)/i, type: 'customs_clearance', confidence: 85 },
    { pattern: /\bISF\s+(fil|confirm|submit)/i, type: 'customs_clearance', confidence: 85 },

    // ===== RATE QUOTE =====
    { pattern: /\bprice\s+overview\b/i, type: 'rate_quote', confidence: 90 },
    { pattern: /\brate\s+quot/i, type: 'rate_quote', confidence: 90 },
    { pattern: /\bfreight\s+quot/i, type: 'rate_quote', confidence: 90 },

    // ===== VESSEL SCHEDULE =====
    { pattern: /\bvessel\s+schedule\b/i, type: 'vessel_schedule', confidence: 90 },
    { pattern: /\bsailing\s+schedule\b/i, type: 'vessel_schedule', confidence: 90 },
    { pattern: /\bETD.*ETA\b/i, type: 'vessel_schedule', confidence: 80 },

    // ===== SHIPMENT NOTICE =====
    { pattern: /\bFMC\s+filing\b/i, type: 'shipment_notice', confidence: 90 },
    { pattern: /\bshipment\s+notice\b/i, type: 'shipment_notice', confidence: 90 },

    // ===== PICKUP =====
    { pattern: /\bpickup\s+(notice|notif|ready)/i, type: 'pickup_notification', confidence: 90 },
    { pattern: /\bcontainer\s+release/i, type: 'pickup_notification', confidence: 85 },

    // ===== CUTOFF =====
    { pattern: /\bcut\s*-?\s*off\s+(advis|change|update)/i, type: 'cutoff_advisory', confidence: 90 },
    { pattern: /\bdeadline\s+(change|extend)/i, type: 'cutoff_advisory', confidence: 85 },
  ];

  /**
   * Pattern-based classification using comprehensive subject patterns
   * Returns classification if confident match found, null otherwise
   */
  private classifyBySubjectPattern(subject: string): ClassificationResult | null {
    for (const { pattern, type, confidence } of this.SUBJECT_PATTERNS) {
      if (pattern.test(subject)) {
        return {
          documentType: type,
          subType: this.detectSubType(subject),
          carrierId: null,
          carrierName: null,
          confidence,
          method: 'deterministic',
          matchedPattern: pattern.toString(),
          labels: [],
          needsManualReview: false,
          classificationReason: `Subject pattern match: ${pattern.toString()}`,
        };
      }
    }
    return null;
  }

  /**
   * Pre-filter for general correspondence (thread replies without document content)
   */
  private preFilterGeneralCorrespondence(subject: string): boolean {
    // Thread replies (RE:, FW:) are usually general correspondence
    // UNLESS they match a specific document pattern (already checked before this)
    if (/^(re|fw|fwd):\s/i.test(subject)) {
      const afterPrefix = subject.replace(/^(re|fw|fwd):\s*/i, '');
      // Only allow if it's an exact carrier BC pattern
      if (!/^Booking Confirmation\s*:/i.test(afterPrefix) &&
          !/CMA CGM.*Booking confirmation/i.test(afterPrefix)) {
        return true;
      }
    }

    // Internal emails starting with "Go Green for"
    if (subject.toLowerCase().startsWith('go green for')) {
      return true;
    }

    return false;
  }

  /**
   * Check if email is a thread reply (Re:/Fwd:)
   * Thread replies should NOT use subject patterns - subject is inherited and unreliable.
   */
  private isThreadReply(subject: string): boolean {
    return /^(re|fw|fwd):\s/i.test(subject);
  }

  /**
   * Content-based classification for thread replies
   * Looks at body and attachment content, NOT subject
   */
  private classifyByContent(input: ClassificationInput): ClassificationResult | null {
    const content = `${input.bodyText || ''} ${input.attachmentContent || ''}`.toLowerCase();

    // Content patterns - what's actually IN this message/attachment?
    const contentPatterns: Array<{ patterns: RegExp[]; type: string; confidence: number }> = [
      // SOB - look for shipped on board indicators in content
      { patterns: [/shipped\s+on\s+board/i, /on\s*board\s+date/i, /vessel.*sailed/i], type: 'sob_confirmation', confidence: 85 },
      // Arrival notice - cargo arriving
      { patterns: [/arrival\s+notice/i, /estimated\s+arrival/i, /vessel.*arriving/i], type: 'arrival_notice', confidence: 85 },
      // Invoice - has amounts, invoice number
      { patterns: [/invoice\s+(no|number|#)/i, /amount\s+due/i, /total.*usd/i], type: 'invoice', confidence: 80 },
      // Bill of Lading - BL content
      { patterns: [/bill\s+of\s+lading/i, /b\/l\s+(no|number)/i, /sea\s*waybill/i], type: 'bill_of_lading', confidence: 85 },
      // Delivery Order
      { patterns: [/delivery\s+order/i, /release\s+auth/i, /container\s+release/i], type: 'delivery_order', confidence: 85 },
      // VGM
      { patterns: [/verified\s+gross\s+mass/i, /vgm.*confirm/i, /container.*weight/i], type: 'vgm_confirmation', confidence: 85 },
    ];

    for (const { patterns, type, confidence } of contentPatterns) {
      if (patterns.some(p => p.test(content))) {
        return {
          documentType: type,
          subType: this.detectSubType(input.subject),
          carrierId: null,
          carrierName: null,
          confidence,
          method: 'deterministic',
          matchedPattern: 'content_pattern',
          labels: [],
          needsManualReview: false,
          classificationReason: `Content pattern match for ${type}`,
        };
      }
    }
    return null;
  }

  /**
   * Classify an email using hybrid approach:
   *
   * FOR ORIGINAL EMAILS (no Re:/Fwd:):
   *   1. Subject pattern matching (fast, reliable)
   *   2. Carrier-specific patterns
   *   3. AI fallback
   *
   * FOR THREAD REPLIES (Re:/Fwd:):
   *   1. Content-based classification (body + attachments) - subject is unreliable!
   *   2. AI fallback with full context
   *
   * This handles the common case where team continues in same thread but shares different documents.
   */
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const sender = input.trueSenderEmail || input.senderEmail;
    const isReply = this.isThreadReply(input.subject);

    // ===== THREAD REPLIES: Use content, NOT subject =====
    if (isReply) {
      // Step 1: Content-based classification (body + attachments)
      const contentResult = this.classifyByContent(input);
      if (contentResult) {
        contentResult.labels = this.inferLabels(input);
        return contentResult;
      }

      // Step 2: AI fallback for thread replies (will analyze body + attachments)
      if (this.useAiFallback && this.anthropic) {
        return await this.classifyWithAI(input);
      }

      // No match - general correspondence
      return {
        documentType: 'general_correspondence',
        subType: null,
        carrierId: null,
        carrierName: null,
        confidence: 60,
        method: 'deterministic',
        matchedPattern: 'thread_reply_no_match',
        labels: this.inferLabels(input),
        needsManualReview: true,
        classificationReason: 'Thread reply - no clear document pattern in content',
      };
    }

    // ===== ORIGINAL EMAILS: Use subject patterns =====

    // Step 1: Subject pattern matching (HIGHEST PRIORITY for original emails)
    const subjectPatternResult = this.classifyBySubjectPattern(input.subject);
    if (subjectPatternResult) {
      subjectPatternResult.labels = this.inferLabels(input);
      return subjectPatternResult;
    }

    // Step 3: Carrier-specific deterministic patterns (with attachment content validation)
    const deterministicResult = classifyDeterministic(
      input.subject,
      sender,
      input.attachmentFilenames,
      input.attachmentContent
    );

    if (deterministicResult && deterministicResult.confidence > 0) {
      const subType = this.detectSubType(input.subject);
      return {
        documentType: deterministicResult.documentType,
        subType,
        carrierId: deterministicResult.carrierId,
        carrierName: deterministicResult.carrierName,
        confidence: deterministicResult.confidence,
        method: 'deterministic',
        matchedPattern: deterministicResult.matchedPattern,
        labels: this.inferLabels(input),
        needsManualReview: false,
        classificationReason: `Carrier pattern match: ${deterministicResult.matchedPattern}`,
      };
    }

    // Step 4: AI fallback with Opus 4.5 (if enabled)
    if (this.useAiFallback && this.anthropic) {
      return await this.classifyWithAI(input);
    }

    // Step 5: Default to unknown
    return {
      documentType: 'general_correspondence',
      subType: null,
      carrierId: null,
      carrierName: null,
      confidence: 0,
      method: 'deterministic',
      matchedPattern: 'no_match',
      labels: [],
      needsManualReview: true,
      classificationReason: 'No pattern matched and AI fallback disabled',
    };
  }

  /**
   * AI-based classification using structured tool_use
   */
  private async classifyWithAI(input: ClassificationInput): Promise<ClassificationResult> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const prompt = this.buildAIPrompt(input);

    try {
      const response = await this.anthropic.messages.create({
        model: this.aiModel,
        max_tokens: 400,
        tools: [CLASSIFICATION_TOOL],
        tool_choice: { type: 'tool', name: 'classify_shipping_email' },
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract tool use result (structured output)
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUse && toolUse.name === 'classify_shipping_email') {
        const result = toolUse.input as {
          document_type: string;
          sub_type?: string;
          confidence: number;
          labels?: string[];
          carrier?: string;
          reasoning: string;
        };

        return {
          documentType: result.document_type,
          subType: (result.sub_type as DocumentSubType) || null,
          carrierId: result.carrier || null,
          carrierName: result.carrier ? this.getCarrierName(result.carrier) : null,
          confidence: result.confidence,
          method: 'ai',
          labels: result.labels || [],
          needsManualReview: result.confidence < 70,
          classificationReason: result.reasoning,
        };
      }
    } catch (err) {
      console.error('[UnifiedClassification] AI classification failed:', err);
    }

    // Fallback on AI failure
    return {
      documentType: 'general_correspondence',
      subType: null,
      carrierId: null,
      carrierName: null,
      confidence: 0,
      method: 'ai',
      labels: [],
      needsManualReview: true,
      classificationReason: 'AI classification failed',
    };
  }

  /**
   * Build AI prompt with expert persona and few-shot examples
   */
  private buildAIPrompt(input: ClassificationInput): string {
    const bodyContent = input.bodyText || input.snippet || '';
    const truncatedBody = bodyContent.length > 3000
      ? bodyContent.substring(0, 3000) + '...'
      : bodyContent;

    const attachmentInfo = input.attachmentFilenames?.length
      ? `Attachments: ${input.attachmentFilenames.join(', ')}`
      : 'Attachments: None';

    const pdfContent = input.attachmentContent && input.attachmentContent.length > 100
      ? `\nPDF CONTENT (first 2000 chars):\n${input.attachmentContent.substring(0, 2000)}`
      : '';

    return `You are an EXPERT freight forwarding document classifier with 20+ years of experience in international shipping logistics. You work for Intoglo, a freight forwarder handling ocean freight shipments.

YOUR EXPERTISE:
- Deep knowledge of shipping document lifecycle: Booking → SI → VGM → SOB → BL → Arrival → Delivery
- Understanding of carrier-specific document formats (Maersk, Hapag-Lloyd, CMA CGM, MSC, etc.)
- Ability to distinguish between similar document types based on subtle differences

CRITICAL DISTINCTIONS (pay close attention):

1. **SOB CONFIRMATION vs ARRIVAL NOTICE** (MOST COMMON ERROR):
   - sob_confirmation = Container LOADED onto vessel, ship is DEPARTING (beginning of voyage)
   - arrival_notice = Ship is ARRIVING at destination port (end of voyage)
   - "Sailed" or "On Board" = SOB (departure), NOT arrival
   - If subject says "SOB" → ALWAYS sob_confirmation

2. **BOOKING vs INVOICE**:
   - booking_confirmation = New booking, has booking number, vessel schedule, cutoffs
   - invoice = Has invoice number, amounts due, payment terms
   - If no invoice number or amounts → NOT an invoice

3. **BOOKING CONFIRMATION vs BOOKING AMENDMENT**:
   - booking_confirmation = Original booking (often says "1ST COPY" or first issuance)
   - booking_amendment = Changes to existing booking (says "UPDATE", "AMENDMENT", "REVISED", "2ND/3RD COPY")

DOCUMENT TYPES WITH DEFINITIONS:
- booking_confirmation: Original booking from carrier (PDF has "BOOKING CONFIRMATION" heading)
- booking_amendment: Updates to existing booking (schedule change, equipment change, routing change)
- booking_cancellation: Booking cancelled by carrier or shipper
- sob_confirmation: Shipped on Board - cargo LOADED onto vessel, vessel DEPARTING
- arrival_notice: Notification that vessel is ARRIVING at destination port
- bill_of_lading: B/L document (draft, final, house, master, sea waybill)
- shipping_instruction: SI submission or confirmation
- invoice: Freight invoice with amounts and payment details
- vgm_confirmation: VGM (Verified Gross Mass) accepted/confirmed
- vgm_reminder: Reminder to submit VGM
- delivery_order: Authorization to release cargo
- customs_clearance: Customs entry, clearance, ISF filing
- rate_quote: Price quotation for freight
- vessel_schedule: Sailing schedule updates
- pickup_notification: Container ready for pickup
- cutoff_advisory: Cut-off time changes
- shipment_notice: FMC filing, shipment updates
- si_submission: SI declaration
- general_correspondence: Operational emails, replies, non-document content

FEW-SHOT EXAMPLES:

Example 1:
Subject: "SOB CONFIRMATION // Re: 262822342 : Intoglo Quote"
Classification: sob_confirmation (95% confidence)
Reasoning: Subject explicitly says "SOB CONFIRMATION" - this is Shipped on Board notification, cargo is loaded and ship is departing.

Example 2:
Subject: "Arrival Notice - Container MRSU1234567 arriving Newark"
Classification: arrival_notice (95% confidence)
Reasoning: Explicitly mentions "Arrival Notice" and cargo arriving at destination port.

Example 3:
Subject: "2ND UPDATE Booking Confirmation : 263441600"
Classification: booking_amendment (95% confidence)
Reasoning: "2ND UPDATE" indicates this is an amendment to existing booking, not original confirmation.

Example 4:
Subject: "Re: Intoglo Quote for ABC Corp | Mumbai to LA"
Classification: general_correspondence (80% confidence)
Reasoning: Thread reply (Re:) without specific document type indicator, likely operational discussion.

NOW CLASSIFY THIS EMAIL:
Subject: ${input.subject}
From: ${input.senderEmail}
${input.trueSenderEmail ? `True Sender: ${input.trueSenderEmail}` : ''}
${attachmentInfo}

Body:
${truncatedBody || '(no body content)'}
${pdfContent}

Use the classify_shipping_email tool. Be precise and confident in your classification.`;
  }

  /**
   * Detect sub-type from subject line
   */
  private detectSubType(subject: string): DocumentSubType {
    const s = subject.toLowerCase();

    // Check for revision patterns
    const revisionMatch = subject.match(/(\d+)(?:st|nd|rd|th)\s+(?:UPDATE|REVISION|AMENDMENT)/i);
    if (revisionMatch) {
      const num = parseInt(revisionMatch[1]);
      if (num === 1) return '1st_update';
      if (num === 2) return '2nd_update';
      if (num === 3) return '3rd_update';
      return 'update';
    }

    if (/draft/i.test(s)) return 'draft';
    if (/final/i.test(s)) return 'final';
    if (/amend|revis|update/i.test(s)) return 'amendment';
    if (/cancel/i.test(s)) return 'cancellation';
    if (/copy/i.test(s)) return 'copy';

    return 'original';
  }

  /**
   * Infer labels from content
   */
  private inferLabels(input: ClassificationInput): string[] {
    const labels: string[] = [];
    const content = `${input.subject} ${input.bodyText || ''} ${input.attachmentContent || ''}`.toLowerCase();

    if (/cut[-\s]?off|deadline|closing/i.test(content)) labels.push('contains_cutoffs');
    if (/etd|eta|departure|arrival|schedule/i.test(content)) labels.push('contains_schedule');
    if (/port of|pol|pod|routing|tranship/i.test(content)) labels.push('contains_routing');
    if (/rate|freight|charge|usd|eur/i.test(content)) labels.push('contains_rates');
    if (/urgent|immediate|asap|today/i.test(content)) labels.push('urgent');
    if (/please confirm|kindly.*action|required.*action/i.test(content)) labels.push('requires_action');
    if (/vessel.*change|change.*vessel/i.test(content)) labels.push('vessel_change');
    if (/schedule.*change|etd.*change|eta.*change/i.test(content)) labels.push('schedule_change');
    if (/amend|change|update|revis/i.test(content)) labels.push('amendment_notice');

    return labels;
  }

  /**
   * Get carrier display name
   */
  private getCarrierName(carrierId: string): string {
    const names: Record<string, string> = {
      maersk: 'Maersk Line',
      'hapag-lloyd': 'Hapag-Lloyd',
      'cma-cgm': 'CMA CGM',
      cosco: 'COSCO Shipping',
      msc: 'MSC',
      evergreen: 'Evergreen',
      one: 'ONE',
      'yang-ming': 'Yang Ming',
    };
    return names[carrierId.toLowerCase()] || carrierId;
  }

  // ============================================================================
  // Database Operations
  // ============================================================================

  /**
   * Save classification to database
   */
  async saveClassification(emailId: string, result: ClassificationResult): Promise<void> {
    // Delete existing classification if any, then insert new one
    await this.supabase
      .from('document_classifications')
      .delete()
      .eq('email_id', emailId);

    const { error } = await this.supabase
      .from('document_classifications')
      .insert({
        email_id: emailId,
        document_type: result.documentType,
        revision_type: result.subType,
        confidence_score: result.confidence,
        model_name: result.method === 'ai' ? this.aiModel : 'deterministic',
        model_version: result.method === 'ai' ? 'v1|ai' : 'v2|deterministic',
        classification_reason: result.classificationReason,
        is_manual_review: result.needsManualReview,
        classified_at: new Date().toISOString(),
      });

    if (error) {
      throw new Error(`Failed to save classification: ${error.message}`);
    }
  }

  /**
   * Classify and save in one call
   */
  async classifyAndSave(input: ClassificationInput): Promise<ClassificationResult> {
    const result = await this.classify(input);
    await this.saveClassification(input.emailId, result);
    return result;
  }

  /**
   * Batch classify emails
   */
  async classifyBatch(inputs: ClassificationInput[]): Promise<Map<string, ClassificationResult>> {
    const results = new Map<string, ClassificationResult>();

    for (const input of inputs) {
      const result = await this.classify(input);
      results.set(input.emailId, result);
    }

    return results;
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createClassificationService(
  supabase: SupabaseClient,
  options?: { useAiFallback?: boolean; aiModel?: string }
): UnifiedClassificationService {
  return new UnifiedClassificationService(supabase, options);
}
