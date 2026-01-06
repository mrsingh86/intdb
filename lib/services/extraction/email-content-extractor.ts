/**
 * Email Content Extractor
 *
 * Specialized extractor for email subject/body text.
 * Uses different strategies than PDF extraction:
 * - Subject line patterns (high signal for identifiers)
 * - Body text patterns (conversational context)
 * - Thread-aware extraction (fresh body vs quoted content)
 * - Signature removal for cleaner extraction
 *
 * Single Responsibility: Extract entities from email text content only.
 */

import {
  RegexExtractor,
  ExtractionResult,
  DateExtractionResult,
  CutoffExtractionResult,
} from './regex-extractors';
import { CONFIDENCE_THRESHOLDS } from './pattern-definitions';
import { ThreadContext } from '../classification/thread-context-service';

// ============================================================================
// Types
// ============================================================================

export interface EmailExtractionInput {
  emailId: string;
  subject: string;
  bodyText: string;
  threadContext?: ThreadContext;
  carrier?: string;
  documentType?: string;
}

export interface EmailExtraction {
  entityType: string;
  entityValue: string;
  entityNormalized?: string;
  confidenceScore: number;
  extractionMethod: EmailExtractionMethod;
  sourceField: EmailSourceField;
  contextSnippet?: string;
  positionStart?: number;
  positionEnd?: number;
  isFromReply?: boolean;
  threadPosition?: number;
}

export type EmailSourceField = 'subject' | 'body_text' | 'fresh_body';
export type EmailExtractionMethod =
  | 'regex_subject'
  | 'regex_body'
  | 'regex_fresh_body'
  | 'pattern_match'
  | 'ai_nlp';

