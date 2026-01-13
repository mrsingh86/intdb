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

export {
  ReanalysisService,
  createReanalysisService,
} from './reanalysis-service';

export type {
  ReanalysisResult,
  ReanalysisBatchResult,
} from './reanalysis-service';

export {
  ParallelReanalysisService,
  createParallelReanalysisService,
} from './parallel-reanalysis-service';

export type {
  ParallelReanalysisConfig,
  ParallelReanalysisResult,
} from './parallel-reanalysis-service';

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

// Types (must use 'export type' for isolatedModules)
export type {
  ProcessedEmail,
  ProcessedAttachment,
  ShippingAnalysis,
  ChronicleRecord,
  ChronicleProcessResult,
  ChronicleBatchResult,
  ThreadContext,
  ThreadEmailSummary,
  ChronicleSyncState,
  SyncMode,
  SyncResult,
} from './types';

// Schema and Helpers (values, not types)
export {
  analyzeShippingCommunicationSchema,
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

// ============================================================================
// LOGGING
// ============================================================================

export {
  ChronicleLogger,
} from './chronicle-logger';

export {
  ChronicleMonitor,
  createChronicleMonitor,
} from './chronicle-monitor';

export type {
  SystemHealth,
  FullScan,
  HealthStatus,
} from './chronicle-monitor';

export {
  PipelineMonitor,
  createPipelineMonitor,
} from './pipeline-monitor';

export type {
  PipelineXRay,
} from './pipeline-monitor';

export type {
  LogStage,
  ShipmentStage,
  EventType,
  ErrorSeverity,
} from './chronicle-logger';
