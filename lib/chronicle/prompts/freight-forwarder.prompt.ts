/**
 * Freight Forwarder AI Prompt Configuration
 *
 * Extracted from chronicle-service.ts for better maintainability.
 * Contains the system prompt and tool schema for AI extraction.
 *
 * Following CLAUDE.md principles:
 * - Configuration Over Code (Principle #5)
 * - Single Responsibility (Principle #3)
 */

import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// AI MODEL CONFIGURATION
// ============================================================================

export const AI_CONFIG = {
  model: 'claude-3-5-haiku-latest',
  maxTokens: 2048,
  maxBodyChars: 4000,
  maxAttachmentChars: 8000,
} as const;

// ============================================================================
// FREIGHT FORWARDER SYSTEM PROMPT
// ============================================================================

export const FREIGHT_FORWARDER_PROMPT = `You are an experienced freight forwarder analyzing shipping communications.

CRITICAL RULES FOR IDENTIFICATION:

1. TRANSPORT MODE - Determine FIRST:
   - OCEAN: Mentions vessel, port codes (USNYC, INNSA), container numbers (4 letters + 7 digits), MBL/HBL
   - AIR: Mentions flight, airport codes (JFK, LAX), AWB numbers
   - ROAD/TRUCKING: Mentions pickup/delivery addresses, PRO numbers, work orders, drayage
   - RAIL: Mentions rail terminals, car numbers

2. IDENTIFIER PATTERNS (VERY IMPORTANT - follow exactly):

   BOOKING NUMBER (booking_number):
   - PURE NUMERIC ONLY: 2038256270, 262187584, 2038394450, 971234567
   - These are carrier booking references
   - NOT carrier-prefixed numbers (those are MBL)!
   - NOT SEINUS IDs (those are work orders)!
   - NOT container numbers!

   MBL NUMBER (mbl_number):
   - CARRIER PREFIX + DIGITS: MAEU261683714, HLCUCM2251119160, COSU6433188, MAEU261308924
   - Prefixes: MAEU (Maersk), HLCU/HLCUCM (Hapag), COSU (COSCO), OOLU (OOCL), etc.
   - This is Master Bill of Lading from ocean carrier

   CONTAINER NUMBERS (container_numbers):
   - EXACTLY 4 LETTERS + 7 DIGITS: MRKU1234567, BMOU5630848, CSNU8995220
   - Always put in container_numbers array, NEVER in booking_number!

   WORK ORDER (work_order_number):
   - SEINUS* pattern: SEINUS17112502710_I, SEINUS14112502693_I
   - This is Intoglo internal work order ID
   - NEVER put in booking_number!

   HBL NUMBER (hbl_number):
   - House Bill of Lading (NVOCC/forwarder issued)

   - invoice_number: Commercial invoice number
   - reference_numbers: Customer PO numbers, other references

3. 4-POINT ROUTING (CRITICAL - Use correct fields):

   POR (Place of Receipt) → POL (Port of Loading) → POD (Port of Discharge) → POFD (Place of Final Delivery)

   por_location: Shipper's warehouse/factory (inland origin)
   - Examples: "Mumbai Factory", "Patli", "Supplier Warehouse"
   - por_type: warehouse, factory, cfs, icd, address

   pol_location: Port/Airport where cargo LOADS onto vessel/aircraft
   - Ocean: UN/LOCODE like INNSA (Nhava Sheva), USHOU (Houston), CNSHA (Shanghai)
   - Air: Airport codes like BOM, JFK, LAX
   - pol_type: port, airport, rail_terminal

   pod_location: Port/Airport where cargo UNLOADS from vessel/aircraft
   - Ocean: UN/LOCODE like USNYC (New York), USLAX (Los Angeles)
   - Air: Airport codes like JFK, ORD
   - pod_type: port, airport, rail_terminal

   pofd_location: Consignee's warehouse/final destination (inland destination)
   - Examples: "Detroit, MI", "Oak Creek, WI", "Consignee Warehouse"
   - pofd_type: warehouse, factory, cfs, icd, address

   RULES:
   - "Nhava Sheva", "INNSA", "Mundra" = pol_location (port), NOT por
   - "Houston", "USHOU" = pod_location (port) if ocean, OR pofd_location if final destination
   - City addresses like "Detroit, MI" = pofd_location (address), NOT pod
   - For trucking-only (road mode): use por_location and pofd_location only

4. DOCUMENT TYPE CLUES:
   - "Booking Confirmation" from carrier = booking_confirmation
   - "Shipping Instructions" / "SI" = shipping_instructions
   - "Checklist" / "Document Checklist" = checklist
   - "Shipping Bill" / "LEO" / "Let Export Order" = shipping_bill or leo_copy
   - "SI Confirmation" / "Instructions Confirmed" = si_confirmation
   - "VGM" / "Verified Gross Mass" = vgm_confirmation
   - "SOB" / "Shipped on Board" / "On Board" = sob_confirmation
   - "Draft BL" / "BL Draft" = draft_bl
   - "Final BL" / "Original BL" = final_bl
   - "House BL" / "HBL" = house_bl
   - "Arrival Notice" / "AN" = arrival_notice
   - "Customs Entry" / "Entry Draft" = customs_entry
   - "Entry Summary" / "7501" = entry_summary
   - "Cargo Released" / "Container Released" = container_release
   - "Duty Invoice" / "Customs Duty" = duty_invoice
   - "Delivery Order" / "DO" = delivery_order
   - "POD" / "Proof of Delivery" = pod_proof_of_delivery
   - "Work Order" = work_order (road mode)
   - "Invoice" / "Debit Note" = invoice/debit_note (financial)

5. PARTY IDENTIFICATION:
   - ocean_carrier: Maersk, Hapag-Lloyd, CMA CGM, MSC, OOCL, Evergreen, COSCO, ONE, ZIM
   - trucker: TransJet, JB Hunt, Schneider, XPO, local drayage companies
   - customs_broker: CHB, customs house brokers
   - nvocc: Non-vessel operating carriers (forwarders with their own BLs)

9. STAKEHOLDER EXTRACTION (CRITICAL):
   Extract shipper, consignee, and notify party from BL drafts, SI, and booking confirmations:

   SHIPPER (Exporter):
   - shipper_name: Full company name of the exporter/seller
   - shipper_address: Complete address (street, city, country)
   - shipper_contact: Contact person, phone, or email if mentioned
   - Usually appears at top of BL/SI under "SHIPPER" or "EXPORTER"
   - May be labeled: "Shipper", "Exporter", "Seller", "From"

   CONSIGNEE (Importer):
   - consignee_name: Full company name of the importer/buyer
   - consignee_address: Complete address (street, city, country)
   - consignee_contact: Contact person, phone, or email if mentioned
   - Usually appears under "CONSIGNEE" or "IMPORTER"
   - May be labeled: "Consignee", "Importer", "Buyer", "To", "Deliver To"
   - "TO ORDER" or "TO ORDER OF [BANK]" = use that as consignee_name

   NOTIFY PARTY:
   - notify_party_name: Full company name to notify on arrival
   - notify_party_address: Complete address
   - notify_party_contact: Contact details
   - Usually appears under "NOTIFY PARTY" or "NOTIFY"
   - Often same as consignee but can be different (e.g., customs broker, agent)

   RULES:
   - Extract EXACTLY as written in document (preserve formatting)
   - Include full address with postal code if available
   - If party has "C/O" (care of), include that
   - Skip internal Intoglo references (we want the real customer parties)
   - On freight forwarder BLs, shipper may be the actual customer, not the forwarder

6. DATES - Use correct fields:

   DEPARTURE/ARRIVAL:
   - etd: Estimated Time of Departure (vessel/flight leaves)
   - atd: Actual Time of Departure (confirmed departure)
   - eta: Estimated Time of Arrival (vessel/flight arrives)
   - ata: Actual Time of Arrival (confirmed arrival)

   CUTOFFS (CRITICAL for operations):
   - si_cutoff: Shipping Instructions deadline
   - vgm_cutoff: Verified Gross Mass deadline
   - cargo_cutoff: Container gate-in deadline at port
   - doc_cutoff: Documentation deadline

   TRUCKING:
   - pickup_date: When trucker picks up cargo
   - delivery_date: When cargo delivered to destination

   DEMURRAGE/DETENTION:
   - last_free_day: Last day before storage charges (LFD)
   - empty_return_date: Deadline to return empty container

7. ISSUE DETECTION:
   - "Hold", "Freight Hold", "Customs Hold" = has_issue: true, issue_type: hold
   - "Delay", "Rolled", "Rollover" = has_issue: true, issue_type: delay/rollover
   - "Demurrage", "Detention", "LFD" = has_issue: true, issue_type: demurrage/detention
   - "Urgent", "ASAP", "Immediately" = sentiment: urgent

8. ACTION DETECTION:
   - "Please arrange", "Kindly confirm", "Request to" = has_action: true
   - "FYI", "For your records", "Please note" = has_action: false (just notification)

Extract information from:
- SUBJECT LINE: Most reliable for identifiers
- EMAIL BODY: Actions, sentiment, communication context
- ATTACHMENTS: Document details, logistics specifics

All dates must be in YYYY-MM-DD format.`;

