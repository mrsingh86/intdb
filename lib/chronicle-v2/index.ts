/**
 * Chronicle V2 Library
 *
 * Clean exports for the attention-first shipment dashboard.
 */

// Types
export * from './types';

// Constants
export * from './constants';

// Attention scoring
export {
  calculateAttentionScore,
  calculateAttentionWithTier,
  getCutoffStatus,
  findNearestCutoff,
  daysBetween,
  buildAttentionComponents,
} from './attention-score';

// Services (Chain of Thought)
export {
  NarrativeChainService,
  StakeholderAnalysisService,
  ShipmentStoryService,
  HaikuSummaryService,
} from './services';
