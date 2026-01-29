/**
 * Type Definitions Module
 *
 * Central export point for all TypeScript type definitions.
 *
 * @example
 * import { Shipment, ShipmentStatus, ShipmentDocument } from '@/types';
 * import { GmailMessage, EmailData } from '@/types';
 * import { Insight, InsightSeverity } from '@/types';
 */

// =============================================================================
// DATABASE TYPES (Generated from Supabase)
// =============================================================================
export {
  type Json,
  type Database,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
  type Enums,
  type CompositeTypes,
  Constants,
} from './database.types';

// =============================================================================
// GMAIL TYPES - Gmail API type definitions
// =============================================================================
export {
  type GmailMessage,
  type GmailMessagePart,
  type GmailAttachment,
  type GmailHeader,
  type GmailCredentials,
  type EmailData,
  type AttachmentData,
  type GmailQueryOptions,
  type ProcessingResult,
} from './gmail.types';

// =============================================================================
// EMAIL INTELLIGENCE TYPES - Document classification and extraction
// =============================================================================
export {
  type RawEmail,
  type RawAttachment,
  type CarrierConfig,
  type ProcessingLog,
  type DocumentDirection,
  type WorkflowState,
  type DocumentClassification,
  type DocumentType,
  type EntityType,
  type ExtractionMethod,
  type EntityExtraction,
  type EmailThreadMetadata,
  type EmailWithIntelligence,
  type DashboardStats,
  ConfidenceLevel,
  getConfidenceLevel,
  type EmailFilters,
  type SearchQuery,
} from './email-intelligence';

// =============================================================================
// SHIPMENT TYPES - Core shipment domain models
// =============================================================================
export {
  type Carrier,
  type PartyType,
  type Party,
  type ShipmentStatus,
  type WeightUnit,
  type VolumeUnit,
  type DimensionUnit,
  type TemperatureUnit,
  type Shipment,
  type LinkMethod,
  type ShipmentDocument,
  type ShipmentContainer,
  type EventSourceType,
  type ShipmentEvent,
  type InvoiceType,
  type PaymentStatus,
  type ShipmentFinancial,
  type LinkType,
  type ShipmentLinkCandidate,
  type AuditAction,
  type AuditSource,
  type ShipmentAuditLog,
  type ShipmentWithDetails,
  type ShipmentListItem,
  type ShipmentTimeline,
  type LinkingKeys,
  type LinkingResult,
  type LinkingConfig,
} from './shipment';

// =============================================================================
// INSIGHT TYPES - AI-powered insights and blockers
// =============================================================================
export {
  type InsightSeverity,
  type InsightType,
  type InsightSource,
  type InsightStatus,
  type PatternCategory,
  type FeedbackType,
  type InsightActionType,
  type InsightActionTarget,
  type InsightActionUrgency,
  type InsightAction,
  type ShipmentDates,
  type ShipmentParties,
  type ShipmentFinancials,
  type ShipmentContext,
  type DocumentInfo,
  type QualityIssue,
  type Amendment,
  type DocumentContext,
  type StakeholderProfile,
  type CarrierProfile,
  type StakeholderContext,
  type ShipmentSummary,
  type RelatedShipmentsContext,
  type HistoricalPatterns,
  type NotificationInfo,
  type NotificationContext,
  type CommunicationContext,
  type BlockerSeverity,
  type BlockerType,
  type ShipmentBlocker,
  type JourneyEvent,
  type CommunicationTimelineEntry,
  type JourneyContext,
  type InsightContext,
  type PatternDefinition,
  type DetectedPattern,
  type AIInsight,
  type AIInsightResult,
  type Insight,
  type InsightEngineResult,
  type InsightFeedback,
  type InsightGenerationOptions,
  type PatternCheckFunction,
  type PatternInsightGenerator,
} from './insight';

// =============================================================================
// INTELLIGENCE PLATFORM TYPES - Advanced platform features
// =============================================================================
export {
  // Party & Stakeholder types
  type Party as PlatformParty,
  type RouteInfo,
  type StakeholderBehaviorMetrics,
  type StakeholderSentimentLog,
  type StakeholderExtractionQueue,
  type ExtractedParty,
  type StakeholderRelationship,
  type CustomerRelationship,
  type MetricPeriod,
  type Sentiment,
  type ExtractionStatus,
  type RelationshipType,
  type PriorityTier,

  // Document lifecycle types
  type LifecycleStatus,
  type DocumentLifecycleStatus,
  type ComparisonType,
  type DiscrepancySeverity,
  type ComparisonStatus,
  type DocumentComparisonStatus,
  type AlertStatus,
  type MissingDocumentAlertStatus,
  type DocumentLifecycle,
  type StatusHistoryEntry,
  type DocumentComparisonField,
  type DocumentComparison,
  type FieldComparisonResult,
  type MissingDocumentAlert,
  type DocumentTypeRequirement,

  // Notification types
  type NotificationCategory,
  type NotificationPriority,
  type NotificationStatus,
  type NotificationActionType,
  type NotificationTypeConfig,
  type Notification,
  type NotificationAction,

  // Task types
  type TaskCategory,
  type TaskTriggerType,
  type TaskStatus,
  type UrgencyLevel,
  type CommunicationType,
  type CommunicationStatus,
  type TaskActivityType,
  type TaskTemplate,
  type RecipientConfig,
  type ActionTask,
  type PriorityFactors,
  type PriorityFactor,
  type TaskInsight,
  type CommunicationLog,
  type TaskActivityLog,
  type ActiveTask,

  // Utility functions
  formatTaskNumber,
  calculateUrgencyLevel,
  calculateDaysOverdue,
} from './intelligence-platform';
