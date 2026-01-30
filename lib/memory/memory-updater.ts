/**
 * Memory Updater
 *
 * Automatically updates memory after email processing.
 * Learns patterns, updates sender profiles, tracks shipment context.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only memory updates
 * - Small Functions (Principle #17) - focused helpers
 * - Fail Fast (Principle #12) - graceful degradation
 */

import { IMemoryService } from './memory-service';
import { MemoryScope, ScopeIdBuilder } from './types';

// ============================================================================
// TYPES
// ============================================================================

export interface ProcessingResult {
  email: {
    subject: string;
    senderEmail: string;
    senderDomain: string;
    bodyPreview: string;
  };
  analysis: {
    document_type?: string;
    booking_number?: string;
    mbl_number?: string;
    etd?: string;
    eta?: string;
    vessel_name?: string;
    summary?: string;
    from_party?: string;
  };
  confidence: number;
  processingTime: number;
  patternMatched?: boolean;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Update memory after successful email processing
 *
 * Runs all updates in parallel for performance.
 * Uses Promise.allSettled to ensure one failure doesn't block others.
 */
export async function updateMemoryAfterProcessing(
  memoryService: IMemoryService,
  result: ProcessingResult
): Promise<{ updated: string[]; errors: string[] }> {
  const updated: string[] = [];
  const errors: string[] = [];
  const promises: Promise<unknown>[] = [];

  // 1. Always update sender profile
  promises.push(
    updateSenderProfile(memoryService, result)
      .then(() => { updated.push('sender'); })
      .catch((e) => { errors.push(`sender: ${e.message}`); })
  );

  // 2. Update shipment context if booking number found
  if (result.analysis.booking_number) {
    promises.push(
      updateShipmentContext(memoryService, result)
        .then(() => { updated.push('shipment'); })
        .catch((e) => { errors.push(`shipment: ${e.message}`); })
    );
  }

  // 3. Learn new pattern if high confidence and not pattern-matched
  if (result.confidence >= 90 && !result.patternMatched) {
    promises.push(
      learnNewPattern(memoryService, result)
        .then(() => { updated.push('pattern'); })
        .catch((e) => { errors.push(`pattern: ${e.message}`); })
    );
  }

  await Promise.allSettled(promises);

  return { updated, errors };
}

// ============================================================================
// SENDER PROFILE UPDATE
// ============================================================================

/**
 * Update sender profile with new document type info
 * Builds cumulative knowledge about each sender domain
 */
async function updateSenderProfile(
  memoryService: IMemoryService,
  result: ProcessingResult
): Promise<void> {
  const { senderDomain } = result.email;
  const { document_type, from_party } = result.analysis;

  // Get existing profile to merge document types
  const existing = await memoryService
    .getByScope(MemoryScope.SENDER, ScopeIdBuilder.sender(senderDomain))
    .catch(() => []);

  // Accumulate document types seen from this sender
  const docTypes = new Set<string>();
  if (existing.length > 0) {
    const existingDocTypes = existing[0].metadata?.commonDocTypes;
    if (Array.isArray(existingDocTypes)) {
      existingDocTypes.forEach((d: string) => docTypes.add(d));
    }
  }
  if (document_type) {
    docTypes.add(document_type);
  }

  const docTypesArray = Array.from(docTypes);
  const now = new Date().toISOString().split('T')[0];

  await memoryService.add({
    scope: MemoryScope.SENDER,
    scopeId: ScopeIdBuilder.sender(senderDomain),
    content: buildSenderContent(senderDomain, from_party, docTypesArray, now),
    metadata: {
      senderDomain,
      partyType: from_party || 'unknown',
      commonDocTypes: docTypesArray,
      lastSeen: now,
      emailCount: ((existing[0]?.metadata?.emailCount as number) || 0) + 1,
    },
    tags: docTypesArray,
    source: 'chronicle',
  });
}

function buildSenderContent(
  domain: string,
  partyType: string | undefined,
  docTypes: string[],
  lastSeen: string
): string {
  const lines = [`Sender ${domain}:`];
  lines.push(`Party type: ${partyType || 'unknown'}`);
  if (docTypes.length > 0) {
    lines.push(`Common doc types: ${docTypes.join(', ')}`);
  }
  lines.push(`Last seen: ${lastSeen}`);
  return lines.join('\n');
}

// ============================================================================
// SHIPMENT CONTEXT UPDATE
// ============================================================================

/**
 * Update shipment context with latest info
 * Tracks shipment progress across multiple emails
 */
async function updateShipmentContext(
  memoryService: IMemoryService,
  result: ProcessingResult
): Promise<void> {
  const { booking_number, document_type, etd, eta, vessel_name, summary } =
    result.analysis;

  if (!booking_number) return;

  const now = new Date().toISOString().split('T')[0];

  await memoryService.add({
    scope: MemoryScope.SHIPMENT,
    scopeId: ScopeIdBuilder.shipment(booking_number),
    content: buildShipmentContent(booking_number, {
      documentType: document_type,
      etd,
      eta,
      vessel: vessel_name,
      summary,
      lastUpdate: now,
    }),
    metadata: {
      bookingNumber: booking_number,
      documentType: document_type,
      etd,
      eta,
      vessel: vessel_name,
      lastUpdate: now,
    },
    source: 'chronicle',
  });
}

function buildShipmentContent(
  bookingNumber: string,
  data: {
    documentType?: string;
    etd?: string;
    eta?: string;
    vessel?: string;
    summary?: string;
    lastUpdate: string;
  }
): string {
  const lines = [`Shipment ${bookingNumber}:`];
  if (data.documentType) lines.push(`Latest document: ${data.documentType}`);
  if (data.etd) lines.push(`ETD: ${data.etd}`);
  if (data.eta) lines.push(`ETA: ${data.eta}`);
  if (data.vessel) lines.push(`Vessel: ${data.vessel}`);
  if (data.summary) lines.push(`Summary: ${data.summary}`);
  lines.push(`Last update: ${data.lastUpdate}`);
  return lines.join('\n');
}

// ============================================================================
// PATTERN LEARNING
// ============================================================================

/**
 * Learn a new pattern from high-confidence classification
 * Only stores patterns that weren't already matched
 */
async function learnNewPattern(
  memoryService: IMemoryService,
  result: ProcessingResult
): Promise<void> {
  const { senderDomain, subject } = result.email;
  const { document_type } = result.analysis;

  if (!document_type) return;

  // Extract key phrases from subject (remove RE:, FWD:, etc.)
  const keyPhrases = extractKeyPhrases(subject);
  const now = new Date().toISOString();

  await memoryService.add({
    scope: MemoryScope.PATTERN,
    scopeId: `pattern-learned-${Date.now()}`,
    content: buildPatternContent({
      documentType: document_type,
      senderDomain,
      keywords: keyPhrases,
      confidence: result.confidence,
      learnedAt: now,
    }),
    metadata: {
      documentType: document_type,
      senderDomain,
      keywords: keyPhrases,
      confidence: result.confidence,
      learnedAt: now,
    },
    tags: [document_type, senderDomain],
    source: 'pattern-learning',
  });
}

function extractKeyPhrases(subject: string): string[] {
  // Remove common prefixes
  const cleaned = subject.replace(/^(re:|fwd:|fw:)\s*/gi, '').trim();

  // Split into words
  const words = cleaned.toLowerCase().split(/\s+/);

  // Filter out stop words and short words
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'for',
    'to',
    'from',
    're',
    'fwd',
    'fw',
    'of',
    'in',
    'on',
    'at',
    'and',
    'or',
  ]);

  return words
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);
}

