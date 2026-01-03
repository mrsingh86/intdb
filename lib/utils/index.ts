/**
 * Utils Index
 *
 * Central export point for shared utility functions.
 * These are stateless helpers used across multiple modules.
 */

// ============================================================================
// Date Parsing Utilities
// ============================================================================

export {
  parseEntityDate,
  parseFirstValidDate,
  parseEntityDateTime,
} from './date-parser';

// ============================================================================
// Supabase Pagination Utilities
// ============================================================================

export {
  getAllUniqueValues,
  getAllRows,
  getGroupedCounts,
  getTotalCount,
  getAllRowsWithFilter,
  getRowsByIds,
} from './supabase-pagination';

// ============================================================================
// Container Validation Utilities
// ============================================================================

export {
  isValidContainerNumber,
  normalizeContainerNumber,
  sanitizeContainerNumber,
  isBookingNumberFormat,
} from './container-validator';

// ============================================================================
// Document Grouping Utilities
// ============================================================================

export {
  extractSenderDisplayName,
  deduplicateByMessageId,
  groupDocumentsBySenderAndType,
  sortGroupsByLatestDate,
} from './document-grouping';

export type {
  DocumentWithFlow,
  GroupedDocument,
} from './document-grouping';
