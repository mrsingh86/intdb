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
import { ThreadContext } from '../types';

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

==============================================================================
IRON-CLAD CLASSIFICATION RULE #1 (CHECK FIRST - MOST IMPORTANT):
==============================================================================

ATTACHMENT REQUIREMENT FOR MAJOR DOCUMENT TYPES:

If email has NO PDF/document attachment, it CANNOT be classified as:
- booking_confirmation (requires PDF confirmation from carrier)
- booking_amendment (requires PDF amendment document)
- shipping_instructions (requires SI PDF)
- draft_bl, final_bl, sea_waybill, house_bl (requires BL PDF)
- invoice, debit_note, credit_note (requires invoice PDF)
- arrival_notice (requires AN PDF)
- customs_entry, entry_summary, isf_filing (requires customs PDF)
- pod_proof_of_delivery (requires signed POD)
- delivery_order (requires DO PDF)
- vgm_confirmation (requires VGM PDF)

If NO attachment, classify as one of these COMMUNICATION types instead:
- approval: "OK", "Approved", "Confirmed", "Go ahead", "Proceed"
- request: "Please send", "Kindly share", "Request to", "Need"
- escalation: "Urgent", "ASAP", "Escalate", "Immediately"
- acknowledgement: "Received", "Noted", "Thanks", "Got it"
- notification: "FYI", "Please note", "For your information"
- general_correspondence: General discussion, status updates

EXCEPTIONS (these CAN be text-only):
- booking_request: Initial request email (no PDF needed)
- telex_release: Text-based BL release confirmation
- container_release: Release notification from carrier
- freight_release: Release notification
- exception_notice: Delay/issue notification
- schedule_update: ETD/ETA change notification
- tracking_update: Position update
- work_order: Trucking dispatch (sometimes text-only)

==============================================================================
IRON-CLAD CLASSIFICATION RULE #2 (SENDER-BASED ROUTING):
==============================================================================

INTERNAL NOTIFICATIONS (from @intoglo.com):
- Subject contains "Go Green" = internal_notification (NOT booking_confirmation!)
- Subject contains "Deal id" = internal_notification
- These are internal deal approvals, not carrier documents

SYSTEM NOTIFICATIONS:
- From notification@*.com or noreply@*.com = system_notification
- From ODeX (notification@odexservices.com) = system_notification (NOT final_bl!)
- Empty body with automated subject = system_notification

FRAUD RISK:
- From gmail.com/yahoo.com claiming to be carrier = flag for review
- Sender domain doesn't match claimed carrier = flag for review

==============================================================================
IRON-CLAD CLASSIFICATION RULE #3 (THREAD/REPLY HANDLING):
==============================================================================

EMAIL REPLIES (subject starts with "RE:" or "Fwd:"):
- The CONTENT of the email determines classification, NOT the subject
- If body is < 150 chars with only "OK/Approved/Confirmed" = approval (not the doc type in subject)
- If body just forwards previous email with "FYI" = notification
- Look at the LATEST message content, not quoted thread history

THREAD PROGRESSION:
- Same thread may have multiple document types (booking → SI → BL)
- Classify each email by its OWN content and attachments
- Do NOT assume all emails in thread have same document_type

==============================================================================
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

