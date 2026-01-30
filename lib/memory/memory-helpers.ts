/**
 * Memory Helpers
 *
 * INTDB-specific helper functions for common memory operations.
 * Provides convenient wrappers for shipment, customer, sender, and error memories.
 *
 * Following CLAUDE.md principles:
 * - Small Functions (Principle #17) - focused helpers
 * - DRY (Principle #2) - reusable patterns
 * - Function Arguments 0-3 (Principle #18) - use objects for complex inputs
 */

import { IMemoryService } from './memory-service';
import { MemoryScope, Memory, ScopeIdBuilder } from './types';

// ============================================================================
// SHIPMENT CONTEXT HELPERS
// ============================================================================

export interface ShipmentContextInput {
  customer?: string;
  carrier?: string;
  status?: string;
  etd?: string;
  eta?: string;
  vessel?: string;
  voyage?: string;
  pol?: string; // Port of Loading
  pod?: string; // Port of Discharge
  containers?: string[];
  issues?: string[];
  lastUpdate?: string;
}

/**
 * Add or update shipment context memory
 */
export async function addShipmentContext(
  memoryService: IMemoryService,
  bookingNumber: string,
  context: ShipmentContextInput
): Promise<Memory> {
  const content = buildShipmentContent(bookingNumber, context);
  const tags = buildShipmentTags(context);

  return memoryService.add({
    scope: MemoryScope.SHIPMENT,
    scopeId: ScopeIdBuilder.shipment(bookingNumber),
    content,
    metadata: { bookingNumber, ...context },
    tags,
    source: 'chronicle',
  });
}

function buildShipmentContent(
  bookingNumber: string,
  context: ShipmentContextInput
): string {
  const lines = [`Shipment ${bookingNumber}:`];

  if (context.customer) lines.push(`Customer: ${context.customer}`);
  if (context.carrier) lines.push(`Carrier: ${context.carrier}`);
  if (context.status) lines.push(`Status: ${context.status}`);
  if (context.vessel) lines.push(`Vessel: ${context.vessel}`);
  if (context.voyage) lines.push(`Voyage: ${context.voyage}`);
  if (context.pol && context.pod) lines.push(`Route: ${context.pol} → ${context.pod}`);
  if (context.etd) lines.push(`ETD: ${context.etd}`);
  if (context.eta) lines.push(`ETA: ${context.eta}`);
  if (context.containers?.length) {
    lines.push(`Containers: ${context.containers.join(', ')}`);
  }
  if (context.issues?.length) {
    lines.push(`Issues: ${context.issues.join(', ')}`);
  }
  if (context.lastUpdate) lines.push(`Last update: ${context.lastUpdate}`);

  return lines.join('\n');
}

function buildShipmentTags(context: ShipmentContextInput): string[] {
  const tags: string[] = [];
  if (context.carrier) tags.push(context.carrier.toLowerCase());
  if (context.status) tags.push(context.status.toLowerCase());
  if (context.pol) tags.push(context.pol.toLowerCase());
  if (context.pod) tags.push(context.pod.toLowerCase());
  return tags;
}

// ============================================================================
// CUSTOMER INTELLIGENCE HELPERS
// ============================================================================

export interface CustomerIntelInput {
  name: string;
  preferences?: string[];
  communicationStyle?: 'formal' | 'casual' | 'technical';
  responsePattern?: 'fast' | 'normal' | 'slow';
  pastIssues?: string[];
  preferredCarriers?: string[];
  commonRoutes?: string[];
  notes?: string;
}

/**
 * Add or update customer intelligence memory
 */
export async function addCustomerIntelligence(
  memoryService: IMemoryService,
  customerId: string,
  intel: CustomerIntelInput
): Promise<Memory> {
  const content = buildCustomerContent(customerId, intel);

  return memoryService.add({
    scope: MemoryScope.CUSTOMER,
    scopeId: ScopeIdBuilder.customer(customerId),
    content,
    metadata: { customerId, ...intel },
    tags: intel.preferredCarriers?.map((c) => c.toLowerCase()) || [],
    source: 'chronicle',
  });
}

