/**
 * Chronicle Types
 *
 * Comprehensive schema for freight forwarding intelligence.
 * Designed by experienced freight forwarder perspective.
 */

import { z } from 'zod';

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Date transform - handles invalid/unknown values
 */
const dateTransform = z.string().nullish().transform(v => {
  if (!v) return null;
  // Handle various "unknown" formats: <UNKNOWN>, UNKNOWN, TBD, N/A, etc.
  const normalized = v.trim().toUpperCase();
  if (normalized.includes('UNKNOWN') || normalized === 'TBD' || normalized === 'N/A' || normalized === 'NA') {
    return null;
  }
  // Must be valid date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
});

/**
 * AI extraction schema - comprehensive freight forwarding intelligence
 *
 * IMPORTANT: This schema is designed to handle:
 * - Ocean freight (FCL/LCL)
 * - Air freight
 * - Inland trucking/drayage
 * - Rail
 * - Multimodal shipments
 */
export const analyzeShippingCommunicationSchema = z.object({
  // =========================================================================
  // TRANSPORT MODE - Determine this FIRST, it affects all other fields
  // =========================================================================
  transport_mode: z.enum([
    'ocean',      // Sea freight - uses ports, vessels, container numbers
    'air',        // Air freight - uses airports, flights, AWB numbers
    'road',       // Trucking/drayage - uses addresses, PRO/load numbers
    'rail',       // Rail freight - uses rail terminals, car numbers
    'multimodal', // Combined modes
    'unknown'
  ]),

  // =========================================================================
  // IDENTIFIERS - Different by transport mode
  // =========================================================================

  // Ocean/Sea identifiers
  booking_number: z.string().nullish().describe('PURE NUMERIC carrier booking (2038256270, 262187584). NOT carrier-prefixed, NOT SEINUS, NOT containers'),
  mbl_number: z.string().nullish().describe('Master BL with carrier prefix (MAEU261683714, HLCUCM2251119160, COSU6433188)'),
  hbl_number: z.string().nullish().describe('House Bill of Lading number'),
  container_numbers: z.array(z.string()).default([]).describe('Container numbers: 4 letters + 7 digits (MRKU1234567, CSNU8995220)'),

  // Air identifiers
  mawb_number: z.string().nullish().describe('Master Air Waybill'),
  hawb_number: z.string().nullish().describe('House Air Waybill'),

  // Trucking/Internal identifiers
  work_order_number: z.string().nullish().describe('SEINUS* pattern (SEINUS17112502710_I) or trucking dispatch number'),
  pro_number: z.string().nullish().describe('Progressive/PRO number for LTL shipments'),
  load_number: z.string().nullish().describe('Load or trip number'),

  // Universal identifiers
  reference_numbers: z.array(z.string()).default([]).describe('Customer PO, reference, job numbers'),

  // Where the primary identifier was found
  identifier_source: z.enum(['subject', 'body', 'attachment']).default('body'),

  // =========================================================================
  // DOCUMENT CLASSIFICATION
  // =========================================================================
  document_type: z.enum([
    // Booking stage (REQUIRES ATTACHMENT)
    'rate_request', 'quotation', 'booking_request', 'booking_confirmation', 'booking_amendment',
    // Documentation stage (REQUIRES ATTACHMENT)
    'shipping_instructions', 'si_confirmation', 'draft_bl', 'final_bl', 'telex_release',
    'sea_waybill', 'air_waybill', 'house_bl', 'sob_confirmation',
    // Arrival/Delivery stage (REQUIRES ATTACHMENT)
    'arrival_notice', 'delivery_order', 'release_order', 'gate_pass',
    'container_release', 'freight_release', 'pod_proof_of_delivery',
    // Trucking specific
    'dispatch_order', 'work_order', 'rate_confirmation', 'bol_truck',
    // Compliance (REQUIRES ATTACHMENT)
    'vgm_confirmation', 'customs_entry', 'entry_summary', 'isf_filing', 'duty_invoice',
    'shipping_bill', 'leo_copy', 'checklist',
    // Financial (REQUIRES ATTACHMENT)
    'invoice', 'debit_note', 'credit_note', 'payment_receipt', 'statement',
    // Updates & Notifications (NO ATTACHMENT OK)
    'schedule_update', 'tracking_update', 'exception_notice',
    // Communication Types (NO ATTACHMENT - text only emails)
    'approval',              // "OK", "Approved", "Confirmed", "Proceed"
    'request',               // "Please send", "Kindly share", "Need"
    'escalation',            // "Urgent", "ASAP", "Escalate"
    'acknowledgement',       // "Received", "Noted", "Thanks"
    'notification',          // "FYI", "Please note"
    'internal_notification', // Intoglo internal deal approvals
    'system_notification',   // ODeX, carrier system auto-emails
    'general_correspondence', 'internal_communication', 'unknown',
  ]),

  // =========================================================================
  // PARTIES
  // =========================================================================
  from_party: z.enum([
    'ocean_carrier',   // Maersk, Hapag, CMA CGM, etc.
    'airline',         // Delta Cargo, Emirates SkyCargo, etc.
    'nvocc',           // Non-Vessel Operating Common Carrier
    'trucker',         // Drayage/trucking company
    'warehouse',       // CFS, warehouse operator
    'terminal',        // Port terminal, rail terminal
    'customs_broker',  // CHB, customs house broker
    'freight_broker',  // Truck freight broker
    'shipper',         // Exporter/seller
    'consignee',       // Importer/buyer
    'customer',        // Generic customer
    'notify_party',
    'intoglo',         // Internal
    'unknown',
  ]),

  // =========================================================================
  // STAKEHOLDERS - Extracted from BL/SI documents
  // =========================================================================

  // Shipper (Exporter)
  shipper_name: z.string().nullish().describe('Full company name of exporter/seller'),
  shipper_address: z.string().nullish().describe('Complete shipper address'),
  shipper_contact: z.string().nullish().describe('Shipper contact person/phone/email'),

  // Consignee (Importer)
  consignee_name: z.string().nullish().describe('Full company name of importer/buyer'),
  consignee_address: z.string().nullish().describe('Complete consignee address'),
  consignee_contact: z.string().nullish().describe('Consignee contact person/phone/email'),

  // Notify Party
  notify_party_name: z.string().nullish().describe('Company to notify on arrival'),
  notify_party_address: z.string().nullish().describe('Notify party address'),
  notify_party_contact: z.string().nullish().describe('Notify party contact details'),

  // =========================================================================
  // LOCATIONS - 4-Point Routing (Industry Standard)
  // POR → POL → POD → POFD
  // =========================================================================

  // Place of Receipt (origin - shipper's warehouse/factory)
  por_location: z.string().nullish().describe('Place of Receipt - shipper warehouse/factory address or city'),
  por_type: z.enum(['warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown']).nullish(),

  // Port of Loading (ocean/air departure point)
  pol_location: z.string().nullish().describe('Port of Loading - UN/LOCODE (INNSA, USNYC) or airport code (BOM, JFK)'),
  pol_type: z.enum(['port', 'airport', 'rail_terminal', 'unknown']).nullish(),

  // Port of Discharge (ocean/air arrival point)
  pod_location: z.string().nullish().describe('Port of Discharge - UN/LOCODE or airport code'),
  pod_type: z.enum(['port', 'airport', 'rail_terminal', 'unknown']).nullish(),

  // Place of Final Delivery (destination - consignee's warehouse)
  pofd_location: z.string().nullish().describe('Place of Final Delivery - consignee warehouse/address or city'),
  pofd_type: z.enum(['warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown']).nullish(),

  // =========================================================================
  // VESSEL/CARRIER DETAILS
  // =========================================================================
  vessel_name: z.string().nullish().describe('Ship name for ocean freight'),
  voyage_number: z.string().nullish(),
  flight_number: z.string().nullish().describe('Flight number for air freight'),
  carrier_name: z.string().nullish().describe('Operating carrier name'),
  carrier_scac: z.string().nullish().describe('Standard Carrier Alpha Code'),

  // =========================================================================
  // DATES - Estimated vs Actual
  // =========================================================================
  etd: dateTransform.describe('Estimated Time of Departure YYYY-MM-DD'),
  atd: dateTransform.describe('Actual Time of Departure YYYY-MM-DD'),
  eta: dateTransform.describe('Estimated Time of Arrival YYYY-MM-DD'),
  ata: dateTransform.describe('Actual Time of Arrival YYYY-MM-DD'),

  // Trucking dates
  pickup_date: dateTransform.describe('Scheduled pickup date for trucking'),
  delivery_date: dateTransform.describe('Scheduled/actual delivery date'),

  // =========================================================================
  // CUTOFFS - Multiple Types (Critical for Operations)
  // =========================================================================
  si_cutoff: dateTransform.describe('Shipping Instructions cutoff date'),
  vgm_cutoff: dateTransform.describe('Verified Gross Mass cutoff date'),
  cargo_cutoff: dateTransform.describe('Cargo/container gate-in cutoff date'),
  doc_cutoff: dateTransform.describe('Documentation cutoff date'),

  // =========================================================================
  // DEMURRAGE & DETENTION
  // =========================================================================
  last_free_day: dateTransform.describe('Last Free Day before demurrage/detention charges'),
  empty_return_date: dateTransform.describe('Empty container return deadline'),

  // =========================================================================
  // POD (PROOF OF DELIVERY) - Extracted from POD documents
  // =========================================================================
  pod_delivery_date: dateTransform.describe('Actual delivery date from POD document'),
  pod_signed_by: z.string().nullish().describe('Name of person who signed the POD'),

  // =========================================================================
  // CARGO DETAILS
  // =========================================================================
  container_type: z.string().nullish().describe('20GP, 40HC, 45HC, etc.'),
  weight: z.string().nullish().describe('Weight with unit (e.g., 18500 KGS)'),
  pieces: z.number().nullish().describe('Number of pieces/packages'),
  commodity: z.string().nullish().describe('Brief cargo description'),

  // =========================================================================
  // FINANCIAL
  // =========================================================================
  invoice_number: z.string().nullish().describe('Invoice or debit note number'),
  amount: z.number().nullish().describe('Total amount'),
  currency: z.string().nullish().describe('Currency code USD, EUR, INR'),
  payment_terms: z.string().nullish().describe('Prepaid, Collect, etc.'),

  // =========================================================================
  // MESSAGE INTELLIGENCE
  // =========================================================================
  message_type: z.enum([
    'confirmation',      // Acknowledging/confirming something
    'request',           // Asking for something
    'update',            // Status or schedule update
    'action_required',   // Needs response/action
    'issue_reported',    // Problem, delay, exception
    'escalation',        // Urgent issue needing attention
    'acknowledgement',   // Simple "got it" response
    'query',             // Question asking for information
    'instruction',       // Giving directions/orders
    'notification',      // FYI, no action needed
    'general',
    'unknown',           // When message intent is unclear
  ]),

  sentiment: z.enum([
    'positive',   // Good news, confirmed, on track
    'neutral',    // Standard communication
    'negative',   // Problem, delay, issue
    'urgent',     // Time-sensitive, needs immediate attention
  ]),

  // One-line summary of what this email is about
  summary: z.string().max(150).default('No summary available'),

  // =========================================================================
  // ACTIONS
  // =========================================================================
  has_action: z.boolean(),
  action_description: z.string().nullish(),
  action_owner: z.enum([
    'operations',    // Intoglo ops team
    'documentation', // Docs team
    'finance',       // Accounts team
    'customer',      // Shipper/consignee needs to act
    'carrier',       // Carrier needs to act
    'trucker',       // Trucker/drayage needs to act
    'broker',        // Customs broker needs to act
    'warehouse',     // Warehouse needs to act
  ]).nullish(),
  action_deadline: dateTransform,
  action_priority: z.enum(['low', 'medium', 'high', 'critical']).nullish(),

  // =========================================================================
  // ISSUES & EXCEPTIONS
  // =========================================================================
  has_issue: z.boolean().default(false),
  issue_type: z.enum([
    'delay',           // Schedule delay
    'hold',            // Customs/freight hold
    'damage',          // Cargo damage
    'shortage',        // Missing cargo
    'documentation',   // Missing/wrong docs
    'payment',         // Payment issue
    'capacity',        // No space/equipment
    'rollover',        // Cargo rolled to next vessel
    'detention',       // Container detention
    'demurrage',       // Port storage charges
    'other',
  ]).nullish(),
  issue_description: z.string().nullish(),
});