6. DATES - Use correct fields (CRITICAL FOR MULTI-LEG VOYAGES):

   DATE FORMAT RULES (VERY IMPORTANT):
   - ALL dates MUST be in YYYY-MM-DD format with FULL 4-DIGIT YEAR
   - If email says "2nd Dec" or "Dec 2" without year, use the EMAIL DATE's year
   - If date is "31st Dec" and email was sent in January, use PREVIOUS year
   - If date is "5th Jan" and email was sent in December, use NEXT year
   - NEVER output dates like "2023-12-02" for recent emails (system created 2025+)
   - For relative dates like "tomorrow", "today", "within 48 hours" - calculate from EMAIL DATE

   VALIDATION RULES:
   - Cutoff dates (SI, VGM, Cargo) MUST be BEFORE ETD (you can't submit after departure!)
   - ETA must be AFTER ETD (arrival comes after departure)
   - Transit time: International ocean typically 14-45 days

   MULTI-LEG VOYAGE STRUCTURE:
   Many shipments have multiple legs with transshipment:
   - Pre-Carrier (Feeder): POL → Transshipment Port
   - Trunk Vessel (Mother): Transshipment → Another TS or POD
   - Post-Carrier: Last TS → Final POD

   ALWAYS extract dates for FINAL ORIGIN and FINAL DESTINATION:
   - etd: ETD from Port of Loading (POL) - the FIRST vessel departure
   - eta: ETA at Port of Discharge (POD) - the FINAL destination arrival

   LOOK FOR THESE LABELS FOR FINAL DESTINATION ETA:
   - "POD ETA", "POD / DEL ETA", "Delivery ETA", "Destination ETA"
   - "Final ETA", "ETA at POD", "Arrival at [destination port name]"
   - The ETA next to "Port of Discharging" or "Place of Delivery"

   IGNORE THESE (transshipment dates):
   - "Pre-Carrier ETA/ETD" - this is feeder to transshipment
   - "Trunk Vessel ETA/ETD" at transshipment port
   - Any ETA to intermediate T/S ports (Nhava Sheva, Singapore, Colombo, etc.)

   VALIDATION:
   - International ocean freight typically takes 14-45 days
   - If ETA is within 7 days of ETD for international route = WRONG (transshipment date)
   - India → USA = ~30-40 days, India → Europe = ~20-30 days

   DEPARTURE/ARRIVAL:
   - etd: Estimated Time of Departure from POL (YYYY-MM-DD)
   - atd: Actual Time of Departure (confirmed departure)
   - eta: Estimated Time of Arrival at POD/Final Destination (YYYY-MM-DD)
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

8. ACTION DETECTION (CRITICAL - READ CAREFULLY):

   CONFIRMATION DOCUMENTS DO NOT CREATE ACTIONS:
   - vgm_confirmation = VGM was SUBMITTED → has_action: FALSE
   - si_confirmation = SI was SUBMITTED → has_action: FALSE
   - sob_confirmation = Cargo is shipped → has_action: FALSE
   - booking_confirmation = Booking is CONFIRMED → has_action: FALSE (unless genuinely requesting docs)
   - approval = Something was APPROVED → has_action: FALSE
   - acknowledgement = Receipt acknowledged → has_action: FALSE

   Even if confirmation email says "submit VGM on portal within 48 hours" - this is
   STANDARD PORT LANGUAGE appearing in ALL VGM confirmations. It does NOT mean
   VGM is pending. The confirmation itself IS proof of submission.

   WHEN TO SET has_action: TRUE:
   - Explicit requests: "Please send", "Kindly share", "Request to submit"
   - Missing documents: "We need", "Please provide", "Awaiting"
   - Pending reviews: "Please confirm", "Please approve", "Review and revert"
   - Escalations: "Urgent action required", "ASAP"

   WHEN TO SET has_action: FALSE:
   - Confirmations: "VGM submitted", "SI confirmed", "Booking confirmed"
   - Notifications: "FYI", "For your records", "Please note"
   - Status updates: "Departed", "Arrived", "Released"
   - Acknowledgements: "Received", "Noted", "Thanks"

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
          // Pre-shipment (REQUIRES ATTACHMENT)
          'rate_request', 'quotation', 'booking_request', 'booking_confirmation', 'booking_amendment',
          'shipping_instructions', 'si_confirmation', 'checklist',
          'shipping_bill', 'leo_copy', 'vgm_confirmation',
          // In-transit (REQUIRES ATTACHMENT)
          'sob_confirmation', 'draft_bl', 'final_bl', 'house_bl', 'telex_release',
          'sea_waybill', 'air_waybill',
          // Arrival & Customs (REQUIRES ATTACHMENT)
          'arrival_notice', 'customs_entry', 'entry_summary', 'isf_filing',
          'container_release', 'freight_release', 'duty_invoice',
          // Delivery (REQUIRES ATTACHMENT)
          'delivery_order', 'release_order', 'gate_pass', 'pod_proof_of_delivery',
          // Trucking
          'dispatch_order', 'work_order', 'rate_confirmation', 'bol_truck',
          // Financial (REQUIRES ATTACHMENT)
          'invoice', 'debit_note', 'credit_note', 'payment_receipt', 'statement',
          // Updates & Notifications (NO ATTACHMENT OK)
          'schedule_update', 'tracking_update', 'exception_notice',
          // Communication Types (NO ATTACHMENT - text only emails)
          'approval',              // "OK", "Approved", "Confirmed", "Proceed"
          'request',               // "Please send", "Kindly share", "Need"
          'escalation',            // "Urgent", "ASAP", "Escalate"
          'acknowledgement',       // "Received", "Noted", "Thanks", "Got it"
          'notification',          // "FYI", "Please note", "For your info"
          'internal_notification', // Intoglo "Go Green" deal approvals
          'system_notification',   // ODeX, carrier system auto-emails
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
      pod_location: { type: 'string', nullable: true, description: 'Port of Discharge (FINAL DESTINATION) - UN/LOCODE or airport code. NOT transshipment ports! Look for "Port of Discharging" or "Port of Discharge".' },
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
      eta: { type: 'string', nullable: true, description: 'Estimated Time of Arrival at FINAL DESTINATION (POD) YYYY-MM-DD. Look for "POD ETA", "DEL ETA", "Delivery ETA". IGNORE transshipment port dates!' },
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
 * Build thread context section for the prompt
 * Provides AI with history of previous emails in the thread
 */
function buildThreadContextSection(threadContext: ThreadContext): string {
  if (!threadContext.previousEmails || threadContext.previousEmails.length === 0) {
    return '';
  }

  const emailsInThread = threadContext.emailCount + 1; // +1 for current email
  let section = `\n=== THREAD CONTEXT (${emailsInThread} emails in this thread) ===\n`;
  section += `This is email #${emailsInThread} in an ongoing thread. Previous emails:\n\n`;

  // Build summary of previous emails
  for (let i = 0; i < threadContext.previousEmails.length; i++) {
    const email = threadContext.previousEmails[i];
    const date = new Date(email.occurredAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const direction = email.direction === 'inbound' ? '←' : '→';

    section += `[${i + 1}] ${date} ${direction} ${email.documentType}: ${email.summary}\n`;

    // Show key values if they exist
    const keyVals: string[] = [];
    if (email.keyValues.vesselName) keyVals.push(`vessel: ${email.keyValues.vesselName}`);
    if (email.keyValues.etd) keyVals.push(`ETD: ${email.keyValues.etd}`);
    if (email.keyValues.eta) keyVals.push(`ETA: ${email.keyValues.eta}`);
    if (keyVals.length > 0) {
      section += `    Values: ${keyVals.join(', ')}\n`;
    }
  }

  // Show aggregated known values from thread
  if (Object.keys(threadContext.knownValues).length > 0) {
    section += `\nKnown values from thread (use to detect CHANGES):\n`;
    const kv = threadContext.knownValues;
    if (kv.bookingNumber) section += `- Booking: ${kv.bookingNumber}\n`;
    if (kv.mblNumber) section += `- MBL: ${kv.mblNumber}\n`;
    if (kv.vesselName) section += `- Vessel: ${kv.vesselName}\n`;
    if (kv.etd) section += `- ETD: ${kv.etd}\n`;
    if (kv.eta) section += `- ETA: ${kv.eta}\n`;
    if (kv.containerNumbers?.length) section += `- Containers: ${kv.containerNumbers.join(', ')}\n`;
  }

  section += `\nIMPORTANT: If this email shows DIFFERENT values from above, this is an UPDATE/CHANGE.\n`;
  section += `Extract the NEW values from this email, not the old thread values.\n`;

  return section;
}

/**
 * Build the full prompt for AI analysis
 * @param emailDate - The date the email was received (for date context)
 * @param threadContext - Optional context from previous emails in thread
 */
export function buildAnalysisPrompt(
  subject: string,
  bodyPreview: string,
  attachmentText: string,
  emailDate?: Date | string,
  threadContext?: ThreadContext
): string {
  // Format email date for context
  const dateContext = emailDate
    ? `\n=== EMAIL DATE (use for date context) ===\nThis email was received on: ${new Date(emailDate).toISOString().split('T')[0]}\nUse this date when interpreting relative dates like "tomorrow", "today", or dates without year.\n`
    : '';

  // Build thread context section if available
  const threadSection = threadContext ? buildThreadContextSection(threadContext) : '';

  return `${FREIGHT_FORWARDER_PROMPT}
${dateContext}${threadSection}
=== CURRENT EMAIL (analyze this one) ===

=== SUBJECT LINE ===
${subject}

=== EMAIL BODY ===
${bodyPreview}

=== ATTACHMENTS ===
${attachmentText || '(No attachments)'}`;
}

/**
 * Validate extracted dates for logical consistency
 * Returns corrected dates or null for invalid ones
 */
export function validateExtractedDates(extracted: {
  etd?: string | null;
  eta?: string | null;
  si_cutoff?: string | null;
  vgm_cutoff?: string | null;
  cargo_cutoff?: string | null;
  action_deadline?: string | null;
}, emailDate?: Date | string): typeof extracted {
  const result = { ...extracted };
  const today = new Date();
  const emailDateObj = emailDate ? new Date(emailDate) : today;

  // Helper to check if date is reasonable (not before 2024, not more than 2 years in future)
  const isReasonableDate = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return true;
    const date = new Date(dateStr);
    const minDate = new Date('2024-01-01');
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 2);
    return date >= minDate && date <= maxDate;
  };

  // Validate and nullify bad dates
  if (!isReasonableDate(result.etd)) result.etd = null;
  if (!isReasonableDate(result.eta)) result.eta = null;
  if (!isReasonableDate(result.si_cutoff)) result.si_cutoff = null;
  if (!isReasonableDate(result.vgm_cutoff)) result.vgm_cutoff = null;
  if (!isReasonableDate(result.cargo_cutoff)) result.cargo_cutoff = null;
  if (!isReasonableDate(result.action_deadline)) result.action_deadline = null;

  // Validate cutoffs are before ETD
  if (result.etd) {
    const etdDate = new Date(result.etd);
    if (result.si_cutoff && new Date(result.si_cutoff) > etdDate) {
      result.si_cutoff = null; // Invalid: cutoff after departure
    }
    if (result.vgm_cutoff && new Date(result.vgm_cutoff) > etdDate) {
      result.vgm_cutoff = null; // Invalid: cutoff after departure
    }
    if (result.cargo_cutoff && new Date(result.cargo_cutoff) > etdDate) {
      result.cargo_cutoff = null; // Invalid: cutoff after departure
    }
  }

  // Validate ETA is after ETD
  if (result.etd && result.eta) {
    const etdDate = new Date(result.etd);
    const etaDate = new Date(result.eta);
    if (etaDate < etdDate) {
      result.eta = null; // Invalid: arrival before departure
    }
  }

  return result;
}
