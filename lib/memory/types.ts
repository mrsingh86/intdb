/**
 * Memory Layer Types & Validation
 *
 * Defines types, Zod schemas, and constants for the AI memory system.
 *
 * Following CLAUDE.md principles:
 * - Define Errors Out of Existence (Principle #13) - TypeScript enums
 * - Zod validation for runtime safety
 * - Clear domain types
 */

import { z } from 'zod';

// ============================================================================
// MEMORY SCOPES
// ============================================================================

/**
 * Memory scopes determine isolation and TTL behavior
 */
export const MemoryScope = {
  /** User preferences, coding style - never expires */
  GLOBAL: 'global',
  /** Project-specific context, tech stack - never expires */
  PROJECT: 'project',
  /** Agent capabilities, usage rules - never expires */
  AGENT: 'agent',
  /** Shipment history, issues - 90 days TTL */
  SHIPMENT: 'shipment',
  /** Customer preferences, patterns - 180 days TTL */
  CUSTOMER: 'customer',
  /** Sender behavior, date formats - 180 days TTL */
  SENDER: 'sender',
  /** Learned extraction patterns - never expires */
  PATTERN: 'pattern',
  /** Error prevention patterns - 90 days TTL */
  ERROR: 'error',
  /** Cron run context - 7 days TTL */
  SESSION: 'session',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Valid memory scopes
 */
export const memoryScopeSchema = z.enum([
  'global',
  'project',
  'agent',
  'shipment',
  'customer',
  'sender',
  'pattern',
  'error',
  'session',
]);

/**
 * Input schema for adding memories
 */
export const addMemorySchema = z.object({
  scope: memoryScopeSchema,
  scopeId: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  summary: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  ttlDays: z.number().positive().max(365).optional(),
  source: z.string().max(50).optional(),
  sourceReference: z.string().max(200).optional(),
});

/**
 * Input schema for searching memories
 */
export const searchMemorySchema = z.object({
  query: z.string().min(1).max(1000),
  scope: memoryScopeSchema.optional(),
  scopeId: z.string().max(200).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().min(1).max(20).default(5),
  threshold: z.number().min(0).max(1).default(0.5),
});

/**
 * Input schema for updating memories
 */
export const updateMemorySchema = z.object({
  memoryId: z.string().uuid(),
  content: z.string().min(1).max(10000).optional(),
  summary: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type AddMemoryInput = z.infer<typeof addMemorySchema>;
export type SearchMemoryInput = z.infer<typeof searchMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

// ============================================================================
// DOMAIN TYPES
// ============================================================================

/**
 * Memory record from database
 */
export interface Memory {
  id: string;
  scope: MemoryScope;
  scopeId: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  version: number;
  expiresAt: Date | null;
  isActive: boolean;
  source: string | null;
  sourceReference: string | null;
  similarity?: number; // Only present in search results
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of memory search operation
 */
export interface MemorySearchResult {
  memories: Memory[];
  query: string;
  scope?: MemoryScope;
  scopeId?: string;
  totalFound: number;
}

/**
 * Memory statistics by scope
 */
export interface MemoryStats {
  scope: MemoryScope;
  totalCount: number;
  activeCount: number;
  avgContentLength: number;
  oldestMemory: Date | null;
  newestMemory: Date | null;
}

/**
 * Result of memory operation
 */
export interface MemoryOperationResult {
  success: boolean;
  memoryId?: string;
  error?: string;
}

// ============================================================================
// DEFAULT TTL BY SCOPE
// ============================================================================

/**
 * Default time-to-live in days for each scope
 * null = never expires
 */
export const DEFAULT_TTL: Record<MemoryScope, number | null> = {
  global: null, // Never expires
  project: null, // Never expires
  agent: null, // Never expires
  shipment: 90, // 3 months
  customer: 180, // 6 months
  sender: 180, // 6 months
  pattern: null, // Never expires
  error: 90, // 3 months
  session: 7, // 1 week
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate expiration date based on scope and optional override
 */
export function calculateExpiresAt(
  scope: MemoryScope,
  ttlDaysOverride?: number
): Date | null {
  const ttlDays = ttlDaysOverride ?? DEFAULT_TTL[scope];

  if (ttlDays === null) {
    return null;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  return expiresAt;
}

/**
 * Build a standard scope ID for common use cases
 */
export const ScopeIdBuilder = {
  global: (userId: string) => `user-${userId}`,
  project: (projectName: string) => `project-${projectName}`,
  agent: (agentName: string) => `agent-${agentName}`,
  shipment: (bookingNumber: string) => `shipment-${bookingNumber}`,
  customer: (customerId: string) => `customer-${customerId}`,
  sender: (domain: string) => `sender-${domain}`,
  pattern: (carrier: string) => `pattern-${carrier}`,
  error: (errorType: string) => `error-${errorType}`,
  session: (sessionId: string) => `session-${sessionId}`,
} as const;