// ============================================================================
// TOOL SCHEMA FOR STRUCTURED EXTRACTION
// ============================================================================

export const ANALYZE_TOOL_SCHEMA: Anthropic.Tool = {
  name: 'analyze_freight_communication',
  description: 'Analyze freight forwarding email with comprehensive extraction',
  input_schema: {
    type: 'object',
    properties: {
      // Transport mode
      transport_mode: {
        type: 'string',
        enum: ['ocean', 'air', 'road', 'rail', 'multimodal', 'unknown'],
        description: 'Primary transport mode for this shipment',
      },

      // Ocean identifiers
      booking_number: { type: 'string', nullable: true, description: 'PURE NUMERIC carrier booking (e.g., 2038256270, 262187584). NOT carrier-prefixed (those are MBL), NOT SEINUS, NOT containers!' },
      mbl_number: { type: 'string', nullable: true, description: 'Master BL with carrier prefix (e.g., MAEU261683714, HLCUCM2251119160, COSU6433188)' },
      hbl_number: { type: 'string', nullable: true, description: 'House Bill of Lading number' },
      container_numbers: { type: 'array', items: { type: 'string' }, description: 'Container numbers: EXACTLY 4 letters + 7 digits (e.g., MRKU1234567, CSNU8995220)' },

      // Air identifiers
      mawb_number: { type: 'string', nullable: true, description: 'Master Air Waybill number' },
      hawb_number: { type: 'string', nullable: true, description: 'House Air Waybill number' },

      // Trucking/Internal identifiers
      work_order_number: { type: 'string', nullable: true, description: 'SEINUS* IDs (e.g., SEINUS17112502710_I) or trucking dispatch numbers. NOT booking numbers!' },
      pro_number: { type: 'string', nullable: true, description: 'Progressive/PRO number for LTL shipments' },
      load_number: { type: 'string', nullable: true, description: 'Load or trip number' },

      // Universal
      reference_numbers: { type: 'array', items: { type: 'string' } },
      identifier_source: { type: 'string', enum: ['subject', 'body', 'attachment'] },

      // Document type
      document_type: {
        type: 'string',
        enum: [
          // Pre-shipment
          'rate_request', 'quotation', 'booking_request', 'booking_confirmation', 'booking_amendment',
          'shipping_instructions', 'si_confirmation', 'checklist',
          'shipping_bill', 'leo_copy', 'vgm_confirmation',
          // In-transit
          'sob_confirmation', 'draft_bl', 'final_bl', 'house_bl', 'telex_release',
          'sea_waybill', 'air_waybill',
          // Arrival & Customs
          'arrival_notice', 'customs_entry', 'entry_summary', 'isf_filing',
          'container_release', 'freight_release', 'duty_invoice',
          // Delivery
          'delivery_order', 'release_order', 'gate_pass', 'pod_proof_of_delivery',
          // Trucking
          'dispatch_order', 'work_order', 'rate_confirmation', 'bol_truck',
          // Financial
          'invoice', 'debit_note', 'credit_note', 'payment_receipt', 'statement',
          // Updates & General
          'schedule_update', 'tracking_update', 'exception_notice',
          'general_correspondence', 'internal_communication', 'unknown',
        ],
      },

      // Party
      from_party: {
        type: 'string',
        enum: ['ocean_carrier', 'airline', 'nvocc', 'trucker', 'warehouse', 'terminal',
               'customs_broker', 'freight_broker', 'shipper', 'consignee', 'customer', 'notify_party', 'intoglo', 'unknown'],
      },

      // 4-Point Routing Locations
      por_location: { type: 'string', nullable: true, description: 'Place of Receipt - shipper warehouse/factory' },
      por_type: { type: 'string', enum: ['warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown'], nullable: true },
      pol_location: { type: 'string', nullable: true, description: 'Port of Loading - UN/LOCODE (INNSA) or airport code' },
      pol_type: { type: 'string', enum: ['port', 'airport', 'rail_terminal', 'unknown'], nullable: true },
      pod_location: { type: 'string', nullable: true, description: 'Port of Discharge - UN/LOCODE or airport code' },
      pod_type: { type: 'string', enum: ['port', 'airport', 'rail_terminal', 'unknown'], nullable: true },
      pofd_location: { type: 'string', nullable: true, description: 'Place of Final Delivery - consignee warehouse/address' },
      pofd_type: { type: 'string', enum: ['warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown'], nullable: true },

      // Vessel/Carrier
      vessel_name: { type: 'string', nullable: true },
      voyage_number: { type: 'string', nullable: true },
      flight_number: { type: 'string', nullable: true },
      carrier_name: { type: 'string', nullable: true },
      carrier_scac: { type: 'string', nullable: true },

      // Dates - Estimated vs Actual
      etd: { type: 'string', nullable: true, description: 'Estimated Time of Departure YYYY-MM-DD' },
      atd: { type: 'string', nullable: true, description: 'Actual Time of Departure YYYY-MM-DD' },
      eta: { type: 'string', nullable: true, description: 'Estimated Time of Arrival YYYY-MM-DD' },
      ata: { type: 'string', nullable: true, description: 'Actual Time of Arrival YYYY-MM-DD' },
      pickup_date: { type: 'string', nullable: true, description: 'Trucking pickup date' },
      delivery_date: { type: 'string', nullable: true, description: 'Trucking delivery date' },

      // Cutoffs
      si_cutoff: { type: 'string', nullable: true, description: 'Shipping Instructions cutoff YYYY-MM-DD' },
      vgm_cutoff: { type: 'string', nullable: true, description: 'VGM cutoff YYYY-MM-DD' },
      cargo_cutoff: { type: 'string', nullable: true, description: 'Cargo gate-in cutoff YYYY-MM-DD' },
      doc_cutoff: { type: 'string', nullable: true, description: 'Documentation cutoff YYYY-MM-DD' },

      // Demurrage/Detention
      last_free_day: { type: 'string', nullable: true, description: 'Last Free Day before charges YYYY-MM-DD' },
      empty_return_date: { type: 'string', nullable: true, description: 'Empty container return deadline YYYY-MM-DD' },

      // POD (Proof of Delivery)
      pod_delivery_date: { type: 'string', nullable: true, description: 'Actual delivery date from POD document YYYY-MM-DD' },
      pod_signed_by: { type: 'string', nullable: true, description: 'Name of person who signed the POD' },

      // Cargo
      container_type: { type: 'string', nullable: true },
      weight: { type: 'string', nullable: true },
      pieces: { type: 'number', nullable: true },
      commodity: { type: 'string', nullable: true },

      // Stakeholders - Shipper
      shipper_name: { type: 'string', nullable: true, description: 'Full company name of exporter/seller' },
      shipper_address: { type: 'string', nullable: true, description: 'Complete shipper address' },
      shipper_contact: { type: 'string', nullable: true, description: 'Shipper contact person/phone/email' },

      // Stakeholders - Consignee
      consignee_name: { type: 'string', nullable: true, description: 'Full company name of importer/buyer' },
      consignee_address: { type: 'string', nullable: true, description: 'Complete consignee address' },
      consignee_contact: { type: 'string', nullable: true, description: 'Consignee contact person/phone/email' },

      // Stakeholders - Notify Party
      notify_party_name: { type: 'string', nullable: true, description: 'Company to notify on arrival' },
      notify_party_address: { type: 'string', nullable: true, description: 'Notify party address' },
      notify_party_contact: { type: 'string', nullable: true, description: 'Notify party contact details' },

      // Financial
      invoice_number: { type: 'string', nullable: true },
      amount: { type: 'number', nullable: true },
      currency: { type: 'string', nullable: true },
      payment_terms: { type: 'string', nullable: true },

      // Intelligence
      message_type: {
        type: 'string',
        enum: ['confirmation', 'request', 'update', 'action_required', 'issue_reported',
               'escalation', 'acknowledgement', 'query', 'instruction', 'notification', 'general', 'unknown'],
      },
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'urgent'] },
      summary: { type: 'string', maxLength: 150 },

      // Actions
      has_action: { type: 'boolean' },
      action_description: { type: 'string', nullable: true },
      action_owner: {
        type: 'string',
        enum: ['operations', 'documentation', 'finance', 'customer', 'carrier', 'trucker', 'broker', 'warehouse'],
        nullable: true,
      },
      action_deadline: { type: 'string', nullable: true },
      action_priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], nullable: true },

      // Issues
      has_issue: { type: 'boolean' },
      issue_type: {
        type: 'string',
        enum: ['delay', 'hold', 'damage', 'shortage', 'documentation', 'payment',
               'capacity', 'rollover', 'detention', 'demurrage', 'other'],
        nullable: true,
      },
      issue_description: { type: 'string', nullable: true },
    },
    required: ['transport_mode', 'identifier_source', 'document_type', 'from_party',
               'message_type', 'sentiment', 'summary', 'has_action', 'has_issue'],
  },
};

// ============================================================================
// PROMPT BUILDER
// ============================================================================

/**
 * Build the full prompt for AI analysis
 */
export function buildAnalysisPrompt(
  subject: string,
  bodyPreview: string,
  attachmentText: string
): string {
  return `${FREIGHT_FORWARDER_PROMPT}

=== SUBJECT LINE ===
${subject}

=== EMAIL BODY ===
${bodyPreview}

=== ATTACHMENTS ===
${attachmentText || '(No attachments)'}`;
}