export type ShippingAnalysis = z.infer<typeof analyzeShippingCommunicationSchema>;

// ============================================================================
// TYPESCRIPT TYPES
// ============================================================================

export interface ProcessedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  extractedText?: string;
  attachmentId?: string;
}

export interface ProcessedEmail {
  gmailMessageId: string;
  threadId: string;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml?: string;
  senderEmail: string;
  senderName?: string;
  recipientEmails: string[];
  direction: 'inbound' | 'outbound';
  receivedAt: Date;
  attachments: ProcessedAttachment[];
}

export interface ChronicleRecord {
  id?: string;
  gmailMessageId: string;
  threadId: string;
  shipmentId?: string;
  linkedBy?: string;
  direction: 'inbound' | 'outbound';
  fromParty: string;
  fromAddress: string;
  transportMode: string;

  // Identifiers
  bookingNumber?: string;
  mblNumber?: string;
  hblNumber?: string;
  containerNumbers: string[];
  mawbNumber?: string;
  hawbNumber?: string;
  workOrderNumber?: string;
  proNumber?: string;
  referenceNumbers: string[];
  identifierSource: string;
  documentType: string;

  // 4-Point Routing Locations
  porLocation?: string;      // Place of Receipt
  porType?: string;
  polLocation?: string;      // Port of Loading
  polType?: string;
  podLocation?: string;      // Port of Discharge
  podType?: string;
  pofdLocation?: string;     // Place of Final Delivery
  pofdType?: string;

