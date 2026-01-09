/**
 * Services Index
 *
 * Central export point for all service classes.
 * Organized by layer and responsibility.
 */

// ============================================================================
// Layer 1: Email Intelligence
// ============================================================================

export { EmailIntelligenceService } from './email-intelligence-service';
export type { EmailIntelligenceFilters } from './email-intelligence-service';

// Email Flagging Service (computes all derived flags on raw_emails)
export {
  EmailFlaggingService,
  createEmailFlaggingService,
} from './email-flagging-service';
export type {
  EmailFlags,
  FlaggingResult,
} from './email-flagging-service';

// Attachment Flagging Service (signature detection, business document classification)
export {
  AttachmentFlaggingService,
  createAttachmentFlaggingService,
} from './attachment-flagging-service';
export type {
  AttachmentData,
  AttachmentFlags,
  FlaggingResult as AttachmentFlaggingResult,
} from './attachment-flagging-service';

// Flagging Orchestrator (coordinates email + attachment flagging in parallel)
export {
  FlaggingOrchestrator,
  createFlaggingOrchestrator,
} from './flagging-orchestrator';
export type {
  FlaggingInput,
  FlaggingOutput,
  BatchFlaggingResult,
} from './flagging-orchestrator';

// Document Registry Service (tracks unique documents and versions)
export {
  DocumentRegistryService,
  createDocumentRegistryService,
} from './document-registry-service';
export type {
  DocumentType,
  DocumentStatus,
  ExtractedReferences,
  DocumentMatch,
  RegistrationResult,
  ClassificationInput as RegistryClassificationInput,
} from './document-registry-service';

// ============================================================================
// Layer 2: Classification & Extraction
// ============================================================================

// New Decoupled Classification Services (preferred for new code)
export {
  ClassificationOrchestrator,
  createClassificationOrchestrator,
  DocumentContentClassificationService,
  createDocumentContentClassificationService,
  EmailContentClassificationService,
  createEmailContentClassificationService,
  EmailTypeClassificationService,
  createEmailTypeClassificationService,
  ThreadContextService,
  createThreadContextService,
} from './classification';
export type {
  ClassificationInput as OrchestratorInput,
  ClassificationOutput as OrchestratorOutput,
  DocumentContentInput,
  DocumentContentResult,
  EmailContentInput,
  EmailContentResult,
  EmailTypeInput,
  EmailTypeResult,
  ThreadContextInput,
  ThreadContext,
  ForwardInfo,
} from './classification';

/**
 * @deprecated Use ClassificationOrchestrator from './classification' instead.
 * UnifiedClassificationService is kept for backward compatibility only.
 * Will be removed in a future version.
 */
export {
  UnifiedClassificationService,
  createClassificationService,
} from './unified-classification-service';
export type {
  ClassificationInput,
  ClassificationResult,
  DocumentSubType,
} from './unified-classification-service';


export { ShipmentExtractionService } from './shipment-extraction-service';
export type {
  ShipmentData,
  ExtractionResult
} from './shipment-extraction-service';

export { AttachmentExtractionService, attachmentExtractionService } from './attachment-extraction-service';
export type { ExtractionResult as AttachmentExtractionResult, AttachmentExtractor } from './attachment-extraction-service';

export { CutoffExtractionService, CutoffExtractor, BookingNumberMatcher } from './cutoff-extraction-service';
export type { ExtractedCutoffs, ExtractionStats } from './cutoff-extraction-service';

// ============================================================================
// Layer 3: Shipment Intelligence
// ============================================================================

export { ShipmentLinkingService } from './shipment-linking-service';
export type { LinkingConfig } from './shipment-linking-service';

export { EmailIngestionService } from './email-ingestion-service';
export type {
  RawEmail,
  Classification,
  DocumentType as IngestionDocumentType,
  Entity,
  IngestResult,
  ProcessingOptions
} from './email-ingestion-service';

// ============================================================================
// Enhanced PDF Extraction
// ============================================================================

export {
  EnhancedPdfExtractor,
  PdfExtractorFactory,
  HapagLloydPdfExtractor,
  MaerskPdfExtractor,
  CmaCgmPdfExtractor
} from './enhanced-pdf-extractor';
export type {
  PdfExtractionResult,
  PdfMetadata,
  CarrierPdfExtractor
} from './enhanced-pdf-extractor';

// ============================================================================
// Standalone Classification Functions (no Supabase/AI required)
// ============================================================================

export {
  classifyDocument,
  classifyDocuments,
  needsAIClassification,
  getWorkflowState,
  getWorkflowStatesForType,
  getDocumentTypesForState,
} from './unified-classification-service';
export type {
  EmailClassificationInput,
  SimpleClassificationResult,
} from './unified-classification-service';

// ============================================================================
// Document Lifecycle & Workflow
// ============================================================================

