/**
 * Shipment Types - Layer 3 (Decision Support)
 *
 * Type definitions for shipment-centric data structures.
 * Maps to database schema from migration 004.
 */

// ============================================================================
// CORE ENTITIES
// ============================================================================

export interface Carrier {
  id: string;
  carrier_name: string;
  carrier_code: string;
  email_domains: string[];
  website_url?: string;
  created_at: string;
  updated_at: string;
}

export type PartyType =
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'freight_forwarder'
  | 'customs_broker';

export interface Party {
  id: string;
  party_name: string;
  party_type: PartyType;
  address?: string;
  city?: string;
  country?: string;
  postal_code?: string;
  contact_email?: string;
  contact_phone?: string;
  tax_id?: string;
  created_at: string;
  updated_at: string;
}

export type ShipmentStatus =
  | 'draft'
  | 'booked'
  | 'in_transit'
  | 'arrived'
  | 'delivered'
  | 'cancelled';

export type WeightUnit = 'KG' | 'LB' | 'MT';
export type VolumeUnit = 'CBM' | 'CFT';
export type DimensionUnit = 'M' | 'FT';
export type TemperatureUnit = 'C' | 'F';

export interface Shipment {
  id: string;

  // Identifiers
  booking_number?: string;
  bl_number?: string;
  container_number_primary?: string;

  // Parties
  shipper_id?: string;
  consignee_id?: string;
  notify_party_id?: string;
  carrier_id?: string;

  // Voyage information
  vessel_name?: string;
  voyage_number?: string;

  // Locations
  port_of_loading?: string;
  port_of_loading_code?: string;
  port_of_discharge?: string;
  port_of_discharge_code?: string;
  place_of_receipt?: string;
  place_of_delivery?: string;

  // Dates
  etd?: string; // ISO date
  eta?: string;
  atd?: string;
  ata?: string;
  cargo_ready_date?: string;

  // Cutoff dates
  si_cutoff?: string;      // Shipping Instruction cutoff
  vgm_cutoff?: string;     // Verified Gross Mass cutoff
  cargo_cutoff?: string;   // Cargo/CY cutoff
  gate_cutoff?: string;    // Gate-in cutoff

  // Cargo details
  commodity_description?: string;
  total_weight?: number;
  total_volume?: number;
  weight_unit?: WeightUnit;
  volume_unit?: VolumeUnit;

  // Commercial terms
  incoterms?: string;
  freight_terms?: string;

  // Status
  status: ShipmentStatus;
  status_updated_at: string;

  // Workflow (from Document-Hierarchy System)
  workflow_state?: string;
  workflow_phase?: string;
  si_reconciliation_status?: string;

  // Confirmation flags
  is_direct_carrier_confirmed?: boolean;

  // Additional fields
  doc_cutoff?: string;
  final_destination?: string;
  container_numbers?: string[];
  shipper_name?: string;
  consignee_name?: string;

  // SI Reconciliation
  si_can_submit?: boolean;
  si_block_reason?: string | null;

  // Document tracking
  last_document_update?: string;
  booking_revision_count?: number;
  si_revision_count?: number;
  hbl_revision_count?: number;

  // Milestone tracking
  milestones_total?: number;
  milestones_achieved?: number;
  milestones_missed?: number;
  next_milestone?: string | null;
  next_milestone_date?: string | null;

  // Metadata
  created_from_email_id?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// RELATIONSHIPS
// ============================================================================

export type LinkMethod =
  | 'ai'
  | 'manual'
  | 'regex'
  | 'booking_number'
  | 'bl_number'
  | 'container_number';

export interface ShipmentDocument {
  id: string;
  shipment_id: string | null;
  email_id: string;
  classification_id?: string;

  document_type: string;
  document_date?: string | null;
  document_number?: string | null;
  subject?: string;

  is_primary?: boolean;
  link_confidence_score?: number | null;
  link_method?: LinkMethod | string | null;
  link_source?: string | null;
  link_identifier_type?: string | null;
  link_identifier_value?: string | null;
  linked_by?: string | null;
  linked_at?: string | null;

  // Matched identifiers (for traceability)
  matched_booking_number?: string | null;
  matched_bl_number?: string | null;
  matched_container_number?: string | null;

  // New fields from split architecture
  attachment_id?: string;
  linking_id?: string | null;
  status?: string;

  created_at?: string;
}

export interface ShipmentContainer {
  id: string;
  shipment_id: string;

  container_number: string;
  container_type?: string;
  iso_type_code?: string;

  seal_number?: string;
  seal_type?: string;

