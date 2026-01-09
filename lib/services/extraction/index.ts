/**
 * Enhanced Extraction Module
 *
 * Exports for the layered extraction system:
 * - Pattern definitions for regex-first extraction
 * - Regex extractors for deterministic field extraction
 * - Layered extraction service combining regex + AI
 * - LLM Judge for quality assurance
 * - Separated email/document extractors (Opus 4.5 architecture)
 * - Extraction repository for new storage buckets
 */

// Pattern Definitions - Types
export type {
  PatternDefinition,
  DatePatternDefinition,
  CutoffKeywordDefinition,
} from './pattern-definitions';

// Pattern Definitions - Values
export {
  BOOKING_NUMBER_PATTERNS,
  CONTAINER_NUMBER_PATTERNS,
  BL_NUMBER_PATTERNS,
  ENTRY_NUMBER_PATTERNS,
  DATE_PATTERNS,
  CUTOFF_KEYWORDS,
  PORT_PATTERNS,
  VESSEL_PATTERNS,
  VOYAGE_PATTERNS,
  CARRIER_DETECTION_PATTERNS,
  CONFIDENCE_THRESHOLDS,
  CRITICAL_FIELDS,
  IMPORTANT_FIELDS,
  OPTIONAL_FIELDS,
} from './pattern-definitions';

// Regex Extractors - Types
export type {
  ExtractionResult,
  DateExtractionResult,
  CutoffExtractionResult,
  ExtractorInput,
  RegexExtractionResults,
} from './regex-extractors';

// Regex Extractors - Classes and Instances
export {
  CarrierDetector,
  IdentifierExtractor,
  DateExtractor,
  CutoffExtractor,
  PortExtractor,
  VesselVoyageExtractor,
  RegexExtractor,
  // Singleton instances
  carrierDetector,
  identifierExtractor,
  dateExtractor,
  cutoffExtractor,
  portExtractor,
  vesselVoyageExtractor,
  regexExtractor,
} from './regex-extractors';

// Layered Extraction Service - Types
export type {
  LayeredExtractionInput,
  LayeredExtractionResult,
  ExtractedData,
  ExtractionMetadata,
} from './layered-extraction-service';

// Layered Extraction Service - Class
export { LayeredExtractionService } from './layered-extraction-service';

// LLM Judge - Types
export type {
  JudgementInput,
  JudgementResult,
  FieldEvaluation,
  JudgementIssue,
} from './llm-judge';

// LLM Judge - Classes
export { LLMJudge, BatchJudge } from './llm-judge';

// =============================================================================
// NEW: Separated Extraction Architecture (Opus 4.5 Recommendation)
// =============================================================================

// Email Content Extractor - Types
export type {
  EmailExtractionInput,
  EmailExtraction,
  EmailSourceField,
  EmailExtractionMethod,
  EmailExtractionResult,
} from './email-content-extractor';

// Email Content Extractor - Class and Factory
export {
  EmailContentExtractor,
  createEmailContentExtractor,
} from './email-content-extractor';

// Document Content Extractor - Types
export type {
  DocumentExtractionInput,
  DocumentExtraction,
  DocumentSection,
  DocumentExtractionMethod,
  DocumentExtractionResult,
} from './document-content-extractor';

// Document Content Extractor - Class and Factory
export {
  DocumentContentExtractor,
  createDocumentContentExtractor,
} from './document-content-extractor';

// Extraction Repository - Types
export type {
  EmailExtractionRecord,
  DocumentExtractionRecord,
  UnifiedExtraction,
  ShipmentEntity,
  SaveResult,
} from './extraction-repository';

// Extraction Repository - Class and Factory
export {
  ExtractionRepository,
  createExtractionRepository,
} from './extraction-repository';

// =============================================================================
// NEW: Sender-Aware Extraction (Deep Entity Patterns)
// =============================================================================

// Additional Pattern Definitions - Types
export type {
  WeightPatternDefinition,
  AmountPatternDefinition,
  DemurrageDateKeyword,
} from './pattern-definitions';