  // Legacy location fields (kept for backward compatibility)
  originLocation?: string;
  originType?: string;
  destinationLocation?: string;
  destinationType?: string;

  // Stakeholders
  shipperName?: string;
  shipperAddress?: string;
  shipperContact?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeContact?: string;
  notifyPartyName?: string;
  notifyPartyAddress?: string;
  notifyPartyContact?: string;

  // Vessel/Carrier
  vesselName?: string;
  voyageNumber?: string;
  flightNumber?: string;
  carrierName?: string;

  // Dates - Estimated vs Actual
  etd?: string;
  atd?: string;
  eta?: string;
  ata?: string;
  pickupDate?: string;
  deliveryDate?: string;

  // Cutoffs
  siCutoff?: string;
  vgmCutoff?: string;
  cargoCutoff?: string;
  docCutoff?: string;

  // Demurrage & Detention
  lastFreeDay?: string;
  emptyReturnDate?: string;

  // POD (Proof of Delivery)
  podDeliveryDate?: string;
  podSignedBy?: string;

  // Intelligence
  messageType: string;
  sentiment: string;
  summary: string;

  // Actions
  hasAction: boolean;
  actionDescription?: string;
  actionOwner?: string;
  actionDeadline?: string;
  actionPriority?: string;

  // Issues
  hasIssue: boolean;
  issueType?: string;
  issueDescription?: string;

