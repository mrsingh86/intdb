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
// EXTRACTED SERVICES (P2-15 Decomposition)
// ============================================================================

export {
  ChronicleDataMapper,
} from './chronicle-data-mapper';

export type {
  ConfidenceData,
} from './chronicle-data-mapper';

export {
  ShipmentLinker,
  createShipmentLinker,
} from './shipment-linker';

export {
  AttachmentExtractor,
  createAttachmentExtractor,
} from './attachment-extractor';

export type {
  AttachmentExtractionResult,
} from './attachment-extractor';

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
  PatternMatcherService,
  createPatternMatcherService,
  emailToPatternInput,
} from './pattern-matcher';

export type {
  DetectionPattern,
  PatternMatchResult,
  PatternMatchInput,
  PatternMatcherConfig,
  IPatternMatcherService,
} from './pattern-matcher';

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
  FlowContext,
  ActionKeywordResult,
  FlowValidationResult,
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

// ============================================================================
// LEARNING SYSTEM
// ============================================================================
// Note: Learning system is now integrated directly into ChronicleService
// using simple database calls instead of separate service classes.
// Tables used:
// - enum_mappings: Normalizes AI enum values (e.g., "booking" → "booking_confirmation")
// - flow_validation_rules: Validates document_type against shipment stage
// - learning_episodes: Records every classification for feedback and learning
// - document_type_action_rules: Determines has_action based on document type + context

export {
  ActionRulesEngine,
  createActionRulesEngine,
} from './action-rules-engine';

export type {
  DocumentActionRule,
  TimeBasedRule,
  DocumentFlow,
  FlowStep,
  ActionResult,
  TimeBasedAction,
  FlowPosition,
} from './action-rules-engine';

// ============================================================================
// RECLASSIFICATION SYSTEM
// ============================================================================

export {
  ReclassificationLogger,
  createReclassificationLogger,
} from './reclassification-logger';

export type {
  ClassificationChange,
  BatchError,
  BatchSummary,
  ReclassificationReport,
} from './reclassification-logger';

export {
  ReclassificationTester,
  createReclassificationTester,
  DEFAULT_TEST_CATEGORIES,
} from './reclassification-tester';

export type {
  TestCategory,
  TestResult,
  BatchTestReport,
} from './reclassification-tester';

// ============================================================================
// OBJECTIVE CONFIDENCE SYSTEM
// ============================================================================

export {
  ObjectiveConfidenceService,
  createObjectiveConfidenceService,
} from './objective-confidence-service';

export type {
  ConfidenceSignal,
  ConfidenceResult,
  ConfidenceInput,
} from './objective-confidence-service';

// ============================================================================
// EMBEDDING & SEMANTIC SEARCH
// ============================================================================

export {
  EmbeddingService,
  createEmbeddingService,
} from './embedding-service';

export type {
  IEmbeddingService,
  EmbeddingResult,
  SemanticSearchResult,
  EmbeddingConfig,
  GlobalSearchOptions,
} from './embedding-service';

// ============================================================================
// SEMANTIC CONTEXT (AI PROMPT ENRICHMENT)
// ============================================================================

export {
  SemanticContextService,
  createSemanticContextService,
} from './semantic-context-service';

export type {
  ISemanticContextService,
  SimilarEmail,
  SenderPatternHistory,
  DocumentTypeCount,
  RelatedDocument,
  SemanticContext,
} from './semantic-context-service';

// ============================================================================
// HYBRID SEARCH (Phase 2: Keyword + Semantic)
// ============================================================================

export {
  HybridSearchService,
  createHybridSearchService,
} from './hybrid-search-service';

export type {
  IHybridSearchService,
  HybridSearchResult,
  HybridSearchConfig,
} from './hybrid-search-service';

// ============================================================================
// UNIFIED SEARCH (Query Classification + RRF Merge)
// ============================================================================

export {
  classifyQuery,
  isIdentifierQuery,
  shouldUseSemanticSearch,
  getSearchFields,
} from './query-classifier';

export type {
  QueryType,
  SearchStrategy,
  ClassifiedQuery,
} from './query-classifier';

export {
  UnifiedSearchService,
  createUnifiedSearchService,
} from './unified-search-service';

export type {
  IUnifiedSearchService,
  SearchResult,
  SearchOptions,
  SearchResponse,
} from './unified-search-service';
