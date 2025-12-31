/**
 * Email Filtering Service
 *
 * Handles complex client-side filtering logic for emails.
 * Removes magic numbers, uses configuration constants.
 *
 * Principles:
 * - Configuration Over Code: Uses CONFIDENCE_THRESHOLDS constants
 * - Single Responsibility: Only filtering logic
 * - Small Functions: Each function < 20 lines
 */

import { EmailWithIntelligence, DocumentType } from '@/types/email-intelligence';
import { CONFIDENCE_THRESHOLDS } from '../constants/confidence-levels';

export interface FilterCriteria {
  documentType?: string[];
  confidenceLevel?: string[];
  needsReview?: boolean;
}

export class EmailFilteringService {
  /**
   * Apply all filters to emails
   */
  filterEmails(
    emails: EmailWithIntelligence[],
    criteria: FilterCriteria
  ): EmailWithIntelligence[] {
    let filtered = emails;

    if (criteria.documentType) {
      filtered = this.filterByDocumentType(filtered, criteria.documentType);
    }

    if (criteria.confidenceLevel) {
      filtered = this.filterByConfidenceLevel(filtered, criteria.confidenceLevel);
    }

    if (criteria.needsReview) {
      filtered = this.filterByNeedsReview(filtered);
    }

    return filtered;
  }

  /**
   * Filter by document type
   */
  private filterByDocumentType(
    emails: EmailWithIntelligence[],
    types: string[]
  ): EmailWithIntelligence[] {
    return emails.filter(email =>
      email.classification && types.includes(email.classification.document_type)
    );
  }

  /**
   * Filter by confidence level (high/medium/low)
   *
   * Uses CONFIDENCE_THRESHOLDS instead of magic numbers
   */
  private filterByConfidenceLevel(
    emails: EmailWithIntelligence[],
    levels: string[]
  ): EmailWithIntelligence[] {
    return emails.filter(email => {
      if (!email.classification) return false;

      const score = email.classification.confidence_score;
      return this.matchesConfidenceLevel(score, levels);
    });
  }

  /**
   * Check if score matches any of the requested confidence levels
   */
  private matchesConfidenceLevel(score: number, levels: string[]): boolean {
    for (const level of levels) {
      if (level === 'high' && score >= CONFIDENCE_THRESHOLDS.HIGH) return true;
      if (level === 'medium' && score >= CONFIDENCE_THRESHOLDS.MEDIUM && score < CONFIDENCE_THRESHOLDS.HIGH) return true;
      if (level === 'low' && score < CONFIDENCE_THRESHOLDS.MEDIUM) return true;
    }
    return false;
  }

  /**
   * Filter emails that need manual review
   *
   * Business rule: Scores below REVIEW threshold require human verification
   */
  private filterByNeedsReview(
    emails: EmailWithIntelligence[]
  ): EmailWithIntelligence[] {
    return emails.filter(email =>
      email.classification &&
      email.classification.confidence_score < CONFIDENCE_THRESHOLDS.REVIEW
    );
  }
}
