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
    this.aiModel = options.aiModel ?? 'claude-3-5-haiku-20241022';

    if (this.useAiFallback && process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic();
    }
  }

  /**
   * Classify an email using hybrid approach (deterministic first, AI fallback)
   *
   * This is the SINGLE entry point for classification in the codebase.
   */
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const sender = input.trueSenderEmail || input.senderEmail;

    // Step 1: Try deterministic classification (with attachment content validation)
    const deterministicResult = classifyDeterministic(
      input.subject,
      sender,
      input.attachmentFilenames,
      input.attachmentContent
    );

    if (deterministicResult && deterministicResult.confidence > 0) {
      // Detect sub-type from subject
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
        classificationReason: `Pattern match: ${deterministicResult.matchedPattern}`,
      };
    }

    // Step 2: AI fallback (if enabled)
    if (this.useAiFallback && this.anthropic) {
      return await this.classifyWithAI(input);
    }

    // Step 3: Default to unknown
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
   * Build AI prompt with full context
   */
  private buildAIPrompt(input: ClassificationInput): string {
    const bodyContent = input.bodyText || input.snippet || '';
    const truncatedBody = bodyContent.length > 2000
      ? bodyContent.substring(0, 2000) + '...'
      : bodyContent;

    const attachmentInfo = input.attachmentFilenames?.length
      ? `Attachments: ${input.attachmentFilenames.join(', ')}`
      : 'Attachments: None';

    const pdfContent = input.attachmentContent && input.attachmentContent.length > 100
      ? `\nPDF CONTENT (first 1500 chars):\n${input.attachmentContent.substring(0, 1500)}`
      : '';

    return `You are a shipping document classification expert. Classify this email.

DOCUMENT TYPES:
- booking_confirmation: Original booking confirmed by carrier (PDF has "BOOKING CONFIRMATION" heading)
- booking_amendment: Changes to existing booking (schedule, equipment, routing)
- booking_cancellation: Booking cancelled
- arrival_notice: Cargo arrival notification (CRITICAL - identify arrivals)
- shipment_notice: FMC filing, shipment notice, container updates
- bill_of_lading: B/L document (draft, copy, original, sea waybill)
- shipping_instruction: SI submission/confirmation
- invoice: Freight invoice, commercial invoice
- vgm_confirmation: VGM weight verified/accepted
- vgm_reminder: VGM submission reminder
- vessel_schedule: Sailing schedule, vessel updates
- pickup_notification: Container ready for pickup
- cutoff_advisory: Cut-off time changes (SI, VGM, cargo)
- delivery_order: Release/delivery authorization
- customs_clearance: Customs status updates
- rate_quote: Freight rate quotation
- sob_confirmation: Shipped on Board confirmation
- si_submission: SI declaration submission
- general_correspondence: Replies, operational emails, non-document

CLASSIFICATION RULES:
1. RE:/FW: prefix usually = general_correspondence UNLESS body contains actual document
2. booking_confirmation MUST have PDF with "BOOKING CONFIRMATION" heading
3. arrival_notice is CRITICAL - identify cargo arrival at destination
4. Invoices have invoice numbers and amounts
5. VGM has container weights verified
6. If uncertain, classify as general_correspondence with low confidence

EMAIL TO CLASSIFY:
Subject: ${input.subject}
From: ${input.senderEmail}
${input.trueSenderEmail ? `True Sender: ${input.trueSenderEmail}` : ''}
${attachmentInfo}

Body:
${truncatedBody || '(no body content)'}
${pdfContent}

Use the classify_shipping_email tool to provide your classification.`;
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
