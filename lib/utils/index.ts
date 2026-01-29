/**
 * Business Utilities Module
 *
 * Central export point for shared utility functions.
 * These are STATELESS helpers used across multiple modules.
 *
 * IMPORTANT: This is different from /utils/ which contains stateful
 * infrastructure clients (Supabase, Gmail, Logger).
 *
 * @example
 * // Business utilities (this folder)
 * import { parseEntityDate, isValidContainerNumber } from '@/lib/utils';
 *
 * // Infrastructure clients (/utils/)
 * import { createServerClient, logger } from '@/utils';
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
