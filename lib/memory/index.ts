/**
 * Memory Module
 *
 * AI memory layer for INTDB - replaces Mem0 Cloud with self-hosted solution.
 * Uses existing Supabase pgvector infrastructure for semantic search.
 *
 * Usage:
 * ```typescript
 * import { createMemoryService, addShipmentContext, getMemoryContext } from '@/lib/memory';
 *
 * const memoryService = createMemoryService(supabase);
 *
 * // Add shipment context
 * await addShipmentContext(memoryService, 'ABC123', {
 *   carrier: 'Maersk',
 *   status: 'in_transit',
 *   etd: '2025-02-01',
 * });
 *
 * // Get context for AI prompt
 * const context = await getMemoryContext(memoryService, {
 *   bookingNumber: 'ABC123',
 *   senderDomain: 'maersk.com',
 *   query: 'booking confirmation vessel schedule',
 * });
 * ```
 */

// ============================================================================
// TYPES & SCHEMAS
// ============================================================================

export {
  // Memory scope constants
  MemoryScope,
  // Zod validation schemas
  memoryScopeSchema,
  addMemorySchema,
  searchMemorySchema,
  updateMemorySchema,
  // TypeScript types
  type AddMemoryInput,
  type SearchMemoryInput,
  type UpdateMemoryInput,
  type Memory,
  type MemorySearchResult,
  type MemoryStats,
  type MemoryOperationResult,
  // Constants
  DEFAULT_TTL,
  // Helper functions
  calculateExpiresAt,
  ScopeIdBuilder,
} from './types';

// ============================================================================
// REPOSITORY
// ============================================================================

export {
  MemoryRepository,
  // Custom errors
  MemoryNotFoundError,
  DuplicateMemoryError,
  MemoryRepositoryError,
  // Types
  type CreateMemoryInput,
  type UpdateMemoryInput as RepositoryUpdateInput,
} from './memory-repository';

// ============================================================================
// SERVICE
// ============================================================================

export {
  MemoryService,
  createMemoryService,
  type IMemoryService,
} from './memory-service';

// ============================================================================
// HELPERS
// ============================================================================

export {
  // Shipment helpers
  addShipmentContext,
  type ShipmentContextInput,
  // Customer helpers
  addCustomerIntelligence,
  type CustomerIntelInput,
  // Sender helpers
  addSenderProfile,
  type SenderProfileInput,
  // Error pattern helpers
  addErrorPattern,
  type ErrorPatternInput,
  // Pattern learning helpers
  addPatternLearning,
  type PatternLearningInput,
  // Session helpers
  addSessionContext,
  type SessionContextInput,
  // Thread context helpers
  addThreadContext,
  getThreadContext,
  updateThreadContext,
  type ThreadContextInput,
  // Context retrieval
  getMemoryContext,
  type MemoryContextOptions,
} from './memory-helpers';

// ============================================================================
// MEMORY UPDATER
// ============================================================================

export {
  // Main updater function
  updateMemoryAfterProcessing,
  // Error pattern storage
  storeErrorPattern,
  // Types
  type ProcessingResult,
  type ErrorInfo,
} from './memory-updater';

// ============================================================================
// AI CONTEXT BUILDER
// ============================================================================

export {
  // Main context builder for AI prompt injection
  buildMemoryContextForAI,
  // Lightweight quick context (exact lookups only)
  buildQuickContext,
  // Types
  type AiContextOptions,
  type AiContextResult,
} from './ai-context-builder';