function buildCustomerContent(
  customerId: string,
  intel: CustomerIntelInput
): string {
  const lines = [`Customer ${intel.name} (${customerId}):`];

  if (intel.communicationStyle) {
    lines.push(`Communication style: ${intel.communicationStyle}`);
  }
  if (intel.responsePattern) {
    lines.push(`Response pattern: ${intel.responsePattern}`);
  }
  if (intel.preferences?.length) {
    lines.push(`Preferences: ${intel.preferences.join(', ')}`);
  }
  if (intel.preferredCarriers?.length) {
    lines.push(`Preferred carriers: ${intel.preferredCarriers.join(', ')}`);
  }
  if (intel.commonRoutes?.length) {
    lines.push(`Common routes: ${intel.commonRoutes.join(', ')}`);
  }
  if (intel.pastIssues?.length) {
    lines.push(`Past issues: ${intel.pastIssues.join(', ')}`);
  }
  if (intel.notes) {
    lines.push(`Notes: ${intel.notes}`);
  }

  return lines.join('\n');
}

// ============================================================================
// SENDER PROFILE HELPERS
// ============================================================================

export interface SenderProfileInput {
  organization?: string;
  partyType?: 'carrier' | 'customer' | 'broker' | 'trucker' | 'terminal' | 'unknown';
  commonDocTypes?: string[];
  dateFormat?: string; // e.g., "DD-MMM-YYYY" or "YYYY/MM/DD"
  timeZone?: string;
  reliability?: 'excellent' | 'good' | 'normal' | 'unreliable';
  avgResponseHours?: number;
  notes?: string;
}

/**
 * Add or update sender profile memory
 */
export async function addSenderProfile(
  memoryService: IMemoryService,
  senderDomain: string,
  profile: SenderProfileInput
): Promise<Memory> {
  const content = buildSenderContent(senderDomain, profile);

  return memoryService.add({
    scope: MemoryScope.SENDER,
    scopeId: ScopeIdBuilder.sender(senderDomain),
    content,
    metadata: { senderDomain, ...profile },
    tags: profile.commonDocTypes?.map((d) => d.toLowerCase()) || [],
    source: 'chronicle',
  });
}

function buildSenderContent(
  senderDomain: string,
  profile: SenderProfileInput
): string {
  const lines = [`Sender ${senderDomain}:`];

  if (profile.organization) lines.push(`Organization: ${profile.organization}`);
  if (profile.partyType) lines.push(`Party type: ${profile.partyType}`);
  if (profile.reliability) lines.push(`Reliability: ${profile.reliability}`);
  if (profile.avgResponseHours) {
    lines.push(`Avg response time: ${profile.avgResponseHours} hours`);
  }
  if (profile.commonDocTypes?.length) {
    lines.push(`Common doc types: ${profile.commonDocTypes.join(', ')}`);
  }
  if (profile.dateFormat) lines.push(`Date format: ${profile.dateFormat}`);
  if (profile.timeZone) lines.push(`Time zone: ${profile.timeZone}`);
  if (profile.notes) lines.push(`Notes: ${profile.notes}`);

  return lines.join('\n');
}

// ============================================================================
// ERROR PATTERN HELPERS
// ============================================================================

export interface ErrorPatternInput {
  description: string;
  rootCause: string;
  solution: string;
  prevention?: string;
  carrier?: string;
  docType?: string;
  frequency?: 'rare' | 'occasional' | 'frequent';
}

/**
 * Add error pattern memory for prevention
 */
export async function addErrorPattern(
  memoryService: IMemoryService,
  errorType: string,
  pattern: ErrorPatternInput
): Promise<Memory> {
  const content = buildErrorContent(errorType, pattern);
  const tags = buildErrorTags(pattern);

  return memoryService.add({
    scope: MemoryScope.ERROR,
    scopeId: ScopeIdBuilder.error(errorType),
    content,
    metadata: { errorType, ...pattern },
    tags,
    source: 'chronicle',
  });
}

function buildErrorContent(
  errorType: string,
  pattern: ErrorPatternInput
): string {
  const lines = [`Error pattern (${errorType}):`];

  lines.push(`Description: ${pattern.description}`);
  lines.push(`Root cause: ${pattern.rootCause}`);
  lines.push(`Solution: ${pattern.solution}`);

  if (pattern.prevention) lines.push(`Prevention: ${pattern.prevention}`);
  if (pattern.frequency) lines.push(`Frequency: ${pattern.frequency}`);

  return lines.join('\n');
}

