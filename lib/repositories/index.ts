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
 */

// ============================================================================
// Core Repositories
// ============================================================================

export { EmailRepository, EmailNotFoundError } from './email-repository';
export type { EmailQueryFilters } from './email-repository';

export { ShipmentRepository, ShipmentNotFoundError } from './shipment-repository';
export type { ShipmentQueryFilters } from './shipment-repository';

export { ClassificationRepository } from './classification-repository';

export { EntityRepository } from './entity-repository';

// ============================================================================
// Document Management Repositories
// ============================================================================

export { ShipmentDocumentRepository } from './shipment-document-repository';

export { ShipmentLinkCandidateRepository } from './shipment-link-candidate-repository';

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