function buildPatternContent(data: {
  documentType: string;
  senderDomain: string;
  keywords: string[];
  confidence: number;
  learnedAt: string;
}): string {
  const lines = ['Learned pattern:'];
  lines.push(`Document type: ${data.documentType}`);
  lines.push(`Sender domain: ${data.senderDomain}`);
  if (data.keywords.length > 0) {
    lines.push(`Subject keywords: ${data.keywords.join(', ')}`);
  }
  lines.push(`Confidence: ${data.confidence}%`);
  lines.push(`Learned: ${data.learnedAt}`);
  return lines.join('\n');
}

// ============================================================================
// ERROR PATTERN STORAGE
// ============================================================================

export interface ErrorInfo {
  errorMessage: string;
  errorType: string;
  carrier?: string;
  documentType?: string;
}

/**
 * Store an error pattern for future prevention
 */
export async function storeErrorPattern(
  memoryService: IMemoryService,
  error: ErrorInfo
): Promise<void> {
  const errorType = categorizeError(error.errorMessage);

  await memoryService.add({
    scope: MemoryScope.ERROR,
    scopeId: ScopeIdBuilder.error(`${errorType}-${Date.now()}`),
    content: buildErrorContent(error, errorType),
    metadata: {
      errorType,
      errorMessage: error.errorMessage,
      carrier: error.carrier,
      documentType: error.documentType,
      occurredAt: new Date().toISOString(),
    },
    tags: [errorType, error.carrier, error.documentType].filter(
      Boolean
    ) as string[],
    source: 'error-learning',
  });
}

function categorizeError(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('date')) return 'date-extraction';
  if (msg.includes('booking')) return 'booking-extraction';
  if (msg.includes('container')) return 'container-extraction';
  if (msg.includes('timeout')) return 'api-timeout';
  if (msg.includes('validation')) return 'validation-failure';
  if (msg.includes('parse')) return 'parse-error';
  return 'unknown';
}

function buildErrorContent(error: ErrorInfo, errorType: string): string {
  const lines = [`Error pattern (${errorType}):`];
  lines.push(`Description: ${error.errorMessage}`);
  lines.push(`Root cause: ${detectRootCause(error.errorMessage)}`);
  lines.push(`Solution: ${suggestSolution(error.errorMessage)}`);
  if (error.carrier) lines.push(`Carrier: ${error.carrier}`);
  if (error.documentType) lines.push(`Document type: ${error.documentType}`);
  return lines.join('\n');
}

function detectRootCause(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('invalid date')) return 'Unusual date format in email';
  if (msg.includes('expected')) return 'AI output did not match schema';
  if (msg.includes('timeout')) return 'External service timeout';
  if (msg.includes('not found')) return 'Required data missing from email';
  return 'Requires investigation';
}

function suggestSolution(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('date')) return 'Check date formats, may need new pattern';
  if (msg.includes('timeout')) return 'Retry or check API health';
  if (msg.includes('validation')) return 'Review AI output against schema';
  return 'Manual review required';
}