function buildErrorTags(pattern: ErrorPatternInput): string[] {
  const tags: string[] = [];
  if (pattern.carrier) tags.push(pattern.carrier.toLowerCase());
  if (pattern.docType) tags.push(pattern.docType.toLowerCase());
  if (pattern.frequency) tags.push(pattern.frequency);
  return tags;
}

// ============================================================================
// PATTERN LEARNING HELPERS
// ============================================================================

export interface PatternLearningInput {
  documentType: string;
  subjectPattern?: string;
  senderPattern?: string;
  bodyPattern?: string;
  confidence: number;
  extractedFields: string[];
}

/**
 * Add learned pattern memory
 */
export async function addPatternLearning(
  memoryService: IMemoryService,
  carrier: string,
  pattern: PatternLearningInput
): Promise<Memory> {
  const content = buildPatternContent(carrier, pattern);

  return memoryService.add({
    scope: MemoryScope.PATTERN,
    scopeId: ScopeIdBuilder.pattern(carrier),
    content,
    metadata: { carrier, ...pattern },
    tags: [carrier.toLowerCase(), pattern.documentType.toLowerCase()],
    source: 'chronicle',
  });
}

function buildPatternContent(
  carrier: string,
  pattern: PatternLearningInput
): string {
  const lines = [`Pattern for ${carrier}:`];

  lines.push(`Document type: ${pattern.documentType}`);
  lines.push(`Confidence: ${pattern.confidence}%`);

  if (pattern.subjectPattern) {
    lines.push(`Subject pattern: "${pattern.subjectPattern}"`);
  }
  if (pattern.senderPattern) {
    lines.push(`Sender pattern: "${pattern.senderPattern}"`);
  }
  if (pattern.bodyPattern) {
    lines.push(`Body pattern: "${pattern.bodyPattern}"`);
  }
  if (pattern.extractedFields.length) {
    lines.push(`Extracted fields: ${pattern.extractedFields.join(', ')}`);
  }

  return lines.join('\n');
}

// ============================================================================
// CONTEXT RETRIEVAL HELPERS
// ============================================================================

export interface MemoryContextOptions {
  bookingNumber?: string;
  customerId?: string;
  senderDomain?: string;
  carrier?: string;
  query?: string;
  limit?: number;
}

/**
 * Get combined memory context for AI prompt injection
 * Fetches relevant memories from multiple scopes in parallel
 */
export async function getMemoryContext(
  memoryService: IMemoryService,
  options: MemoryContextOptions
): Promise<string> {
  const allMemories: Memory[] = [];
  const promises: Promise<Memory[]>[] = [];

  // Fetch scope-specific memories
  if (options.bookingNumber) {
    promises.push(
      memoryService.getByScope(
        MemoryScope.SHIPMENT,
        ScopeIdBuilder.shipment(options.bookingNumber)
      )
    );
  }

  if (options.customerId) {
    promises.push(
      memoryService.getByScope(
        MemoryScope.CUSTOMER,
        ScopeIdBuilder.customer(options.customerId)
      )
    );
  }

  if (options.senderDomain) {
    promises.push(
      memoryService.getByScope(
        MemoryScope.SENDER,
        ScopeIdBuilder.sender(options.senderDomain)
      )
    );
  }

  // Semantic search for related memories
  if (options.query) {
    promises.push(
      memoryService
        .search({
          query: options.query,
          tags: options.carrier ? [options.carrier.toLowerCase()] : undefined,
          limit: options.limit || 3,
          threshold: 0.5,
        })
        .then((r) => r.memories)
    );
  }

  // Wait for all fetches
  const results = await Promise.all(promises);
  results.forEach((mems) => allMemories.push(...mems));

  // Deduplicate by ID
  const uniqueMemories = deduplicateMemories(allMemories);

  // Build prompt section
  return memoryService.buildPromptSection(uniqueMemories);
}

/**
 * Remove duplicate memories by ID
 */
function deduplicateMemories(memories: Memory[]): Memory[] {
  const seen = new Set<string>();
  return memories.filter((mem) => {
    if (seen.has(mem.id)) {
      return false;
    }
    seen.add(mem.id);
    return true;
  });
}

// ============================================================================
// SESSION MEMORY HELPERS
// ============================================================================

export interface SessionContextInput {
  processedCount: number;
  successCount: number;
  errorCount: number;
  errors?: string[];
  newPatterns?: string[];
  notes?: string;
}

