/**
 * Chronicle Module
 *
 * Complete intelligence system for shipment email processing.
 * Standalone - does not depend on existing pipeline.
 *
 * Following CLAUDE.md principles:
 * - Index Imports Only (Principle from Code Quality Rules)
 *
 * Usage:
 *   import { createChronicleService, createChronicleGmailService } from '@/lib/chronicle';
 */

// ============================================================================
// MAIN SERVICE
// ============================================================================

export {
  ChronicleService,
  createChronicleService,
} from './chronicle-service';

export {
  ChronicleGmailService,
  createChronicleGmailService,
} from './gmail-service';

// ============================================================================
// SUPPORTING SERVICES
// ============================================================================

export {
  PdfExtractor,
  createPdfExtractor,
} from './pdf-extractor';

export {
  AiAnalyzer,
  createAiAnalyzer,
} from './ai-analyzer';

export {
  ChronicleRepository,
  createChronicleRepository,
} from './chronicle-repository';

// ============================================================================
// INTERFACES
// ============================================================================

export type {
  IChronicleService,
  IGmailService,
  IPdfExtractor,
  IAiAnalyzer,
  IChronicleRepository,
  ChronicleInsertData,
} from './interfaces';

// ============================================================================
// TYPES
// ============================================================================

export {
  // Types
  ProcessedEmail,
  ProcessedAttachment,
  ShippingAnalysis,
  ChronicleRecord,
  ChronicleProcessResult,
  ChronicleBatchResult,

  // Schema
  analyzeShippingCommunicationSchema,

  // Helpers
  detectDirection,
  detectPartyType,
  extractTrueSender,
  isGroupEmail,
} from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

export {
  AI_CONFIG,
  FREIGHT_FORWARDER_PROMPT,
  ANALYZE_TOOL_SCHEMA,
  buildAnalysisPrompt,
} from './prompts/freight-forwarder.prompt';
