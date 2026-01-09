/**
 * Chronicle Service Interfaces
 *
 * Defines contracts for Chronicle services.
 * Following CLAUDE.md principles:
 * - Interface-Based Design (Principle #6)
 * - Separation of Concerns (Principle #7)
 */

import {
  ProcessedEmail,
  ProcessedAttachment,
  ShippingAnalysis,
  ChronicleProcessResult,
  ChronicleBatchResult,
} from './types';

// ============================================================================
// GMAIL SERVICE INTERFACE
// ============================================================================

/**
 * Gmail service contract for email fetching
 */
export interface IGmailService {
  /**
   * Fetch emails by timestamp range
   */
  fetchEmailsByTimestamp(options: {
    after?: Date;
    before?: Date;
    maxResults?: number;
    query?: string;
  }): Promise<ProcessedEmail[]>;

  /**
   * Fetch attachment content
   */
  fetchAttachmentContent(
    messageId: string,
    attachmentId: string
  ): Promise<Buffer | null>;
}

// ============================================================================
// PDF EXTRACTOR INTERFACE
// ============================================================================

/**
 * PDF extraction contract
 */
export interface IPdfExtractor {
  /**
   * Extract text from PDF buffer
   */
  extractText(buffer: Buffer, filename?: string): Promise<string>;

  /**
   * Check if text is meaningful (not garbage/screenshots)
   */
  isTextMeaningful(text: string): boolean;
}

// ============================================================================
// AI ANALYZER INTERFACE
// ============================================================================

/**
 * AI analysis contract for email intelligence
 */
export interface IAiAnalyzer {
  /**
   * Analyze email and attachments using AI
   */
  analyze(
    email: ProcessedEmail,
    attachmentText: string
  ): Promise<ShippingAnalysis>;
}

// ============================================================================
// CHRONICLE REPOSITORY INTERFACE
// ============================================================================

/**
 * Chronicle data access contract
 */
export interface IChronicleRepository {
  /**
   * Check if email already processed
   */
  findByGmailMessageId(messageId: string): Promise<{ id: string } | null>;

  /**
   * Insert chronicle record
   */
  insert(data: ChronicleInsertData): Promise<{ id: string }>;

  /**
   * Link chronicle to shipment
   */
  linkToShipment(chronicleId: string): Promise<{
    shipmentId?: string;
    linkedBy?: string;
  }>;
}

/**
 * Data for inserting chronicle record
 */
export interface ChronicleInsertData {
  gmail_message_id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  from_party: string;
  from_address: string;
  transport_mode: string;

  // Identifiers
  booking_number: string | null;
  mbl_number: string | null;
  hbl_number: string | null;
  container_numbers: string[];
  mawb_number: string | null;
  hawb_number: string | null;
  work_order_number: string | null;
  pro_number: string | null;
  reference_numbers: string[];
  identifier_source: string;
  document_type: string;

  // 4-Point Routing
  por_location: string | null;
  por_type: string | null;
  pol_location: string | null;
  pol_type: string | null;
  pod_location: string | null;
  pod_type: string | null;
  pofd_location: string | null;
  pofd_type: string | null;

  // Vessel/Carrier
  vessel_name: string | null;
  voyage_number: string | null;
  flight_number: string | null;
  carrier_name: string | null;

  // Dates
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  pickup_date: string | null;
  delivery_date: string | null;

  // Cutoffs
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  doc_cutoff: string | null;

  // Demurrage/Detention
  last_free_day: string | null;
  empty_return_date: string | null;

  // POD
  pod_delivery_date: string | null;
  pod_signed_by: string | null;

  // Cargo
  container_type: string | null;
  weight: string | null;
  pieces: number | null;
  commodity: string | null;

  // Stakeholders
  shipper_name: string | null;
  shipper_address: string | null;
  shipper_contact: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  consignee_contact: string | null;
  notify_party_name: string | null;
  notify_party_address: string | null;
  notify_party_contact: string | null;

  // Financial
  invoice_number: string | null;
  amount: number | null;
  currency: string | null;

  // Intelligence
  message_type: string;
  sentiment: string;
  summary: string;
  has_action: boolean;
  action_description: string | null;
  action_owner: string | null;
  action_deadline: string | null;
  action_priority: string | null;
  has_issue: boolean;
  issue_type: string | null;
  issue_description: string | null;

  // Raw content
  subject: string;
  snippet: string;
  body_preview: string;
  attachments: ProcessedAttachment[];
  ai_response: ShippingAnalysis;
  ai_model: string;
  occurred_at: string;
}

// ============================================================================
// CHRONICLE SERVICE INTERFACE
// ============================================================================

/**
 * Main Chronicle service contract
 */
export interface IChronicleService {
  /**
   * Fetch emails and process them
   */
  fetchAndProcess(options: {
    after?: Date;
    before?: Date;
    maxResults?: number;
    query?: string;
  }): Promise<ChronicleBatchResult>;

  /**
   * Process a batch of emails
   */
  processBatch(emails: ProcessedEmail[]): Promise<ChronicleBatchResult>;

  /**
   * Process a single email
   */
  processEmail(email: ProcessedEmail): Promise<ChronicleProcessResult>;
}