/**
 * Add cron run session context
 */
export async function addSessionContext(
  memoryService: IMemoryService,
  sessionId: string,
  context: SessionContextInput
): Promise<Memory> {
  const content = buildSessionContent(sessionId, context);

  return memoryService.add({
    scope: MemoryScope.SESSION,
    scopeId: ScopeIdBuilder.session(sessionId),
    content,
    metadata: { sessionId, ...context },
    source: 'cron',
  });
}

function buildSessionContent(
  sessionId: string,
  context: SessionContextInput
): string {
  const lines = [`Session ${sessionId}:`];

  lines.push(`Processed: ${context.processedCount} emails`);
  lines.push(`Success: ${context.successCount}`);
  lines.push(`Errors: ${context.errorCount}`);

  if (context.errors?.length) {
    lines.push(`Error types: ${context.errors.join(', ')}`);
  }
  if (context.newPatterns?.length) {
    lines.push(`New patterns: ${context.newPatterns.join(', ')}`);
  }
  if (context.notes) {
    lines.push(`Notes: ${context.notes}`);
  }

  return lines.join('\n');
}

// ============================================================================
// THREAD CONTEXT HELPERS
// ============================================================================

export interface ThreadContextInput {
  threadId: string;
  bookingNumber?: string;
  emailCount: number;
  documentTypes: string[];
  lastSummary: string;
  participants: string[];
  lastUpdated: string;
}

/**
 * Add or update thread context memory
 * Used for caching thread information to avoid rebuilding each time
 */
export async function addThreadContext(
  memoryService: IMemoryService,
  threadId: string,
  context: ThreadContextInput
): Promise<Memory> {
  const content = buildThreadContent(threadId, context);

  return memoryService.add({
    scope: MemoryScope.SESSION,
    scopeId: `thread-${threadId}`,
    content,
    metadata: context as unknown as Record<string, unknown>,
    ttlDays: 30, // Keep thread context for 30 days
    source: 'chronicle',
  });
}

function buildThreadContent(
  threadId: string,
  context: ThreadContextInput
): string {
  const lines = [`Thread ${threadId}:`];

  if (context.bookingNumber) lines.push(`Booking: ${context.bookingNumber}`);
  lines.push(`Emails: ${context.emailCount}`);
  if (context.documentTypes.length > 0) {
    lines.push(`Document flow: ${context.documentTypes.join(' → ')}`);
  }
  if (context.participants.length > 0) {
    // Deduplicate participants
    const uniqueParticipants = [...new Set(context.participants)];
    lines.push(`Participants: ${uniqueParticipants.slice(0, 5).join(', ')}`);
  }
  if (context.lastSummary) lines.push(`Latest: ${context.lastSummary}`);

  return lines.join('\n');
}

/**
 * Get cached thread context
 * Returns null if not found (doesn't throw)
 */
export async function getThreadContext(
  memoryService: IMemoryService,
  threadId: string
): Promise<Memory | null> {
  try {
    const memories = await memoryService.getByScope(
      MemoryScope.SESSION,
      `thread-${threadId}`
    );
    return memories.length > 0 ? memories[0] : null;
  } catch {
    return null;
  }
}

/**
 * Update existing thread context with new email info
 * Merges new data with existing context
 */
export async function updateThreadContext(
  memoryService: IMemoryService,
  threadId: string,
  update: {
    documentType?: string;
    summary?: string;
    participant?: string;
    bookingNumber?: string;
  }
): Promise<Memory | null> {
  const existing = await getThreadContext(memoryService, threadId);

  const currentMetadata = existing?.metadata || {};
  const documentTypes = [
    ...((currentMetadata.documentTypes as string[]) || []),
    update.documentType,
  ].filter(Boolean) as string[];
  const participants = [
    ...((currentMetadata.participants as string[]) || []),
    update.participant,
  ].filter(Boolean) as string[];

  const newContext: ThreadContextInput = {
    threadId,
    bookingNumber: update.bookingNumber || (currentMetadata.bookingNumber as string),
    emailCount: ((currentMetadata.emailCount as number) || 0) + 1,
    documentTypes,
    lastSummary: update.summary || (currentMetadata.lastSummary as string) || '',
    participants,
    lastUpdated: new Date().toISOString(),
  };

  return addThreadContext(memoryService, threadId, newContext);
}
