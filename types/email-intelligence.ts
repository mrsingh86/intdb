// Email Intelligence Types - Based on Database Schema

export interface RawEmail {
  id?: string
  gmail_message_id: string
  thread_id?: string
  subject?: string
  sender_email?: string
  sender_name?: string
  true_sender_email?: string
  recipient_emails?: string[]
  body_text?: string
  body_html?: string
  snippet?: string
  headers?: Record<string, string>
  has_attachments?: boolean
  attachment_count?: number
  labels?: string[]
  received_at?: string
  is_duplicate?: boolean
  thread_position?: number
  processing_status?: string
  email_direction?: 'inbound' | 'outbound'
  created_at?: string
  updated_at?: string
}

export interface RawAttachment {
  id?: string
  email_id: string
  filename: string
  content_type?: string
  mime_type?: string
  size_bytes?: number
  storage_path?: string
  attachment_id?: string
  extracted_text?: string
  extraction_status?: 'pending' | 'completed' | 'failed'
  extracted_at?: string
  created_at?: string
}

export interface CarrierConfig {
  id: string
  carrier_name: string
  carrier_code: string
  email_sender_patterns: string[]
  subject_patterns: Record<string, unknown>
  booking_number_regex?: string
  confidence_threshold: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ProcessingLog {
  id?: string
  run_id: string
  agent_name?: string
  carrier_id?: string
  emails_fetched?: number
  emails_processed?: number
  emails_failed?: number
  emails_duplicate?: number
  attachments_saved?: number
  started_at: string
  completed_at?: string
  status: 'running' | 'completed' | 'failed'
  error_message?: string
  metadata?: Record<string, unknown>
  created_at?: string
}

// Party types for document flow tracking - imported from intelligence-platform
import type { PartyType } from './intelligence-platform'
// Re-export for backwards compatibility
export type { PartyType }

// Document direction
export type DocumentDirection = 'inbound' | 'outbound' | 'internal'

// Workflow states
export type WorkflowState =
  | 'received'
  | 'pending_review'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'released'
  | 'forwarded'
  | 'completed'

export interface DocumentClassification {
  id: string
  email_id: string
  document_type: DocumentType
  confidence_score: number
  classification_reason: string
  classified_at: string
  model_name: string
  is_manual_review: boolean
  reviewed_by?: string
  reviewed_at?: string
  previous_classification?: DocumentType
  created_at: string
  // Phase 1 enhancement: Track document revisions (1st update, 2nd update, etc.)
  revision_type?: 'original' | 'update' | 'amendment' | 'cancellation'
  revision_number?: number
  // Phase 1 enhancement: Document flow tracking
  document_direction?: DocumentDirection
  sender_party_type?: PartyType
  receiver_party_type?: PartyType
  workflow_state?: WorkflowState
  requires_approval_from?: PartyType
  // Enhanced classification metadata (from ClassificationOrchestrator)
  // Contains: emailType, emailCategory, senderCategory, direction, trueSender, etc.
  classification_metadata?: Record<string, unknown>
  classification_method?: string
  needs_manual_review?: boolean
}

export type DocumentType =
  | 'booking_confirmation'
  | 'booking_amendment'
  | 'booking_cancellation'
  | 'arrival_notice'
  | 'bill_of_lading'
  | 'house_bl'
  | 'shipping_instruction'
  | 'si_draft'
  | 'si_submission'
  | 'si_confirmation'
  | 'invoice'
  | 'delivery_order'
  | 'proof_of_delivery'
  | 'pod_confirmation'
  | 'cargo_manifest'
  | 'customs_document'
  | 'rate_confirmation'
  | 'vessel_schedule'
  | 'container_release'
  | 'freight_invoice'
  | 'sob_confirmation'
  | 'vgm_submission'
  | 'vgm_confirmation'
  // India Export (CHA documents)
  | 'checklist'
  | 'shipping_bill'
  | 'leo_copy'
  // US Import (Customs Broker documents)
  | 'draft_entry'
  | 'entry_summary'
  | 'duty_invoice'
  | 'isf_submission'
  | 'unknown'
  | 'not_shipping'

export type EntityType =
  | 'booking_number'
  | 'bl_number'
  | 'mbl_number'
  | 'hbl_number'
  | 'vessel_name'
  | 'voyage_number'
  | 'port_of_loading'
  | 'port_of_loading_code'
  | 'port_of_discharge'
  | 'port_of_discharge_code'
  | 'place_of_receipt'
  | 'place_of_delivery'
  | 'etd'
  | 'eta'
  | 'container_number'
  | 'carrier'
  | 'shipper'
  | 'shipper_name'
  | 'consignee'
  | 'consignee_name'
  | 'notify_party'
  | 'commodity'
  | 'weight'
  | 'volume'
  | 'incoterms'
  | 'payment_terms'
  | 'amount'
  | 'currency'
  | 'reference_number'
  | 'entry_number'
  // Cutoff dates
  | 'si_cutoff'
  | 'vgm_cutoff'
  | 'cargo_cutoff'
  | 'gate_cutoff'
  | 'doc_cutoff'
  | 'seal_number'

export type ExtractionMethod = 'ai' | 'ai_comprehensive' | 'regex' | 'regex_subject' | 'manual';

export interface EntityExtraction {
  id: string
  email_id: string
  entity_type: EntityType
  entity_value: string
  confidence_score: number
  extraction_method: ExtractionMethod
  position_in_text?: number
  context_snippet?: string
  is_verified: boolean
  verified_by?: string
  verified_at?: string
  created_at: string
  // Phase 1 enhancement: Track source document type for multi-source conflict detection
  source_document_type?: DocumentType
}

export interface EmailThreadMetadata {
  id: string
  thread_id: string
  email_count: number
  unique_email_count: number
  duplicate_count: number
  thread_subject: string
  first_email_date: string
  last_email_date: string
  primary_classification?: DocumentType
  participants: string[]
  has_attachments: boolean
  created_at: string
  updated_at: string
}

// Aggregated view for UI
export interface EmailWithIntelligence extends RawEmail {
  classification?: DocumentClassification
  entities: EntityExtraction[]
  thread_metadata?: EmailThreadMetadata
}

// Dashboard Statistics
export interface DashboardStats {
  total_emails: number
  classified_emails: number
  extracted_entities: number
  unique_threads: number
  avg_confidence_score: number
  document_type_distribution: {
    type: DocumentType
    count: number
    percentage: number
  }[]
  extraction_rate: number
  manual_review_needed: number
  recent_activity: {
    date: string
    emails_processed: number
    entities_extracted: number
  }[]
}

// Confidence levels for UI display
export enum ConfidenceLevel {
  HIGH = 'high', // >= 85%
  MEDIUM = 'medium', // 60-84%
  LOW = 'low' // < 60%
}

export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 85) return ConfidenceLevel.HIGH
  if (score >= 60) return ConfidenceLevel.MEDIUM
  return ConfidenceLevel.LOW
}

// Filter and Search Types
export interface EmailFilters {
  document_type?: DocumentType[]
  confidence_level?: ConfidenceLevel[]
  date_range?: {
    from: Date
    to: Date
  }
  sender?: string[]
  has_attachments?: boolean
  needs_review?: boolean
  thread_id?: string
}

export interface SearchQuery {
  query: string
  search_in: ('subject' | 'body' | 'sender' | 'entities')[]
}