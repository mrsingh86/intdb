/**
 * Email Type Classification Service
 *
 * Classifies emails by TYPE (intent/action), parallel to document classification.
 * Uses sender category and content patterns from EMAIL_TYPE_CONFIGS.
 *
 * Email type answers: "What is the sender trying to communicate/achieve?"
 * - approval_request, stuffing_update, quote_request, etc.
 *
 * This is PARALLEL to document classification, not a fallback.
 * Both contribute to shipment intelligence:
 * - Document type: What document is attached (booking_confirmation, invoice, etc.)
 * - Email type: What action is being communicated (approval_request, status_update, etc.)
 *
 * Single Responsibility: Classify email intent/action only.
 */

import { ThreadContext } from './thread-context-service';
import {
  EMAIL_TYPE_CONFIGS,
  EmailType,
  EmailCategory,
  SenderCategory,
  getSenderCategory,
  matchesSenderCategory,
} from '../../config/email-type-config';

// =============================================================================
// TYPES
// =============================================================================

export interface EmailTypeInput {
  threadContext: ThreadContext;
  senderEmail: string;
  bodyText?: string;
}

export interface EmailTypeResult {
  emailType: EmailType;
  category: EmailCategory;
  confidence: number;
  matchedPatterns: string[];
  senderCategory: SenderCategory;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_CONFIDENCE_THRESHOLD = 70;

// =============================================================================
// SERVICE
// =============================================================================

export class EmailTypeClassificationService {
  /**
   * Classify email by type (intent/action).
   *
   * @param input - Email data with ThreadContext
   * @returns Email type classification or null if no confident match
   */
  classify(input: EmailTypeInput): EmailTypeResult | null {
    const { threadContext, senderEmail, bodyText } = input;
    const senderCategory = getSenderCategory(senderEmail);

    // Use clean subject from ThreadContext (no RE:/FW: prefixes)
    const subject = threadContext.cleanSubject.toUpperCase();
    const freshBody = (threadContext.freshBody || bodyText || '').toUpperCase();

    let bestMatch: EmailTypeResult | null = null;

    for (const config of EMAIL_TYPE_CONFIGS) {
      // Check sender category restriction
      if (config.senderCategories && config.senderCategories.length > 0) {
        if (!matchesSenderCategory(senderEmail, config.senderCategories)) {
          continue;
        }
      }

      // Try subject patterns
      const subjectResult = this.matchPatterns(subject, config.subjectPatterns);
      if (subjectResult && subjectResult.confidence >= MIN_CONFIDENCE_THRESHOLD) {
        if (!bestMatch || subjectResult.confidence > bestMatch.confidence) {
          bestMatch = {
            emailType: config.type,
            category: config.category,
            confidence: subjectResult.confidence,
            matchedPatterns: subjectResult.matchedPatterns,
            senderCategory,
          };
        }
      }

      // Try body patterns (if available and no subject match)
      if (config.bodyPatterns && (!bestMatch || bestMatch.confidence < 85)) {
        const bodyResult = this.matchPatterns(freshBody, config.bodyPatterns);
        if (bodyResult && bodyResult.confidence >= MIN_CONFIDENCE_THRESHOLD) {
          // Body patterns are slightly less confident
          const adjustedConfidence = Math.min(bodyResult.confidence - 5, 90);
          if (!bestMatch || adjustedConfidence > bestMatch.confidence) {
            bestMatch = {
              emailType: config.type,
              category: config.category,
              confidence: adjustedConfidence,
              matchedPatterns: bodyResult.matchedPatterns,
              senderCategory,
            };
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Match content against pattern configs.
   */
  private matchPatterns(
    content: string,
    patterns: Array<{
      required: string[];
      optional?: string[];
      exclude?: string[];
      confidence: number;
    }>
  ): { confidence: number; matchedPatterns: string[] } | null {
    let bestResult: { confidence: number; matchedPatterns: string[] } | null = null;

    for (const pattern of patterns) {
      // Check exclusions first
      if (pattern.exclude?.some(ex => content.includes(ex.toUpperCase()))) {
        continue;
      }

      // Check required patterns
      const matchedRequired: string[] = [];
      let allRequired = true;

      for (const req of pattern.required) {
        if (content.includes(req.toUpperCase())) {
          matchedRequired.push(req);
        } else {
          allRequired = false;
          break;
        }
      }

      if (!allRequired || matchedRequired.length === 0) {
        continue;
      }

      // Calculate confidence with optional boosts
      let confidence = pattern.confidence;
      const matchedOptional: string[] = [];

      if (pattern.optional) {
        for (const opt of pattern.optional) {
          if (content.includes(opt.toUpperCase())) {
            matchedOptional.push(opt);
            confidence += 2;
          }
        }
      }

      confidence = Math.min(confidence, 99);

      if (!bestResult || confidence > bestResult.confidence) {
        bestResult = {
          confidence,
          matchedPatterns: [...matchedRequired, ...matchedOptional],
        };
      }
    }

    return bestResult;
  }

  /**
   * Get sender category for an email.
   */
  getSenderCategory(senderEmail: string): SenderCategory {
    return getSenderCategory(senderEmail);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new EmailTypeClassificationService instance.
 */
export function createEmailTypeClassificationService(): EmailTypeClassificationService {
  return new EmailTypeClassificationService();
}
