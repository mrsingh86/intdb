/**
 * Confidence Level Constants
 *
 * These thresholds determine how AI classification confidence scores
 * are categorized and whether they need manual review.
 *
 * Business Rule: Scores below REVIEW_THRESHOLD require human verification
 * to ensure data quality before being used in decision support systems.
 */

export const CONFIDENCE_THRESHOLDS = {
  /** High confidence: >= 85% - Auto-approved for use */
  HIGH: 85,

  /** Medium confidence: 60-84% - Acceptable but may need review */
  MEDIUM: 60,

  /** Low confidence: < 60% - Requires manual review */
  LOW: 0,

  /** Review threshold: < 85% triggers manual review queue */
  REVIEW: 85,
} as const;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Categorize a confidence score into high/medium/low
 */
export function categorizeConfidence(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Check if a score requires manual review
 */
export function needsReview(score: number): boolean {
  return score < CONFIDENCE_THRESHOLDS.REVIEW;
}
