/**
 * Types for Bi-Directional Shipment Linking
 */

// ============================================================================
// IDENTIFIERS
// ============================================================================

export interface ShipmentIdentifiers {
  booking_number?: string;
  bl_number?: string;
  container_numbers: string[];
  reference_numbers?: string[];
}

export type IdentifierType = 'booking_number' | 'bl_number' | 'container_number' | 'reference_number' | 'manual';

// ============================================================================
// LINK METADATA
// ============================================================================

export enum LinkSource {
  REALTIME = 'realtime',
  BACKFILL = 'backfill',
  MANUAL = 'manual',
  MIGRATION = 'migration',
}

export enum EmailAuthority {
  DIRECT_CARRIER = 1,
  FORWARDED_CARRIER = 2,
  INTERNAL = 3,
  THIRD_PARTY = 4,
}

export interface LinkMetadata {
  link_source: LinkSource;
  link_identifier_type: IdentifierType;
  link_identifier_value: string;
  link_confidence_score: number;
  email_authority: EmailAuthority;
  linked_at: string;
  linked_by?: string;
}

// ============================================================================
// CONFIDENCE CALCULATION
// ============================================================================

export interface ConfidenceParams {
  identifier_type: IdentifierType;
  identifier_value: string;
  email_authority: EmailAuthority;
  document_type?: string;
  time_proximity_days?: number;
  /** Email type from classification (e.g., 'departure_update', 'approval_granted') */
  email_type?: string;
  /** Sender category from classification (e.g., 'carrier', 'cha_india') */
  sender_category?: string;
  /** Classification confidence from AI/pattern matching */
  classification_confidence?: number;
}

export interface ConfidenceBreakdown {
  identifier_score: number;
  authority_score: number;
  document_type_score: number;
  time_proximity_score: number;
  /** Score based on email type (status updates, confirmations score higher) */
  email_type_score: number;
  /** Score based on sender category (carrier, cha_india score higher) */
  sender_category_score: number;
}

export interface ConfidenceResult {
  score: number;
  breakdown: ConfidenceBreakdown;
  auto_link: boolean;
  needs_review: boolean;
}

// ============================================================================
// LINK RESULTS
// ============================================================================

export interface LinkResult {
  linked: boolean;
  shipment_id?: string;
  link_metadata?: LinkMetadata;
  conflict?: ConflictInfo;
  error?: string;
}

export interface BackfillResult {
  emails_found: number;
  emails_linked: number;
  emails_skipped: number;
  links_created: LinkMetadata[];
  conflicts: ConflictInfo[];
}

export interface BatchBackfillResult {
  shipments_processed: number;
  total_emails_linked: number;
  total_conflicts: number;
  errors: Array<{ shipment_id: string; error: string }>;
}

// ============================================================================
// CONFLICT HANDLING
// ============================================================================

export enum ConflictType {
  MULTIPLE_SHIPMENTS = 'multiple_shipments',
  ALREADY_LINKED = 'already_linked',
  LOW_CONFIDENCE = 'low_confidence',
}

export interface ConflictInfo {
  type: ConflictType;
  email_id: string;
  shipment_ids: string[];
  identifier_type: IdentifierType;
  identifier_value: string;
  resolution?: ConflictResolution;
}

export interface ConflictResolution {
  resolved_by: 'auto' | 'user';
  selected_shipment_id?: string;
  reason: string;
  resolved_at: string;
}

// ============================================================================
// UNLINKED EMAIL INFO
// ============================================================================

export interface UnlinkedEmailInfo {
  email_id: string;
  subject: string;
  received_at: string;
  sender_email: string;
  true_sender_email?: string;
  identifiers: ShipmentIdentifiers;
  document_type?: string;
  entity_confidence_score?: number;
}

// ============================================================================
// DIRECT CARRIER DOMAINS
// ============================================================================

export const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com',
  'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com',
  'evergreen-marine.com',
  'oocl.com',
  'cosco.com',
  'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];