export interface EmailExtractionResult {
  success: boolean;
  extractions: EmailExtraction[];
  metadata: {
    subjectExtractionsCount: number;
    bodyExtractionsCount: number;
    totalConfidence: number;
    processingTimeMs: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const SIGNATURE_MARKERS = [
  /^--\s*$/m,
  /^Best\s+regards,?$/im,
  /^Kind\s+regards,?$/im,
  /^Sincerely,?$/im,
  /^Thanks,?$/im,
  /^Thank\s+you,?$/im,
  /^Regards,?$/im,
  /^Warm\s+regards,?$/im,
  /^Sent\s+from\s+my/im,
  /^Get\s+Outlook\s+for/im,
  /^\*{3,}/m,
  /^_{3,}/m,
];

const DISCLAIMER_MARKERS = [
  /^DISCLAIMER/im,
  /^CONFIDENTIALITY\s+NOTICE/im,
  /^This\s+email\s+and\s+any\s+attachments/im,
  /^This\s+message\s+is\s+intended\s+only/im,
  /^IMPORTANT\s+NOTICE/im,
];

// Confidence adjustments for email-specific patterns
const CONFIDENCE_ADJUSTMENTS = {
  subjectBonus: 10, // Subject line matches are more reliable
  bodyPenalty: 5, // Body matches need slight penalty (more noise)
  replyPenalty: 10, // Replies may have inherited content
  quotedPenalty: 15, // Quoted content is less reliable
};

// ============================================================================
// Email Content Extractor
// ============================================================================

export class EmailContentExtractor {
  private regexExtractor: RegexExtractor;

  constructor() {
    this.regexExtractor = new RegexExtractor();
  }

  /**
   * Extract entities from email content.
   * Prioritizes subject line for identifiers, body for dates/details.
   */
  async extract(input: EmailExtractionInput): Promise<EmailExtractionResult> {
    const startTime = Date.now();
    const extractions: EmailExtraction[] = [];

    // Clean the body text
    const cleanedBody = this.removeSignatureAndDisclaimer(input.bodyText);
    const freshBody = input.threadContext?.freshBody || cleanedBody;
    const isReply = input.threadContext?.isReply || false;

    // 1. Extract from subject line (highest signal for identifiers)
    const subjectExtractions = await this.extractFromSubject(
      input.subject,
      isReply
    );
    extractions.push(...subjectExtractions);

    // 2. Extract from fresh body (latest reply content)
    if (freshBody && freshBody.trim()) {
      const freshBodyExtractions = await this.extractFromBody(
        freshBody,
        'fresh_body',
        isReply
      );
      extractions.push(...freshBodyExtractions);
    }

    // 3. Extract from full body (may find additional entities)
    const bodyExtractions = await this.extractFromBody(
      cleanedBody,
      'body_text',
      isReply
    );

    // Only add body extractions that weren't found in fresh body
    const existingTypes = new Set(
      extractions.map((e) => `${e.entityType}:${e.entityValue}`)
    );
    for (const extraction of bodyExtractions) {
      const key = `${extraction.entityType}:${extraction.entityValue}`;
      if (!existingTypes.has(key)) {
        extractions.push(extraction);
      }
    }

    // Deduplicate and merge
    const mergedExtractions = this.deduplicateExtractions(extractions);

    // Calculate metadata
    const subjectCount = mergedExtractions.filter(
      (e) => e.sourceField === 'subject'
    ).length;
    const bodyCount = mergedExtractions.filter(
      (e) => e.sourceField !== 'subject'
    ).length;
    const totalConfidence = this.calculateAverageConfidence(mergedExtractions);

    return {
      success: true,
      extractions: mergedExtractions,
      metadata: {
        subjectExtractionsCount: subjectCount,
        bodyExtractionsCount: bodyCount,
        totalConfidence,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Extract entities from subject line.
   * Subject is highly reliable for booking numbers, container numbers.
   */
  private async extractFromSubject(
    subject: string,
    isReply: boolean
  ): Promise<EmailExtraction[]> {
    const extractions: EmailExtraction[] = [];
    const cleanSubject = this.cleanSubjectLine(subject);

    // Run regex extraction
    const regexResults = this.regexExtractor.extract({
      subject: cleanSubject,
      bodyText: '',
    });

    // Convert identifiers
    for (const result of regexResults.bookingNumbers) {
      extractions.push(
        this.createExtraction(
          'booking_number',
          result,
          'subject',
          'regex_subject',
          isReply
        )
      );
    }

    for (const result of regexResults.containerNumbers) {
      extractions.push(
        this.createExtraction(
          'container_number',
          result,
          'subject',
          'regex_subject',
          isReply
        )
      );
    }

    for (const result of regexResults.blNumbers) {
      extractions.push(
        this.createExtraction(
          'bl_number',
          result,
          'subject',
          'regex_subject',
          isReply
        )
      );
    }

    // Extract vessel/voyage from subject
    if (regexResults.vessel) {
      extractions.push(
        this.createExtraction(
          'vessel_name',
          regexResults.vessel,
          'subject',
          'regex_subject',
          isReply
        )
      );
    }

    if (regexResults.voyage) {
      extractions.push(
        this.createExtraction(
          'voyage_number',
          regexResults.voyage,
          'subject',
          'regex_subject',
          isReply
        )
      );
    }

    return extractions;
  }

  /**
   * Extract entities from email body text.
   */
  private async extractFromBody(
    bodyText: string,
    sourceField: EmailSourceField,
    isReply: boolean
  ): Promise<EmailExtraction[]> {
    const extractions: EmailExtraction[] = [];
    const method: EmailExtractionMethod =
      sourceField === 'fresh_body' ? 'regex_fresh_body' : 'regex_body';

    // Run regex extraction
    const regexResults = this.regexExtractor.extract({
      subject: '',
      bodyText: bodyText,
    });

    // Convert identifiers
    for (const result of regexResults.bookingNumbers) {
      extractions.push(
        this.createExtraction(
          'booking_number',
          result,
          sourceField,
          method,
          isReply
        )
      );
    }

    for (const result of regexResults.containerNumbers) {
      extractions.push(
        this.createExtraction(
          'container_number',
          result,
          sourceField,
          method,
          isReply
        )
      );
    }

    for (const result of regexResults.blNumbers) {
      extractions.push(
        this.createExtraction('bl_number', result, sourceField, method, isReply)
      );
    }

    // Convert dates
    if (regexResults.etd) {
      extractions.push(
        this.createDateExtraction(
          'etd',
          regexResults.etd,
          sourceField,
          method,
          isReply
        )
      );
    }

    if (regexResults.eta) {
      extractions.push(
        this.createDateExtraction(
          'eta',
          regexResults.eta,
          sourceField,
          method,
          isReply
        )
      );
    }

    // Convert cutoffs
    for (const cutoff of regexResults.cutoffs) {
      extractions.push(
        this.createCutoffExtraction(cutoff, sourceField, method, isReply)
      );
    }

    // Convert ports
    if (regexResults.portOfLoading) {
      extractions.push(
        this.createExtraction(
          'port_of_loading',
          regexResults.portOfLoading,
          sourceField,
          method,
          isReply
        )
      );
    }

    if (regexResults.portOfDischarge) {
      extractions.push(
        this.createExtraction(
          'port_of_discharge',
          regexResults.portOfDischarge,
          sourceField,
          method,
          isReply
        )
      );
    }

    // Convert vessel/voyage
    if (regexResults.vessel) {
      extractions.push(
        this.createExtraction(
          'vessel_name',
          regexResults.vessel,
          sourceField,
          method,
          isReply
        )
      );
    }

    if (regexResults.voyage) {
      extractions.push(
        this.createExtraction(
          'voyage_number',
          regexResults.voyage,
          sourceField,
          method,
          isReply
        )
      );
    }

    // Carrier detection
    if (regexResults.carrier) {
      extractions.push({
        entityType: 'carrier',
        entityValue: regexResults.carrier,
        confidenceScore: this.adjustConfidence(85, sourceField, isReply),
        extractionMethod: method,
        sourceField,
        isFromReply: isReply,
      });
    }

    return extractions;
  }

  /**
   * Create an extraction record from a regex result.
   */
  private createExtraction(
    entityType: string,
    result: ExtractionResult,
    sourceField: EmailSourceField,
    method: EmailExtractionMethod,
    isReply: boolean
  ): EmailExtraction {
    return {
      entityType,
      entityValue: result.value,
      entityNormalized: result.value, // Use value as normalized (no separate field)
      confidenceScore: this.adjustConfidence(
        result.confidence,
        sourceField,
        isReply
      ),
      extractionMethod: method,
      sourceField,
      contextSnippet: result.context,
      isFromReply: isReply,
    };
  }

  /**
   * Create an extraction record from a date result.
   */
  private createDateExtraction(
    entityType: string,
    result: DateExtractionResult,
    sourceField: EmailSourceField,
    method: EmailExtractionMethod,
    isReply: boolean
  ): EmailExtraction {
    return {
      entityType,
      entityValue: result.value,
      entityNormalized: result.parsedDate, // Use parsedDate as normalized ISO format
      confidenceScore: this.adjustConfidence(
        result.confidence,
        sourceField,
        isReply
      ),
      extractionMethod: method,
      sourceField,
      contextSnippet: result.context,
      isFromReply: isReply,
    };
  }

  /**
   * Create an extraction record from a cutoff result.
   */
  private createCutoffExtraction(
    result: CutoffExtractionResult,
    sourceField: EmailSourceField,
    method: EmailExtractionMethod,
    isReply: boolean
  ): EmailExtraction {
    // CutoffExtractionResult.cutoffType is already the full type name
    return {
      entityType: result.cutoffType,
      entityValue: result.value,
      entityNormalized: result.parsedDate, // Use parsedDate as normalized ISO format
      confidenceScore: this.adjustConfidence(
        result.confidence,
        sourceField,
        isReply
      ),
      extractionMethod: method,
      sourceField,
      contextSnippet: result.context,
      isFromReply: isReply,
    };
  }

  /**
   * Adjust confidence based on extraction context.
   */
  private adjustConfidence(
    baseConfidence: number,
    sourceField: EmailSourceField,
    isReply: boolean
  ): number {
    let adjusted = baseConfidence;

    // Subject line extractions get a bonus
    if (sourceField === 'subject') {
      adjusted += CONFIDENCE_ADJUSTMENTS.subjectBonus;
    } else {
      adjusted -= CONFIDENCE_ADJUSTMENTS.bodyPenalty;
    }

    // Reply emails may have inherited content
    if (isReply) {
      adjusted -= CONFIDENCE_ADJUSTMENTS.replyPenalty;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, adjusted));
  }

  /**
   * Remove email signature and disclaimer from body text.
   */
  private removeSignatureAndDisclaimer(text: string): string {
    let cutoffIndex = text.length;

    // Find signature marker
    for (const marker of SIGNATURE_MARKERS) {
      const match = text.match(marker);
      if (match && match.index !== undefined) {
        cutoffIndex = Math.min(cutoffIndex, match.index);
      }
    }

    // Find disclaimer marker
    for (const marker of DISCLAIMER_MARKERS) {
      const match = text.match(marker);
      if (match && match.index !== undefined) {
        cutoffIndex = Math.min(cutoffIndex, match.index);
      }
    }

    return text.substring(0, cutoffIndex).trim();
  }

  /**
   * Clean subject line by removing RE:/FW: prefixes.
   */
  private cleanSubjectLine(subject: string): string {
    return subject
      .replace(/^(RE|FW|FWD):\s*/gi, '')
      .replace(/^(RE|FW|FWD):\s*/gi, '') // Remove nested prefixes
      .trim();
  }

  /**
   * Deduplicate extractions, keeping highest confidence.
   */
  private deduplicateExtractions(
    extractions: EmailExtraction[]
  ): EmailExtraction[] {
    const map = new Map<string, EmailExtraction>();

    for (const extraction of extractions) {
      const key = `${extraction.entityType}:${extraction.entityValue}`;
      const existing = map.get(key);

      if (!existing || extraction.confidenceScore > existing.confidenceScore) {
        map.set(key, extraction);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Calculate average confidence across extractions.
   */
  private calculateAverageConfidence(extractions: EmailExtraction[]): number {
    if (extractions.length === 0) return 0;

    const total = extractions.reduce((sum, e) => sum + e.confidenceScore, 0);
    return Math.round(total / extractions.length);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createEmailContentExtractor(): EmailContentExtractor {
  return new EmailContentExtractor();
}
