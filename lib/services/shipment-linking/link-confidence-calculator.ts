/**
 * Link Confidence Calculator
 *
 * Calculates confidence scores for email-shipment links.
 *
 * Principles:
 * - Single Responsibility: Only calculates confidence
 * - Configuration Over Code: Scores in constants, not hardcoded in logic
 * - Deep Module: Simple interface, complex scoring logic
 */

import {
  ConfidenceParams,
  ConfidenceResult,
  ConfidenceBreakdown,
  EmailAuthority,
  IdentifierType,
} from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Base scores by identifier type (most reliable to least)
 */
const IDENTIFIER_BASE_SCORES: Record<IdentifierType, number> = {
  booking_number: 95,      // Unique per shipment, most reliable
  bl_number: 90,           // Very reliable, may be set later in lifecycle
  container_number: 75,    // Less reliable, containers can be reused
  reference_number: 50,    // Least reliable, internal references
  manual: 100,             // Manual links always 100
};

/**
 * Authority modifiers (direct carrier = most trusted)
 */
const AUTHORITY_MODIFIERS: Record<EmailAuthority, number> = {
  [EmailAuthority.DIRECT_CARRIER]: 5,
  [EmailAuthority.FORWARDED_CARRIER]: 2,
  [EmailAuthority.INTERNAL]: 0,
  [EmailAuthority.THIRD_PARTY]: -5,
};

/**
 * High-value document types that increase confidence
 */
const HIGH_VALUE_DOC_TYPES = [
  'booking_confirmation',
  'booking_amendment',
  'bill_of_lading',
  'arrival_notice',
  'shipping_instruction',
  'si_submission',
  'departure_notice',
];

/**
 * Thresholds
 */
const AUTO_LINK_THRESHOLD = 85;
const NEEDS_REVIEW_THRESHOLD = 60;

// ============================================================================
// CALCULATOR CLASS
// ============================================================================

export class LinkConfidenceCalculator {
  /**
   * Calculate confidence score for a potential link
   */
  calculate(params: ConfidenceParams): ConfidenceResult {
    const breakdown = this.calculateBreakdown(params);
    const score = this.calculateTotalScore(breakdown);

    return {
      score,
      breakdown,
      auto_link: score >= AUTO_LINK_THRESHOLD,
      needs_review: score >= NEEDS_REVIEW_THRESHOLD && score < AUTO_LINK_THRESHOLD,
    };
  }

  /**
   * Calculate individual score components
   */
  private calculateBreakdown(params: ConfidenceParams): ConfidenceBreakdown {
    const {
      identifier_type,
      email_authority,
      document_type,
      time_proximity_days,
    } = params;

    // Base score from identifier type
    const identifier_score = IDENTIFIER_BASE_SCORES[identifier_type] || 50;

    // Authority modifier
    const authority_score = AUTHORITY_MODIFIERS[email_authority] || 0;

    // Document type modifier
    const document_type_score = this.calculateDocumentTypeScore(document_type);

    // Time proximity modifier (older = lower confidence)
    const time_proximity_score = this.calculateTimeProximityScore(time_proximity_days);

    return {
      identifier_score,
      authority_score,
      document_type_score,
      time_proximity_score,
    };
  }

  /**
   * Calculate document type score
   */
  private calculateDocumentTypeScore(documentType?: string): number {
    if (!documentType) return 0;
    return HIGH_VALUE_DOC_TYPES.includes(documentType) ? 5 : 0;
  }

  /**
   * Calculate time proximity score
   * Older emails get lower scores (max penalty -12)
   * Reduced from -5/week to -3/week to not penalize legitimate late emails
   * (invoices, amendments, etc. often arrive weeks after shipment creation)
   */
  private calculateTimeProximityScore(days?: number): number {
    if (days === undefined || days === null) return 0;

    // Within same week: no penalty
    if (days <= 7) return 0;

    // Each additional week: -3 penalty (reduced from -5)
    const weeksPenalty = Math.floor(days / 7) - 1;
    return Math.max(-12, -3 * weeksPenalty);
  }

  /**
   * Sum all scores, clamped to 0-100
   */
  private calculateTotalScore(breakdown: ConfidenceBreakdown): number {
    const total =
      breakdown.identifier_score +
      breakdown.authority_score +
      breakdown.document_type_score +
      breakdown.time_proximity_score;

    return Math.max(0, Math.min(100, total));
  }
}

// Export singleton instance
export const linkConfidenceCalculator = new LinkConfidenceCalculator();