// Additional Pattern Definitions - Values (Deep Extraction)
export {
  IT_NUMBER_PATTERNS,
  ISF_NUMBER_PATTERNS,
  AMS_NUMBER_PATTERNS,
  HS_CODE_PATTERNS,
  SEAL_NUMBER_PATTERNS,
  WEIGHT_PATTERNS,
  VOLUME_PATTERNS,
  PACKAGE_PATTERNS,
  CONTAINER_TYPE_PATTERNS,
  DEMURRAGE_DATE_KEYWORDS,
  FREE_TIME_PATTERNS,
  APPOINTMENT_PATTERNS,
  INLAND_LOCATION_PATTERNS,
  TEMPERATURE_PATTERNS,
  INCOTERMS_PATTERNS,
  AMOUNT_PATTERNS,
  REFERENCE_NUMBER_PATTERNS,
  SENDER_CATEGORY_PATTERNS,
} from './pattern-definitions';

// Sender-Aware Extractor - Types
export type {
  SenderCategory,
  SenderExtractionConfig,
  ExtractedEntity,
  SenderAwareExtractionInput,
  SenderAwareExtractionResult,
} from './sender-aware-extractor';

// Sender-Aware Extractor - Classes and Factories
export {
  SenderCategoryDetector,
  SenderAwareExtractor,
  createSenderAwareExtractor,
  createSenderCategoryDetector,
} from './sender-aware-extractor';

// =============================================================================
// NEW: AI Analysis Extraction (Sentiment, Urgency, Summary, Action Items)
// =============================================================================

// AI Analysis Extractor - Types
export type {
  Sentiment,
  UrgencyLevel,
  AIAnalysisResult,
  ActionItem,
  AIAnalysisInput,
} from './ai-analysis-extractor';

// AI Analysis Extractor - Classes and Functions
export {
  AIAnalysisExtractor,
  createAIAnalysisExtractor,
  quickSentimentAnalysis,
} from './ai-analysis-extractor';

// =============================================================================
// NEW: Document-Type-Aware Extraction (Schema-Based)
// =============================================================================

// Document Extraction Schemas - Types
export type {
  DocumentExtractionSchema,
  EntityField,
  SectionDefinition,
  TableDefinition,
  TableColumn,
  FieldType,
  PartyInfo,
} from './document-extraction-schemas';

// Document Extraction Schemas - Values
export {
  DOCUMENT_SCHEMAS,
  BL_SCHEMA,
  ARRIVAL_NOTICE_SCHEMA,
  FREIGHT_INVOICE_SCHEMA,
  SHIPPING_INSTRUCTION_SCHEMA,
  PACKING_LIST_SCHEMA,
  ENTRY_SUMMARY_SCHEMA,
  COMMERCIAL_INVOICE_SCHEMA,
  BOOKING_CONFIRMATION_SCHEMA,
  DELIVERY_ORDER_SCHEMA,
  // New high-value schemas
  ISF_FILING_SCHEMA,
  SHIPPING_BILL_SCHEMA,
  CONTAINER_RELEASE_SCHEMA,
  PROOF_OF_DELIVERY_SCHEMA,
  VGM_CONFIRMATION_SCHEMA,
  BOOKING_AMENDMENT_SCHEMA,
  COUNTRIES,
  getExtractionSchema,
  getSupportedDocumentTypes,
} from './document-extraction-schemas';

// Document Type Extractor - Types
export type {
  ExtractionResult as DocTypeExtractionResult,
  ExtractedValue,
  TableRow,
  ExtractionOptions,
} from './document-type-extractor';

// Document Type Extractor - Classes and Functions
export {
  DocumentTypeExtractor,
  createDocumentTypeExtractor,
  extractFromDocument,
} from './document-type-extractor';

// Document Extraction Orchestrator - Types
export type {
  DocumentExtractionInput as DocExtractionInput,
  OrchestrationResult,
  DocumentEntityRecord,
} from './document-extraction-orchestrator';

// Document Extraction Orchestrator - Classes and Functions
export {
  DocumentExtractionOrchestrator,
  createDocumentExtractionOrchestrator,
  supportsExtraction,
  getExtractableDocumentTypes,
} from './document-extraction-orchestrator';

// =============================================================================
// NEW: Unified Extraction Service (Production Pipeline)
// =============================================================================

// Unified Extraction Service - Types
export type {
  UnifiedExtractionInput,
  UnifiedExtractionResult,
} from './unified-extraction-service';

// Unified Extraction Service - Class and Factory
export {
  UnifiedExtractionService,
  createUnifiedExtractionService,
} from './unified-extraction-service';

// =============================================================================
// NEW: Database-Driven Schema Service
// =============================================================================

// Database Schema Service - Classes and Functions
export {
  DatabaseSchemaService,
  createDatabaseSchemaService,
  getDatabaseSchemaService,
} from './database-schema-service';
