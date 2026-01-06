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

// Legacy unified classification service (to be deprecated)
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
  DocumentType,
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
