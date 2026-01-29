/**
 * Constants Module
 *
 * Application-wide constants and threshold configurations.
 *
 * @example
 * import { CONFIDENCE_THRESHOLDS, categorizeConfidence, needsReview } from '@/lib/constants';
 */

export {
  CONFIDENCE_THRESHOLDS,
  type ConfidenceLevel,
  categorizeConfidence,
  needsReview,
} from './confidence-levels';