  tare_weight?: number;
  gross_weight?: number;
  net_weight?: number;
  weight_unit?: WeightUnit;

  length?: number;
  width?: number;
  height?: number;
  dimension_unit?: DimensionUnit;

  is_reefer: boolean;
  temperature_setting?: number;
  temperature_unit?: TemperatureUnit;
  is_hazmat: boolean;
  hazmat_un_number?: string;

  created_at: string;
  updated_at: string;
}

export type EventSourceType = 'email' | 'api' | 'manual' | 'carrier_update';

export interface ShipmentEvent {
  id: string;
  shipment_id: string;

  event_type: string;
  event_date: string;
  location?: string;
  location_code?: string;
  description?: string;

  source_type: EventSourceType;
  source_email_id?: string;
  source_user_id?: string;

  is_milestone: boolean;
  created_at: string;
}

export type InvoiceType =
  | 'freight'
  | 'customs'
  | 'detention'
  | 'demurrage'
  | 'storage'
  | 'other';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'overdue'
  | 'disputed'
  | 'cancelled';

export interface ShipmentFinancial {
  id: string;
  shipment_id: string;

  invoice_id?: string;
  invoice_number?: string;
  invoice_date?: string;
  invoice_type: InvoiceType;

  amount: number;
  currency: string;

  payment_terms?: string;
  payment_due_date?: string;
  payment_status: PaymentStatus;
  paid_date?: string;
  paid_amount?: number;

  description?: string;

  created_at: string;
  updated_at: string;
}

export type LinkType =
  | 'booking_number'
  | 'bl_number'
  | 'container_number'
  | 'entity_match';

export interface ShipmentLinkCandidate {
  id: string;
  email_id: string;
  shipment_id?: string;

  link_type: LinkType;
  matched_value: string;
  confidence_score: number;
  match_reasoning?: string;

  is_confirmed: boolean;
  is_rejected: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
  rejection_reason?: string;

  created_at: string;
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'document_linked'
  | 'document_unlinked'
  | 'deleted';

export type AuditSource =
  | 'email'
  | 'manual'
  | 'api'
  | 'ai_linking'
  | 'carrier_update';

export interface ShipmentAuditLog {
  id: string;
  shipment_id: string;

  action: AuditAction;
  changed_fields?: Record<string, { old: any; new: any }>;
  change_summary?: string;

  source: AuditSource;
  source_email_id?: string;
  source_user_id?: string;

  created_at: string;
}

// ============================================================================
// AGGREGATED VIEWS
// ============================================================================

/**
 * Shipment with all related data loaded
 */
export interface ShipmentWithDetails extends Shipment {
  shipper?: Party;
  consignee?: Party;
  notify_party?: Party;
  carrier?: Carrier;
  documents: ShipmentDocument[];
  containers: ShipmentContainer[];
  events: ShipmentEvent[];
  financials: ShipmentFinancial[];
  link_candidates: ShipmentLinkCandidate[];
  audit_log: ShipmentAuditLog[];
}

/**
 * Lightweight shipment for list views
 */
export interface ShipmentListItem {
  id: string;
  booking_number?: string;
  bl_number?: string;
  shipper_name?: string;
  consignee_name?: string;
  carrier_name?: string;
  port_of_loading?: string;
  port_of_discharge?: string;
  etd?: string;
  eta?: string;
  status: ShipmentStatus;
  document_count: number;
  container_count: number;
  created_at: string;
}

/**
 * Shipment timeline for visualization
 */
export interface ShipmentTimeline {
  shipment_id: string;
  booking_number?: string;
  bl_number?: string;
  events: Array<{
    date: string;
    event_type: string;
    location?: string;
    description?: string;
    is_milestone: boolean;
    source_type: EventSourceType;
  }>;
}

// ============================================================================
// LINKING LOGIC
// ============================================================================

/**
 * Extracted identifiers from email entities used for linking
 */
export interface LinkingKeys {
  booking_numbers: string[];
  bl_numbers: string[];
  container_numbers: string[];
  invoice_numbers: string[];
  vessel_name?: string;
  voyage_number?: string;
}

/**
 * Result of linking attempt
 */
export interface LinkingResult {
  matched: boolean;
  shipment_id?: string;
  confidence_score: number;
  link_type: LinkType;
  matched_value?: string;
  reasoning: string;
}

/**
 * Linking configuration
 */
export interface LinkingConfig {
  min_confidence_for_auto_link: number; // Default 85
  min_confidence_for_suggestion: number; // Default 60
  require_manual_review_below: number; // Default 85
}
