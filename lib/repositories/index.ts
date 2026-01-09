/**
 * Repositories Index
 *
 * Central export point for all repository classes.
 * Repositories handle database access following the Repository pattern.
 *
 * Principles:
 * - Information Hiding: Hide Supabase implementation details
 * - Single Responsibility: Only database access, no business logic
 * - No Null Returns: Throw exceptions or return empty arrays
 *
 * Architecture (Consistent Split Pattern):
 * - Core: raw_emails + raw_attachments
 * - Classification: email_classifications + attachment_classifications
 * - Extraction: email_extractions + document_extractions
 * - Linking: email_shipment_links + attachment_shipment_links
 */

// ============================================================================
// Core Repositories (Split: Email + Attachment)
// ============================================================================

export { EmailRepository, EmailNotFoundError } from './email-repository';
export type { EmailQueryFilters } from './email-repository';

export { AttachmentRepository, AttachmentNotFoundError } from './attachment-repository';
export type { RawAttachment, AttachmentQueryFilters } from './attachment-repository';

export { ShipmentRepository, ShipmentNotFoundError } from './shipment-repository';
export type { ShipmentQueryFilters } from './shipment-repository';

// ============================================================================
// Classification Repositories (Split Architecture)
// ============================================================================

export { EmailClassificationRepository } from './email-classification-repository';
export type {
  EmailClassificationRecord,
  EmailClassificationInput,
} from './email-classification-repository';

export { AttachmentClassificationRepository } from './attachment-classification-repository';
export type {
  AttachmentClassificationRecord,
  AttachmentClassificationInput,
} from './attachment-classification-repository';

// ============================================================================
// Extraction Repositories (Split Architecture)
// ============================================================================

export { EmailExtractionRepository } from './email-extraction-repository';
export type {
  EmailExtractionRecord,
  EmailExtractionInput,
} from './email-extraction-repository';

export { AttachmentExtractionRepository } from './attachment-extraction-repository';
export type {
  AttachmentExtractionRecord,
  AttachmentExtractionInput,
} from './attachment-extraction-repository';

// ============================================================================
// Linking Repositories (Split Architecture)
// ============================================================================

export { EmailShipmentLinkRepository } from './email-shipment-link-repository';
export type {
  EmailShipmentLink,
  EmailShipmentLinkInput,
} from './email-shipment-link-repository';

export { AttachmentShipmentLinkRepository } from './attachment-shipment-link-repository';
export type {
  AttachmentShipmentLink,
  AttachmentShipmentLinkInput,
} from './attachment-shipment-link-repository';

export { ShipmentLinkCandidateRepository } from './shipment-link-candidate-repository';

// ============================================================================
// Document Lifecycle Repository
// ============================================================================

export { DocumentLifecycleRepository } from './document-lifecycle-repository';
export type {
  DocumentLifecycleFilters,
  DocumentComparisonFilters,
  MissingDocumentAlertFilters,
} from './document-lifecycle-repository';

// ============================================================================
// Intelligence Repositories
// ============================================================================

export { InsightRepository } from './insight-repository';
export type { InsightFilters, InsightCreateInput } from './insight-repository';

export { TaskRepository } from './task-repository';
export type { TaskFilters, TaskWithRelations } from './task-repository';

export { NotificationRepository } from './notification-repository';
export type { NotificationFilters, NotificationStats } from './notification-repository';

// ============================================================================
// Stakeholder Repository
// ============================================================================

export { StakeholderRepository, StakeholderNotFoundError } from './stakeholder-repository';
export type { StakeholderQueryFilters } from './stakeholder-repository';

// ============================================================================
// DEPRECATED - Keep for backward compatibility during migration
// These will be removed once all services are updated
// ============================================================================

/**
 * @deprecated Use EmailClassificationRepository + AttachmentClassificationRepository instead.
 * This uses the legacy document_classifications table.
 */
export { ClassificationRepository } from './classification-repository';

/**
 * @deprecated Use ExtractionRepository instead.
 * This uses the legacy entity_extractions table.
 */
export { EntityRepository } from './entity-repository';

/**
 * @deprecated Use EmailShipmentLinkRepository + AttachmentShipmentLinkRepository instead.
 * This is a wrapper that internally uses the new split tables.
 */
export { ShipmentDocumentRepository } from './shipment-document-repository';
export type { LinkDocumentInput, CreateOrphanInput } from './shipment-document-repository';

/**
 * @deprecated Use EmailExtractionRepository + AttachmentExtractionRepository instead.
 * This combined repository will be removed.
 */
export { ExtractionRepository, createExtractionRepository } from './extraction-repository';

// ============================================================================
// Configuration Repositories (Database-Driven Patterns & Schemas)
// ============================================================================

export { PatternRepository } from './pattern-repository';
export type {
  DetectionPattern,
  PatternType,
  CompiledPattern,
  PatternMatchResult,
} from './pattern-repository';

export { SchemaRepository, createSchemaRepository } from './schema-repository';
export type {
  ExtractionSchema,
  FieldDefinition,
  FieldType,
  SectionDefinition,
  TableDefinition,
} from './schema-repository';

export {
  ClassificationConfigRepository,
  createClassificationConfigRepository,
} from './classification-config-repository';
export type {
  SenderPattern,
  ContentMarker,
  ContentMatchResult,
  SenderType,
} from './classification-config-repository';