  // Financial
  invoiceNumber?: string;
  amount?: number;
  currency?: string;

  // Raw content
  subject: string;
  snippet: string;
  bodyPreview: string;
  attachments: ProcessedAttachment[];
  aiResponse: ShippingAnalysis;
  aiModel: string;
  occurredAt: Date;
}

export interface ChronicleProcessResult {
  success: boolean;
  gmailMessageId: string;
  chronicleId?: string;
  shipmentId?: string;
  linkedBy?: string;
  error?: string;
}

export interface ChronicleBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  linked: number;
  totalTimeMs: number;
  results: ChronicleProcessResult[];
}

// ============================================================================
// THREAD CONTEXT TYPES
// ============================================================================

/**
 * Summary of a previous email in the thread
 * Used to provide context to AI when analyzing current email
 */
export interface ThreadEmailSummary {
  occurredAt: string;
  subject: string;
  documentType: string;
  summary: string;
  direction: 'inbound' | 'outbound';
  fromParty: string;
  hasIssue: boolean;
  hasAction: boolean;
  // Key extracted values that might have changed
  keyValues: {
    vesselName?: string;
    etd?: string;
    eta?: string;
    bookingNumber?: string;
    mblNumber?: string;
    containerNumbers?: string[];
  };
}

/**
 * Thread context to pass to AI for better analysis
 * Enables understanding of email progression and changes
 */
