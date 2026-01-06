/**
 * Document Content Classification Service
 *
 * Pure, focused service for classifying documents by PDF content.
 * Uses deterministic content markers from DOCUMENT_TYPE_CONFIGS.
 *
 * Single Responsibility: Classify documents by content markers only.
 * - No direction detection
 * - No workflow state mapping
 * - No email metadata (subject, sender)
 * - No AI fallback
 * - No database operations
 *
 * Deep Module: Simple interface, complex implementation.
 * Input: { pdfContent: string }
 * Output: { documentType, confidence, matchedMarkers, category } | null
 */

import {
  DOCUMENT_TYPE_CONFIGS,
  DocumentCategory,
} from '../../config/content-classification-config';

// =============================================================================
// TYPES
// =============================================================================

export interface DocumentContentInput {
  pdfContent: string;
}

export interface DocumentContentResult {
  documentType: string;
  confidence: number;
  matchedMarkers: string[];
  category: DocumentCategory;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_CONTENT_LENGTH = 50;
const MIN_CONFIDENCE_THRESHOLD = 70;
const MAX_CONFIDENCE = 99;
const OPTIONAL_MARKER_BOOST = 2;

// =============================================================================
// SERVICE
// =============================================================================

export class DocumentContentClassificationService {
  /**
   * Classify a document by its PDF content.
   *
   * @param input - Document content to classify
   * @returns Classification result or null if no confident match
   */
  classify(input: DocumentContentInput): DocumentContentResult | null {
    if (!input.pdfContent || input.pdfContent.length < MIN_CONTENT_LENGTH) {
      return null;
    }

    const bestMatch = this.findBestMatch(input.pdfContent);

    if (!bestMatch || bestMatch.confidence < MIN_CONFIDENCE_THRESHOLD) {
      return null;
    }

    return bestMatch;
  }

  /**
   * Find the best matching document type for the given content.
   */
  private findBestMatch(content: string): DocumentContentResult | null {
    const textUpper = content.toUpperCase();
    let bestMatch: DocumentContentResult | null = null;

    for (const config of DOCUMENT_TYPE_CONFIGS) {
      const result = this.matchConfig(textUpper, config);

      if (result && (!bestMatch || result.confidence > bestMatch.confidence)) {
        bestMatch = result;
      }
    }

    return bestMatch;
  }

  /**
   * Match content against a single document type config.
   */
  private matchConfig(
    textUpper: string,
    config: { type: string; category: DocumentCategory; contentMarkers: Array<{ required: string[]; optional?: string[]; exclude?: string[]; confidence: number }> }
  ): DocumentContentResult | null {
    let bestResult: DocumentContentResult | null = null;

    for (const marker of config.contentMarkers) {
      const result = this.matchMarker(textUpper, marker, config.type, config.category);

      if (result && (!bestResult || result.confidence > bestResult.confidence)) {
        bestResult = result;
      }
    }

    return bestResult;
  }

  /**
   * Match content against a single content marker.
   */
  private matchMarker(
    textUpper: string,
    marker: { required: string[]; optional?: string[]; exclude?: string[]; confidence: number },
    documentType: string,
    category: DocumentCategory
  ): DocumentContentResult | null {
    // Check exclusions first
    if (this.hasExclusions(textUpper, marker.exclude)) {
      return null;
    }

    // Check required markers
    const matchedRequired = this.matchRequired(textUpper, marker.required);
    if (matchedRequired.length === 0 || matchedRequired.length !== marker.required.length) {
      return null;
    }

    // Calculate confidence with optional boosts
    const { confidence, matchedOptional } = this.calculateConfidence(
      textUpper,
      marker.confidence,
      marker.optional
    );

    return {
      documentType,
      confidence,
      matchedMarkers: [...matchedRequired, ...matchedOptional],
      category,
    };
  }

  /**
   * Check if content contains any exclusion patterns.
   */
  private hasExclusions(textUpper: string, exclude?: string[]): boolean {
    if (!exclude) return false;
    return exclude.some(ex => textUpper.includes(ex.toUpperCase()));
  }

  /**
   * Match required markers and return matched ones.
   */
  private matchRequired(textUpper: string, required: string[]): string[] {
    const matched: string[] = [];

    for (const req of required) {
      if (textUpper.includes(req.toUpperCase())) {
        matched.push(req);
      } else {
        // All required must match - early return
        return [];
      }
    }

    return matched;
  }

  /**
   * Calculate final confidence with optional marker boosts.
   */
  private calculateConfidence(
    textUpper: string,
    baseConfidence: number,
    optional?: string[]
  ): { confidence: number; matchedOptional: string[] } {
    let confidence = baseConfidence;
    const matchedOptional: string[] = [];

    if (optional) {
      for (const opt of optional) {
        if (textUpper.includes(opt.toUpperCase())) {
          matchedOptional.push(opt);
          confidence += OPTIONAL_MARKER_BOOST;
        }
      }
    }

    return {
      confidence: Math.min(confidence, MAX_CONFIDENCE),
      matchedOptional,
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new DocumentContentClassificationService instance.
 */
export function createDocumentContentClassificationService(): DocumentContentClassificationService {
  return new DocumentContentClassificationService();
}
