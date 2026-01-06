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
 * Email type confidence modifiers
 * Status updates and confirmations are highly relevant to shipments
 */
const EMAIL_TYPE_SCORES: Record<string, number> = {
  // High value - directly shipment related
  departure_update: 5,
  arrival_update: 5,
  stuffing_update: 5,
  gate_in_update: 5,
  handover_update: 4,
  transit_update: 4,
  delivery_complete: 5,
  clearance_complete: 4,

  // Confirmations and approvals
  approval_granted: 4,
  approval_request: 3,
  payment_confirmation: 3,

  // Document shares
  document_share: 3,
  pre_alert: 3,

  // Scheduling
  delivery_scheduling: 3,
  pickup_scheduling: 3,

  // Neutral
  acknowledgement: 1,
  query: 0,
  reminder: 0,

  // Lower value - less shipment specific
  quote_request: -2,
  quote_response: -2,
  general_correspondence: -3,
  unknown: -5,
};

/**
 * Sender category confidence modifiers
 * Carriers and known stakeholders are more trustworthy
 */
const SENDER_CATEGORY_SCORES: Record<string, number> = {
  carrier: 5,           // Direct from shipping line
  cha_india: 3,         // Known customs agent
  customs_broker_us: 3, // Known US broker
  trucker: 2,           // Known trucking company
  warehouse: 2,         // Known warehouse
  partner: 2,           // Known logistics partner
  shipper: 1,           // Known shipper
  consignee: 1,         // Known consignee
  intoglo: 0,           // Internal - neutral
  platform: 0,          // Platform notifications
  unknown: -3,          // Unknown sender
};

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
      email_type,
      sender_category,
    } = params;

    // Base score from identifier type
    const identifier_score = IDENTIFIER_BASE_SCORES[identifier_type] || 50;

    // Authority modifier
    const authority_score = AUTHORITY_MODIFIERS[email_authority] || 0;

    // Document type modifier
    const document_type_score = this.calculateDocumentTypeScore(document_type);

    // Time proximity modifier (older = lower confidence)
    const time_proximity_score = this.calculateTimeProximityScore(time_proximity_days);

    // Email type modifier (status updates score higher)
    const email_type_score = this.calculateEmailTypeScore(email_type);

    // Sender category modifier (known stakeholders score higher)
    const sender_category_score = this.calculateSenderCategoryScore(sender_category);

    return {
      identifier_score,
      authority_score,
      document_type_score,
      time_proximity_score,
      email_type_score,
      sender_category_score,
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
   * Calculate email type score
   * Status updates and confirmations are highly relevant to shipments
   */
  private calculateEmailTypeScore(emailType?: string): number {
    if (!emailType) return 0;
    return EMAIL_TYPE_SCORES[emailType] ?? 0;
  }

  /**
   * Calculate sender category score
   * Known stakeholders (carriers, CHAs) are more trustworthy
   */
  private calculateSenderCategoryScore(senderCategory?: string): number {
    if (!senderCategory) return 0;
    return SENDER_CATEGORY_SCORES[senderCategory] ?? 0;
  }

  /**
   * Sum all scores, clamped to 0-100
   */
  private calculateTotalScore(breakdown: ConfidenceBreakdown): number {
    const total =
      breakdown.identifier_score +
      breakdown.authority_score +
      breakdown.document_type_score +
      breakdown.time_proximity_score +
      breakdown.email_type_score +
      breakdown.sender_category_score;

    return Math.max(0, Math.min(100, total));
  }
}

// Export singleton instance
export const linkConfidenceCalculator = new LinkConfidenceCalculator();