export interface ThreadContext {
  threadId: string;
  emailCount: number;
  previousEmails: ThreadEmailSummary[];
  // Aggregated known values from the thread
  knownValues: {
    bookingNumber?: string;
    mblNumber?: string;
    hblNumber?: string;
    vesselName?: string;
    voyageNumber?: string;
    carrierName?: string;
    etd?: string;
    eta?: string;
    containerNumbers?: string[];
    shipperName?: string;
    consigneeName?: string;
  };
  // Thread metadata
  firstEmailDate?: string;
  lastEmailDate?: string;
  linkedShipmentId?: string;
}

// ============================================================================
// SYNC STATE TYPES (for hybrid historyId + timestamp fetching)
// ============================================================================

export interface ChronicleSyncState {
  id: string;
  lastHistoryId: string | null;
  lastSyncAt: string | null;
  lastFullSyncAt: string | null;
  syncStatus: 'active' | 'error' | 'initial';
  consecutiveFailures: number;
  emailsSyncedTotal: number;
}

export type SyncMode = 'history' | 'timestamp' | 'initial' | 'weekly_full';

export interface SyncResult {
  messageIds: string[];
  historyId: string | null;
  syncMode: SyncMode;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const INTOGLO_DOMAINS = [
  'intoglo.com',
  'intoglo.co',
  'intoglobal.com',
];

const OCEAN_CARRIER_DOMAINS = [
  'maersk.com', 'hapag-lloyd.com', 'cma-cgm.com', 'msc.com',
  'evergreen-marine.com', 'cosco.com', 'one-line.com', 'yangming.com',
  'oocl.com', 'hmm21.com', 'zim.com', 'pfresco.com',
];

const TRUCKER_DOMAINS = [
  'transjetcargo.com', 'jbhunt.com', 'schneider.com', 'xpo.com',
];

/**
 * Detect email direction based on sender
 */
export function detectDirection(
  senderEmail: string,
  trueSenderEmail?: string
): 'inbound' | 'outbound' {
  const effectiveSender = trueSenderEmail || senderEmail;
  const senderLower = effectiveSender.toLowerCase();

  for (const domain of INTOGLO_DOMAINS) {
    if (senderLower.includes(domain)) {
      return 'outbound';
    }
  }

  return 'inbound';
}

/**
 * Detect party type from email address
 */
export function detectPartyType(email: string): string {
  const emailLower = email.toLowerCase();

  for (const domain of INTOGLO_DOMAINS) {
    if (emailLower.includes(domain)) return 'intoglo';
  }

  for (const domain of OCEAN_CARRIER_DOMAINS) {
    if (emailLower.includes(domain)) return 'ocean_carrier';
  }

  for (const domain of TRUCKER_DOMAINS) {
    if (emailLower.includes(domain)) return 'trucker';
  }

  if (emailLower.includes('broker') || emailLower.includes('customs')) {
    return 'customs_broker';
  }

  return 'unknown';
}

/**
 * Extract true sender from forwarded emails
 */
export function extractTrueSender(email: ProcessedEmail): string {
  const originalSenderMatch = email.bodyText.match(
    /X-Original-Sender:\s*([^\s<]+@[^\s>]+)/i
  );
  if (originalSenderMatch) return originalSenderMatch[1];

  const forwardedFromMatch = email.bodyText.match(
    /From:\s*(?:[^<]*<)?([^\s<]+@[^\s>]+)/i
  );
  if (forwardedFromMatch) return forwardedFromMatch[1];

  return email.senderEmail;
}

/**
 * Check if email is from a group mailbox
 */
export function isGroupEmail(email: string): boolean {
  const groupPatterns = [
    /^ops@/i, /^operations@/i, /^team@/i, /^info@/i,
    /^support@/i, /^booking@/i, /^export@/i, /^import@/i,
    /^docs@/i, /^documentation@/i, /^accounts@/i,
  ];
  return groupPatterns.some(pattern => pattern.test(email));
}