export { DocumentAuthorityService } from './document-authority-service';
export { DocumentRevisionService } from './document-revision-service';
export { DocumentLifecycleService } from './document-lifecycle-service';
export {
  WorkflowStateService,
  getWorkflowStateForDocument,
  isCarrierSender,
} from './workflow-state-service';
export {
  WorkflowStateManagementService,
  WORKFLOW_STATES_CONFIG,
} from './workflow-state-management-service';
export type {
  WorkflowStateDefinition,
  VerificationReport,
  BackfillResult,
} from './workflow-state-management-service';
// Enhanced Workflow State Service (dual-trigger: document type + email type)
export {
  EnhancedWorkflowStateService,
} from './enhanced-workflow-state-service';
export type {
  WorkflowTransitionInput,
  WorkflowTransitionResult,
} from './enhanced-workflow-state-service';
export { SIReconciliationService } from './si-reconciliation-service';
export { MilestoneTrackingService } from './milestone-tracking-service';

// ============================================================================
// Stakeholder & Party Management
// ============================================================================

export { StakeholderExtractionService } from './stakeholder-extraction-service';
export { StakeholderAnalyticsService } from './stakeholder-analytics-service';

// ============================================================================
// Notifications & Tasks
// ============================================================================

export { NotificationClassificationService } from './notification-classification-service';
export { TaskGenerationService } from './task-generation-service';
export { TaskPriorityService } from './task-priority-service';
export { InsightGenerationService } from './insight-generation-service';
export { CommunicationExecutorService } from './communication-executor-service';

// ============================================================================
// Email Processing & Orchestration
// ============================================================================

export { EmailProcessingOrchestrator } from './email-processing-orchestrator';
export { EmailFilteringService } from './email-filtering-service';

// ============================================================================
// Document Comparison
// ============================================================================

export { DocumentComparisonService } from './document-comparison-service';

// ============================================================================
// Enhanced Extraction (Regex-First + AI + LLM Judge)
// ============================================================================

// Values and Classes
export {
  // Pattern Definitions
  CONFIDENCE_THRESHOLDS,
  CRITICAL_FIELDS,
  IMPORTANT_FIELDS,
  // Regex Extractors
  RegexExtractor,
  CarrierDetector,
  IdentifierExtractor,
  DateExtractor,
  CutoffExtractor as RegexCutoffExtractor,
  PortExtractor,
  VesselVoyageExtractor,
  regexExtractor,
  // Layered Extraction Service
  LayeredExtractionService,
  // LLM Judge
  LLMJudge,
  BatchJudge,
} from './extraction';

// Types
export type {
  // Pattern types
  PatternDefinition,
  DatePatternDefinition,
  // Extraction types
  ExtractionResult as RegexExtractionResult,
  DateExtractionResult,
  CutoffExtractionResult as RegexCutoffResult,
  ExtractorInput,
  RegexExtractionResults,
  // Layered Extraction types
  LayeredExtractionInput,
  LayeredExtractionResult,
  ExtractedData,
  ExtractionMetadata,
  // LLM Judge types
  JudgementInput,
  JudgementResult,
  FieldEvaluation,
  JudgementIssue,
} from './extraction';

// ============================================================================
// Intelligence Services (AI Analysis)
// ============================================================================

export {
  EmailIntelligenceService as EmailIntelligenceExtractor,
  createEmailIntelligenceService,
  ShipmentIntelligenceService,
  createShipmentIntelligenceService,
} from './intelligence';
export type {
  EmailIntelligence,
  ShipmentIntelligence,
  SentimentTrend,
  ExtractionOptions as IntelligenceExtractionOptions,
} from './intelligence';

// ============================================================================
// Registry Services (Unified Data Flow)
// ============================================================================

// Registry Orchestrator (coordinates all registries)
export {
  RegistryOrchestrator,
  createRegistryOrchestrator,
} from './registry-orchestrator';
export type {
  RegistryOrchestratorInput,
  RegistryOrchestratorResult,
} from './registry-orchestrator';

// Email Registry
export {
  EmailRegistryService,
  createEmailRegistryService,
} from './registry';
export type {
  EmailRegistryInput,
  EmailRegistryResult,
  EmailSender,
} from './registry';

// Stakeholder Registry
export {
  StakeholderRegistryService,
  createStakeholderRegistryService,
} from './registry';
export type {
  PartyInfo as StakeholderPartyInfo,
  StakeholderRegistryInput,
  StakeholderRegistryResult,
} from './registry';

// Shipment Registry
export {
  ShipmentRegistryService,
  createShipmentRegistryService,
} from './registry';
export type {
  ShipmentRegistryInput,
  ShipmentRegistryResult,
} from './registry';

// Workstate Registry
export {
  WorkstateRegistryService,
  createWorkstateRegistryService,
  STATE_ORDER,
  DOCUMENT_TO_STATE_MAP,
} from './registry';
export type {
  WorkstateRegistryInput,
  WorkstateRegistryResult,
  StateHistoryEntry,
} from './registry';

// ============================================================================
// Logging Service (Pipeline Observability)
// ============================================================================

export {
  LoggingService,
  createLoggingService,
} from './logging-service';
export type {
  LogLevel,
  LogSection,
  LogAction,
  LogContext,
  LogEntry,
} from './logging-service';
