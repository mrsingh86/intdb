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
import { ThreadContext, FlowContext } from '../types';

// ============================================================================
// AI MODEL CONFIGURATION
// ============================================================================

export const AI_CONFIG = {
  model: process.env.CHRONICLE_AI_MODEL || 'claude-3-5-haiku-latest',
  maxTokens: parseInt(process.env.CHRONICLE_AI_MAX_TOKENS || '2048', 10),
  maxBodyChars: parseInt(process.env.CHRONICLE_AI_MAX_BODY_CHARS || '4000', 10),
  maxAttachmentChars: parseInt(process.env.CHRONICLE_AI_MAX_ATTACHMENT_CHARS || '8000', 10),
};

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
- approval: "OK", "Approved", "Confirmed", "Go ahead", "Proceed", "Received", "Noted", "Thanks"
- request: "Please send", "Kindly share", "Request to", "Need"
- escalation: "Urgent", "ASAP", "Escalate", "Immediately"
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
- From notification@*.com or noreply@*.com = internal_notification
- From ODeX (notification@odexservices.com) = internal_notification (NOT final_bl!)
- Empty body with automated subject = internal_notification

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
IRON-CLAD CLASSIFICATION RULE #4 (INQUIRY TYPE - CRITICAL):
==============================================================================

NOT EVERYTHING IS A RATE REQUEST! Use this decision tree:

rate_request - ONLY when asking for PRICING/QUOTES:
  ✓ "Please quote rates for Mumbai to New York"
  ✓ "Need freight rates for 40HC"
  ✓ "What's your rate for LCL?"
  ✗ "Can you handle warehouse in Chicago?" (NOT rate_request)
  ✗ "Do you have coverage in Texas?" (NOT rate_request)
  ✗ "Following up on arrival notice" (NOT rate_request)

general_correspondence - For SERVICE INQUIRIES and DISCUSSIONS:
  ✓ "Warehouse coverage" questions
  ✓ "Do you service this area?"
  ✓ "Can you handle customs clearance?"
  ✓ Follow-up discussions without specific document

tracking_update - For SHIPMENT STATUS discussions:
  ✓ "Re: Arrival Notice" with questions/updates
  ✓ "When will container be released?"
  ✓ "What's the delivery status?"
  ✓ Discussion about existing shipment progress

sob_confirmation - For SHIPPED ON BOARD discussions:
  ✓ Subject/body contains "SOB" or "Shipped on Board"
  ✓ Confirmation that cargo is on vessel

SIMPLE TEST: Does the email explicitly ask "how much?" or "what's the rate?"
  YES → rate_request
  NO → general_correspondence, tracking_update, or the appropriate document type

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

   ┌────────────────────────────────────────────────────────────────────────┐
   │ CARRIER-SPECIFIC BOOKING/MBL FORMATS (from production data analysis)  │
   └────────────────────────────────────────────────────────────────────────┘

   MAERSK (Most common in our system):
   - Booking: Pure numeric 9 digits → 263216729, 262444238, 262187584
   - MBL: MAEU + 9 digits (no space!) → MAEU263216729, MAEU262444238
   - Container prefixes: MRKU, MAEU, MSCU, MSKU
   - Subject pattern: "MAERSK-- 263216729" → booking_number: 263216729

   HAPAG-LLOYD:
   - Booking: Pure numeric 8 digits → 34577398, 34568890, 34823478
   - MBL: HLCU + region/sequence → HLCUBO12601BGUW1, HLCUDE1251233607
   - Container prefixes: HLBU, HLXU, HAMU
   - Subject pattern: "Hapag-Lloyd // BKG 34577398" → booking_number: 34577398

   CMA CGM:
   - Booking: Prefix + 7 digits → CAD0854982, AMC2494097, EID0927398
   - MBL: CMDU + booking → CMDUEID0927398, CMAUEIC2493881
   - Container prefixes: CMAU, CGMU
   - Subject pattern: "CMA CGM - CAD0854982" → booking_number: CAD0854982

   MSC:
   - Booking: Various formats → MSCUW7831234, MSC1234567
   - MBL: MEDU + digits → MEDU1234567890
   - Container prefixes: MSCU, MEDU

   COSCO:
   - Booking: Numeric or prefixed → 1234567890, COSCO1234567
   - MBL: COSU + digits → COSU6433188

   MBL NUMBER (mbl_number):
   - CARRIER PREFIX + DIGITS: MAEU261683714, HLCUCM2251119160, COSU6433188, MAEU261308924
   - Prefixes: MAEU (Maersk), HLCU/HLCUCM (Hapag), COSU (COSCO), OOLU (OOCL), etc.
   - This is Master Bill of Lading from ocean carrier

   ⚠️ MBL COMMON MISTAKES (DO NOT DO THESE):
   ✗ "MAERSK 263216729" ← WRONG! Don't include carrier NAME with space
   ✗ "263216729" ← WRONG! Pure numeric is booking_number, not MBL
   ✗ "UETU6544615" ← WRONG! This is container number (4 letters + 7 digits)
   ✗ Using booking number in MBL field ← WRONG!

   ✓ "MAEU263216729" ← CORRECT! Carrier PREFIX + digits (no space)
   ✓ If you only see "263216729" in subject → that's booking_number, NOT mbl_number
   ✓ MBL usually appears in BL documents, not booking confirmations

   CARRIER NAME (carrier_name):
   - Extract the OCEAN CARRIER, not the forwarder
   - Subject "MAERSK-- 263216729" → carrier_name: "Maersk" (NOT "Hapag-Lloyd"!)
   - Look for: vessel name (MAERSK DENVER → Maersk), MBL prefix (MAEU → Maersk)
   - NEVER output multiple carriers like "Hapag, Maersk" - pick ONE based on evidence
   - If email discusses quotes from multiple carriers, pick the one being BOOKED

   ┌────────────────────────────────────────────────────────────────────────┐
   │ CARRIER SUBJECT LINE PATTERNS (for identifying carrier + booking)     │
   └────────────────────────────────────────────────────────────────────────┘

   MAERSK:
   - "MAERSK-- 263216729 // KOHL's // INDC 2nd FEB'26"
     → carrier_name: "Maersk", booking_number: 263216729
     → cargo_cutoff: 2026-02-02 (INDC date)
   - "MAERSK BOOKING CONFIRMATION - 262444238"
     → carrier_name: "Maersk", booking_number: 262444238

   HAPAG-LLOYD:
   - "Hapag-Lloyd // BKG 34577398 // ETD 15-JAN-26"
     → carrier_name: "Hapag-Lloyd", booking_number: 34577398
   - "HL Booking Amendment - 34568890"
     → carrier_name: "Hapag-Lloyd", booking_number: 34568890

   CMA CGM:
   - "CMA CGM - CAD0854982 - BOOKING CONFIRMATION"
     → carrier_name: "CMA CGM", booking_number: CAD0854982
   - "CMACGM/EID0927398/SI CUTOFF REMINDER"
     → carrier_name: "CMA CGM", booking_number: EID0927398

   COMMON PATTERNS:
   - Customer name often after "//" → "// KOHL's //" = consignee hint
   - Date after "INDC" or "CUTOFF" → cargo_cutoff, NOT ETD
   - Date after "ETD" or "SAILING" → actual ETD

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
     IMPORTANT: If email contains MULTIPLE booking numbers, put the PRIMARY one in booking_number
     and put ALL OTHERS in reference_numbers array. Example:
     Email mentions bookings 263216729, 263216730, 263216731 →
       booking_number: "263216729", reference_numbers: ["263216730", "263216731"]

3. 4-POINT ROUTING (CRITICAL - Use correct fields):

   POR (Place of Receipt) → POL (Port of Loading) → POD (Port of Discharge) → POFD (Place of Final Delivery)

   ┌────────────────────────────────────────────────────────────────────────┐
   │ POL/POD FORMAT - USE UN/LOCODE (5 LETTERS) ONLY!                       │
   └────────────────────────────────────────────────────────────────────────┘

   For pol_location and pod_location, ALWAYS use 5-letter UN/LOCODE:

   CORRECT FORMAT:
   ✓ pol_location: "INNSA"    (Nhava Sheva, India)
   ✓ pod_location: "USNYC"    (New York, USA)
   ✓ pol_location: "CNSHA"    (Shanghai, China)
   ✓ pod_location: "USLAX"    (Los Angeles, USA)

   WRONG FORMAT (DO NOT OUTPUT):
   ✗ pol_location: "Nhava Sheva"           → use "INNSA"
   ✗ pod_location: "New York"              → use "USNYC"
   ✗ pol_location: "Jawaharlal Nehru, IN"  → use "INNSA"
   ✗ pol_location: ["INNSA", "INMUN"]      → NO ARRAYS! Pick one port
   ✗ pol_location: "<UNKNOWN>"             → use null instead
   ✗ pod_location: "4601"                  → meaningless, use null

   COMMON UN/LOCODES (MEMORIZE THESE):
   ══════════════════════════════════
   INDIA:   INNSA (Nhava Sheva/Mumbai), INMUN (Mundra), INMAA (Chennai)
   USA:     USNYC (New York), USLAX (Los Angeles), USHOU (Houston)
            USSAV (Savannah), USCHI (Chicago), USBAL (Baltimore)
            USSEA (Seattle), USOAK (Oakland), USCHS (Charleston)
   CANADA:  CAVAN (Vancouver), CAMTR (Montreal), CAHAL (Halifax)
   CHINA:   CNSHA (Shanghai), CNSZX (Shenzhen), CNNGB (Ningbo)
   OTHER:   SGSIN (Singapore), AEJEA (Jebel Ali/Dubai), NLRTM (Rotterdam)

   If you don't know the UN/LOCODE for a port, output null (NOT city name!)

   por_location: Shipper's warehouse/factory (inland origin)
   - Examples: "Mumbai Factory", "Patli", "Supplier Warehouse"
   - por_type: warehouse, factory, cfs, icd, address
   - Can use city names since these are inland locations

   pol_location: Port/Airport where cargo LOADS onto vessel/aircraft
   - Ocean: UN/LOCODE ONLY - INNSA, USHOU, CNSHA (5 uppercase letters)
   - Air: Airport codes like BOM, JFK, LAX
   - pol_type: port, airport, rail_terminal

   pod_location: Port/Airport where cargo UNLOADS from vessel/aircraft
   - Ocean: UN/LOCODE ONLY - USNYC, USLAX, DEHAM (5 uppercase letters)
   - Air: Airport codes like JFK, ORD
   - pod_type: port, airport, rail_terminal

   pofd_location: Consignee's warehouse/final destination (inland destination)
   - Examples: "Detroit, MI", "Oak Creek, WI", "Consignee Warehouse"
   - pofd_type: warehouse, factory, cfs, icd, address
   - Can use city names since these are inland locations

   RULES:
   - "Nhava Sheva", "INNSA", "Mundra" = pol_location (port), NOT por
   - "Houston", "USHOU" = pod_location (port) if ocean, OR pofd_location if final destination
   - City addresses like "Detroit, MI" = pofd_location (address), NOT pod
   - For trucking-only (road mode): use por_location and pofd_location only
   - NEVER output arrays for location fields - pick ONE location
   - NEVER output "<UNKNOWN>" - use null instead

4. DOCUMENT TYPE CLUES:
   - "Forwarding Note" / "Forwarding Instructions" = forwarding_note (pre-departure origin document)
   - "Booking Confirmation" from carrier = booking_confirmation
   - "Shipping Instructions" / "SI" = shipping_instructions
   - "Checklist" / "Document Checklist" = checklist
   - "Shipping Bill" / "LEO" / "Let Export Order" = shipping_bill or leo_copy
   - "Form 13" / "FORM-13" / "Form13" = form_13 (Indian customs export declaration)
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

   ╔══════════════════════════════════════════════════════════════════════════╗
   ║  DATE EXTRACTION RULES (ANTI-HALLUCINATION - READ CAREFULLY!)            ║
   ╚══════════════════════════════════════════════════════════════════════════╝

   ANCHOR DATES (Use these to determine correct year):
   - TODAY'S DATE will be provided in the prompt header
   - EMAIL DATE will be provided in the prompt header
   - Use these to infer missing years in dates

   DATE FORMAT (ISO 8601 - MANDATORY):
   - ALL dates MUST be YYYY-MM-DD format with FULL 4-DIGIT YEAR
   - If document says "2nd Dec" without year → use EMAIL DATE's year
   - If date is "31st Dec" and email is from January → use PREVIOUS year
   - If date is "5th Jan" and email is from December → use NEXT year
   - NEVER output years 2023 or 2024 for recent shipping documents
   - For "tomorrow", "today", "within 48 hours" → calculate from EMAIL DATE

   ┌────────────────────────────────────────────────────────────────────────┐
   │ CRITICAL: "Xth MMM'YY" DATE FORMAT - DO NOT SWAP DAY AND MONTH!       │
   └────────────────────────────────────────────────────────────────────────┘

   The format "Xth MMM'YY" means: DAY-MONTH-YEAR (NOT month-day-year!)

   STEP-BY-STEP PARSING (FOLLOW EXACTLY):
   ═══════════════════════════════════════
   Input: "2nd FEB'26"
   Step 1: "2nd" → Extract number → DAY = 2
   Step 2: "FEB" → Look up month → MONTH = February = 02
   Step 3: "'26" → Add 2000 → YEAR = 2026
   Step 4: Combine as YYYY-MM-DD → 2026-02-02

   Output: 2026-02-02 (February 2nd, 2026)

   MORE EXAMPLES:
   ═══════════════
   "15th JAN'26" → DAY=15, MONTH=01, YEAR=2026 → 2026-01-15
   "28th MAR'26" → DAY=28, MONTH=03, YEAR=2026 → 2026-03-28
   "3rd DEC'25"  → DAY=03, MONTH=12, YEAR=2025 → 2025-12-03
   "10th SEP'26" → DAY=10, MONTH=09, YEAR=2026 → 2026-09-10

   COMMON MISTAKE (DO NOT DO THIS):
   ════════════════════════════════
   ✗ "2nd FEB'26" → 2026-01-02 (WRONG!)
     You put DAY (2) as MONTH (01) and MONTH (FEB=02) as DAY (02)
     This is BACKWARDS!

   ✓ "2nd FEB'26" → 2026-02-02 (CORRECT!)
     DAY=2 goes in DAY position (last), MONTH=FEB=02 goes in MONTH position (middle)

   MEMORY AID:
   ═══════════
   "2nd FEB" = "February 2nd" = 02-02 (month-day in result)
   The NUMBER (2nd) is the DAY → goes LAST in YYYY-MM-DD
   The WORD (FEB) is the MONTH → goes MIDDLE in YYYY-MM-DD

   ┌────────────────────────────────────────────────────────────────────────┐
   │ SUBJECT LINE DATES - WARNING! (Most common extraction error!)         │
   └────────────────────────────────────────────────────────────────────────┘

   Dates in email SUBJECT are usually CARGO CUTOFF dates, NOT ETD/ETA!

   SUBJECT PATTERN: "MAERSK-- 262444238 // KOHL's // INDC 2nd FEB'26"
   - "INDC 2nd FEB'26" = Inland Container Depot Cutoff = cargo_cutoff
   - This is NOT the ETD (sailing date)!
   - This is NOT the ETA (arrival date)!

   DOMAIN TERMS (know what these mean!):
   - INDC = Inland Container Depot Cutoff (cargo_cutoff)
   - ICD = Inland Container Depot (a location, not a date)
   - C/O or CUTOFF = cutoff date (si_cutoff, vgm_cutoff, cargo_cutoff)
   - SAILING = ETD (departure from port)
   - ETA/ARRIVAL = eta (arrival at destination)

   RULE: Do NOT extract subject line dates as ETD or ETA unless:
   - Subject explicitly says "ETD", "SAILING DATE", or "DEPARTURE"
   - Subject explicitly says "ETA", "ARRIVAL", or "POD ETA"

   For ETD/ETA, look INSIDE the email body or attachments, not subject!

   ┌────────────────────────────────────────────────────────────────────────┐
   │ DATE SOURCE HIERARCHY (Extract dates based on document type!)         │
   └────────────────────────────────────────────────────────────────────────┘

   ╔═══════════════════════════════════════════════════════════════════════╗
   ║ DOCUMENT TYPE → MANDATORY DATE EXTRACTION                             ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║ booking_confirmation:                                                 ║
   ║   MUST extract: etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff        ║
   ║   These are ALWAYS in booking confirmations - LOOK CAREFULLY!         ║
   ║   Common labels: "CUT OFF", "SI CUT OFF", "VGM CUT OFF", "GATE IN"   ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║ arrival_notice:                                                       ║
   ║   MUST extract: eta, last_free_day                                   ║
   ║   Common labels: "ETA", "ARRIVAL DATE", "LFD", "LAST FREE DAY",      ║
   ║   "FREE TIME EXPIRES", "DEMURRAGE STARTS", "AVAILABLE DATE"          ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║ delivery_order / container_release:                                   ║
   ║   MUST extract: last_free_day, empty_return_date                     ║
   ║   Common labels: "LFD", "RETURN BY", "EMPTY RETURN", "PER DIEM"      ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║ schedule_update:                                                      ║
   ║   MUST extract: etd, eta (new values after change)                   ║
   ╚═══════════════════════════════════════════════════════════════════════╝

   LAST_FREE_DAY (LFD) - Demurrage/detention deadline:
     ✓ ONLY extract from: arrival_notice, delivery_order, container_release,
                          customs_entry, work_order (destination)
     ✗ NEVER extract from: booking_confirmation, booking_amendment, sea_waybill,
                           draft_bl, invoice, shipping_instructions
     WHY: LFD is assigned AFTER vessel arrives. Pre-departure docs don't have it.

   CUTOFF DATES (si_cutoff, vgm_cutoff, cargo_cutoff, doc_cutoff):
     ✓ Extract from: booking_confirmation, booking_amendment, schedule_update
     Look for: "CUT OFF", "CUTOFF", "SI C/O", "VGM C/O", "GATE IN BY"
     These are ALWAYS before ETD (you submit documents BEFORE departure)

   ETD (Estimated Time of Departure) - FROM POL ONLY:
     ✓ Extract from: booking_confirmation, schedule_update, draft_bl
     ✓ This is departure from PORT OF LOADING (POL) - the ORIGIN port
     ✗ IGNORE: Transshipment ETDs, feeder vessel ETDs, pre-carrier ETDs
     Look for: "ETD", "POL ETD", "DEPARTURE", "SAILING DATE", "VESSEL ETD"

   ETA (Estimated Time of Arrival) - TO POD/POFD ONLY:
     ✓ Extract from: arrival_notice (BEST), booking_confirmation, schedule_update
     ✓ This is arrival at PORT OF DISCHARGE (POD) or PLACE OF FINAL DELIVERY (POFD)
     ✗ IGNORE: Transshipment ETAs, intermediate port ETAs, T/S dates
     Look for: "ETA", "POD ETA", "DELIVERY ETA", "FINAL ETA", "DEST ETA"

   ┌────────────────────────────────────────────────────────────────────────┐
   │ MULTI-LEG VOYAGE: Only capture ORIGIN and FINAL DESTINATION dates!    │
   └────────────────────────────────────────────────────────────────────────┘

   CORRECT (capture these):
     POL ETD: 2026-01-15 (Nhava Sheva)     ← EXTRACT THIS as etd
     POD ETA: 2026-02-20 (New York)        ← EXTRACT THIS as eta

   WRONG (ignore these - transshipment dates):
     T/S Colombo ETA: 2026-01-20           ← IGNORE
     T/S Colombo ETD: 2026-01-22           ← IGNORE
     T/S Singapore ETA: 2026-01-28         ← IGNORE

   ┌────────────────────────────────────────────────────────────────────────┐
   │ CONTEXTUAL VALIDATION (Shipping Date Logic - MUST BE TRUE!)           │
   └────────────────────────────────────────────────────────────────────────┘

   These relationships MUST hold true. If your dates violate these, RE-CHECK:

   1. Cutoffs < ETD     (submit documents BEFORE vessel departs)
   2. ETD < ETA         (depart BEFORE arrive)
   3. ETA < LFD         (arrive first, THEN free time period starts)

   ┌────────────────────────────────────────────────────────────────────────┐
   │ MINIMUM TRANSIT TIMES (Ocean freight is SLOW - not 1 day!)            │
   └────────────────────────────────────────────────────────────────────────┘

   Ocean freight takes WEEKS, not days. Transit times from production data:

   ╔════════════════════════════════════════════════════════════════════════╗
   ║  VERIFIED TRANSIT TIMES (from actual shipment data)                    ║
   ╠════════════════════════════════════════════════════════════════════════╣
   ║  India → US East Coast:  28-42 days (typical: 32 days)                 ║
   ║  India → US West Coast:  25-35 days (typical: 28 days)                 ║
   ║  India → Canada:         27-46 days (typical: 35 days)                 ║
   ║  India → Europe:         18-28 days (typical: 21 days)                 ║
   ║  China → US West Coast:  14-21 days (typical: 16 days)                 ║
   ║  China → US East Coast:  28-35 days (typical: 30 days)                 ║
   ║  Intra-Asia:             3-10 days  (typical: 7 days)                  ║
   ╠════════════════════════════════════════════════════════════════════════╣
   ║  ABSOLUTE MINIMUM for international ocean: 7 days                      ║
   ║  Any transit < 7 days = EXTRACTION ERROR (not possible for ocean)      ║
   ╚════════════════════════════════════════════════════════════════════════╝

   IF YOUR ETD AND ETA ARE LESS THAN 7 DAYS APART:
   → You extracted the WRONG DATE
   → One of them is probably a transshipment date or cutoff date
   → Re-check and find the CORRECT eta from body/attachment

   EXAMPLE OF WRONG EXTRACTION:
   ✗ ETD: 2026-02-02, ETA: 2026-02-03 (1 day = IMPOSSIBLE for ocean)
     This means you extracted cargo cutoff or INDC date as ETD
     The REAL ETA should be ~March 2026 (30+ days later)

   COMMON MISTAKE:
   ✗ Subject says "INDC 2nd FEB'26" → AI puts 2026-02-02 as ETD
     WRONG! INDC is cargo cutoff date, NOT sailing date!
     Look in email body for actual ETD/sailing date

   INVALID EXAMPLES (AI should NOT output these):
   ✗ ETD: 2026-02-21, LFD: 2025-01-15 (LFD before departure = IMPOSSIBLE)
   ✗ ETD: 2026-01-15, ETA: 2026-01-10 (arrival before departure = IMPOSSIBLE)
   ✗ ETD: 2026-02-02, ETA: 2026-02-03 (1 day transit = IMPOSSIBLE for ocean)
   ✗ SI Cutoff: 2026-01-20, ETD: 2026-01-15 (cutoff after departure = IMPOSSIBLE)

   If document shows impossible dates, likely:
   - You misread the year (2025 vs 2026)
   - You extracted from wrong field
   - The source document has an error (set to null)

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
   - approval = Something was APPROVED or acknowledged → has_action: FALSE

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
          // Documentation stage - SI, VGM, Forwarding Note
          'shipping_instructions', 'si_confirmation', 'forwarding_note', 'checklist',
          'shipping_bill', 'leo_copy', 'form_13', 'vgm_confirmation',
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
          'approval',              // "OK", "Approved", "Confirmed", "Proceed", "Noted", "Thanks"
          'request',               // "Please send", "Kindly share", "Need"
          'escalation',            // "Urgent", "ASAP", "Escalate"
          'notification',          // "FYI", "Please note", "For your info"
          'internal_notification', // Intoglo internal + ODeX/carrier system auto-emails
          'general_correspondence', 'unknown',
        ],
      },

      // Party
      from_party: {
        type: 'string',
        enum: ['ocean_carrier', 'airline', 'carrier', 'nvocc', 'trucker', 'warehouse', 'terminal',
               'customs_broker', 'freight_broker', 'shipper', 'consignee', 'customer', 'notify_party', 'intoglo', 'system', 'unknown'],
      },

      // 4-Point Routing Locations
      por_location: { type: 'string', nullable: true, description: 'Place of Receipt - shipper warehouse/factory' },
      por_type: { type: 'string', enum: ['warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown'], nullable: true },
      pol_location: { type: 'string', nullable: true, description: 'Port of Loading - UN/LOCODE (INNSA) or airport code' },
      pol_type: { type: 'string', enum: ['port', 'airport', 'rail_terminal', 'address', 'unknown'], nullable: true },
      pod_location: { type: 'string', nullable: true, description: 'Port of Discharge (FINAL DESTINATION) - UN/LOCODE or airport code. NOT transshipment ports! Look for "Port of Discharging" or "Port of Discharge".' },
      pod_type: { type: 'string', enum: ['port', 'airport', 'rail_terminal', 'address', 'unknown'], nullable: true },
      pofd_location: { type: 'string', nullable: true, description: 'Place of Final Delivery - consignee warehouse/address' },
      pofd_type: { type: 'string', enum: ['warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown'], nullable: true },

      // Vessel/Carrier
      vessel_name: { type: 'string', nullable: true },
      voyage_number: { type: 'string', nullable: true },
      flight_number: { type: 'string', nullable: true },
      carrier_name: { type: 'string', nullable: true },

      // Dates - Estimated vs Actual
      etd: { type: 'string', nullable: true, description: 'Estimated Time of Departure YYYY-MM-DD. MANDATORY for booking_confirmation! Look for: ETD, DEPARTURE, SAILING DATE' },
      atd: { type: 'string', nullable: true, description: 'Actual Time of Departure YYYY-MM-DD' },
      eta: { type: 'string', nullable: true, description: 'Estimated Time of Arrival at FINAL DESTINATION YYYY-MM-DD. MANDATORY for arrival_notice! Look for: ETA, ARRIVAL, POD ETA. IGNORE transshipment dates!' },
      ata: { type: 'string', nullable: true, description: 'Actual Time of Arrival YYYY-MM-DD' },
      pickup_date: { type: 'string', nullable: true, description: 'Trucking pickup date' },
      delivery_date: { type: 'string', nullable: true, description: 'Trucking delivery date' },

      // Cutoffs - MANDATORY for booking_confirmation!
      si_cutoff: { type: 'string', nullable: true, description: 'SI cutoff YYYY-MM-DD. MANDATORY for booking_confirmation! Look for: SI CUT OFF, SI C/O, DOC CUTOFF' },
      vgm_cutoff: { type: 'string', nullable: true, description: 'VGM cutoff YYYY-MM-DD. MANDATORY for booking_confirmation! Look for: VGM CUT OFF, VGM C/O' },
      cargo_cutoff: { type: 'string', nullable: true, description: 'Cargo gate-in cutoff YYYY-MM-DD. MANDATORY for booking_confirmation! Look for: GATE IN, CARGO CUTOFF, CY CUTOFF' },
      doc_cutoff: { type: 'string', nullable: true, description: 'Documentation cutoff YYYY-MM-DD' },

      // Demurrage/Detention - MANDATORY for arrival_notice!
      last_free_day: { type: 'string', nullable: true, description: 'Last Free Day YYYY-MM-DD. MANDATORY for arrival_notice/delivery_order! Look for: LFD, LAST FREE DAY, FREE TIME EXPIRES, DEMURRAGE STARTS' },
      empty_return_date: { type: 'string', nullable: true, description: 'Empty container return deadline YYYY-MM-DD. Look for: RETURN BY, EMPTY RETURN, PER DIEM STARTS' },

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
        enum: ['confirmation', 'approval', 'request', 'update', 'action_required', 'issue_reported',
               'escalation', 'acknowledgement', 'query', 'instruction', 'notification', 'general', 'general_correspondence', 'unknown'],
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
 * Build flow context section for the prompt
 * Provides AI with shipment stage awareness for flow-based classification
 */
function buildFlowContextSection(flowContext: FlowContext): string {
  let section = `\n=== SHIPMENT CONTEXT (Use to validate your classification) ===\n`;
  section += `Current Stage: ${flowContext.shipmentStage}\n`;

  if (flowContext.expectedDocuments.length > 0) {
    section += `Expected documents: ${flowContext.expectedDocuments.join(', ')}\n`;
  }

  if (flowContext.unexpectedDocuments.length > 0) {
    section += `Unusual at this stage: ${flowContext.unexpectedDocuments.join(', ')} (would be early or late)\n`;
  }

  if (flowContext.impossibleDocuments.length > 0) {
    section += `Impossible at this stage: ${flowContext.impossibleDocuments.join(', ')}\n`;
  }

  if (flowContext.pendingActions.length > 0) {
    section += `Pending actions: ${flowContext.pendingActions.slice(0, 3).join('; ')}\n`;
  }

  if (flowContext.lastDocumentType) {
    section += `Last document received: ${flowContext.lastDocumentType}`;
    if (flowContext.daysSinceLastDocument !== undefined) {
      section += ` (${flowContext.daysSinceLastDocument} days ago)`;
    }
    section += '\n';
  }

  section += `\nIMPORTANT: If your classification would be "impossible" at this stage, reconsider - likely misclassification.\n`;
  section += `Expected documents are more likely. Unusual documents need clear evidence.\n`;

  return section;
}

/**
 * Build deep thread warning section for position 10+ emails
 * The subject line is very stale and misleading at this point
 */
function buildDeepThreadWarning(subject: string, threadPosition: number): string {
  return `
=== DEEP THREAD WARNING ===
This email is message #${threadPosition} in a long thread.
The subject line "${subject}" is INHERITED from the original email and is MISLEADING.
DO NOT use the subject for classification.
Classify based ONLY on:
1. Email body content
2. Attachment names and content
3. Sender role

The subject was relevant ${threadPosition - 1} emails ago but NOT for this email.
`;
}

/**
 * Build the full prompt for AI analysis
 * @param emailDate - The date the email was received (for date context)
 * @param threadContext - Optional context from previous emails in thread
 * @param includeSubject - Whether to include subject in analysis (false for position 2+ emails)
 * @param flowContext - Optional shipment stage context for flow-based classification
 * @param threadPosition - Position in thread (1 = first email, 10+ = deep thread)
 */
export function buildAnalysisPrompt(
  subject: string,
  bodyPreview: string,
  attachmentText: string,
  emailDate?: Date | string,
  threadContext?: ThreadContext,
  includeSubject: boolean = true,
  flowContext?: FlowContext,
  threadPosition: number = 1
): string {
  // Format anchor dates for context (TODAY + EMAIL DATE)
  const todayStr = new Date().toISOString().split('T')[0];
  const emailDateStr = emailDate
    ? new Date(emailDate).toISOString().split('T')[0]
    : todayStr;

  const dateContext = `
╔══════════════════════════════════════════════════════════════════════════╗
║  ANCHOR DATES (Use these to determine correct year for dates!)           ║
╠══════════════════════════════════════════════════════════════════════════╣
║  TODAY'S DATE: ${todayStr}                                              ║
║  EMAIL DATE:   ${emailDateStr}                                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║  RULES:                                                                  ║
║  • If date has no year → use EMAIL DATE's year                          ║
║  • If "Dec" date in Jan email → use PREVIOUS year (${parseInt(emailDateStr.slice(0,4)) - 1})                   ║
║  • If "Jan" date in Dec email → use NEXT year (${parseInt(emailDateStr.slice(0,4)) + 1})                       ║
║  • NEVER output year 2023 or 2024 for shipping documents                ║
╚══════════════════════════════════════════════════════════════════════════╝
`;

  // Build thread context section if available
  const threadSection = threadContext ? buildThreadContextSection(threadContext) : '';

  // Build flow context section if available (provides shipment stage awareness)
  const flowSection = flowContext ? buildFlowContextSection(flowContext) : '';

  // Build deep thread warning for position 10+ (subject is very stale)
  const deepThreadSection = threadPosition >= 10 ? buildDeepThreadWarning(subject, threadPosition) : '';

  // Subject section handling based on thread position
  let subjectSection: string;
  if (threadPosition >= 10) {
    // Deep thread - subject is completely unreliable
    subjectSection = `=== SUBJECT LINE ===
"${subject}"
⚠️ COMPLETELY IGNORE - This is message #${threadPosition}, subject is from original email.

`;
  } else if (!includeSubject) {
    // Position 2-9 - subject is stale but still visible
    subjectSection = `=== SUBJECT LINE ===
(IGNORED - This is a reply/forward, subject is stale. Classify based on body and attachments only.)

`;
  } else {
    // Position 1 - subject is fresh and reliable
    subjectSection = `=== SUBJECT LINE ===
${subject}

`;
  }

  // When body is empty/minimal but attachments have data, signal the AI to focus on attachments
  // This is common for booking confirmations where carriers send empty body + PDF
  const bodyLength = bodyPreview?.trim().length || 0;
  const attachmentLength = attachmentText?.trim().length || 0;
  const pdfPrimarySection = (bodyLength < 100 && attachmentLength > 200)
    ? `
⚠️ IMPORTANT: Email body is empty/minimal (${bodyLength} chars). ALL shipping data is in the PDF attachment (${attachmentLength} chars).
Extract ALL fields (booking_number, vessel, ETD, ETA, POL, POD, carrier, containers, cutoffs, parties) from the ATTACHMENT text below.
Do NOT return empty fields just because the body is empty.

`
    : '';

  return `${FREIGHT_FORWARDER_PROMPT}
${dateContext}${threadSection}${flowSection}${deepThreadSection}
=== CURRENT EMAIL (analyze this one) ===
${pdfPrimarySection}
${subjectSection}=== EMAIL BODY ===
${bodyPreview}

=== ATTACHMENTS ===
${attachmentText || '(No attachments)'}`;
}

/**
 * Document types that should NEVER have last_free_day extracted
 * LFD is only assigned after arrival - pre-departure docs don't have it
 */
const LFD_INVALID_DOC_TYPES = new Set([
  'booking_confirmation',
  'booking_amendment',
  'booking_request',
  'sea_waybill',
  'draft_bl',
  'final_bl',
  'house_bl',
  'shipping_instructions',
  'si_confirmation',
  'vgm_confirmation',
  'invoice',
  'quotation',
  'rate_request',
  'schedule_update',
  'notification',
  'general_correspondence',
]);

/**
 * Validate extracted dates for logical consistency
 * Returns corrected dates or null for invalid ones
 *
 * Implements 3-layer defense:
 * 1. Year range validation (2024-2028)
 * 2. Field-specific rules (LFD only from arrival docs)
 * 3. Contextual validation (ETD < ETA < LFD)
 */
export function validateExtractedDates(extracted: {
  etd?: string | null;
  eta?: string | null;
  si_cutoff?: string | null;
  vgm_cutoff?: string | null;
  cargo_cutoff?: string | null;
  doc_cutoff?: string | null;
  last_free_day?: string | null;
  action_deadline?: string | null;
}, emailDate?: Date | string, documentType?: string): typeof extracted {
  const result = { ...extracted };
  const today = new Date();

  // ========================================================================
  // LAYER 1: Year Range Validation
  // ========================================================================
  const isReasonableDate = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return true;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const year = date.getFullYear();
    // Valid range: 2024-2028 (current operations window)
    return year >= 2024 && year <= 2028;
  };

  // Nullify dates outside valid range
  if (!isReasonableDate(result.etd)) result.etd = null;
  if (!isReasonableDate(result.eta)) result.eta = null;
  if (!isReasonableDate(result.si_cutoff)) result.si_cutoff = null;
  if (!isReasonableDate(result.vgm_cutoff)) result.vgm_cutoff = null;
  if (!isReasonableDate(result.cargo_cutoff)) result.cargo_cutoff = null;
  if (!isReasonableDate(result.doc_cutoff)) result.doc_cutoff = null;
  if (!isReasonableDate(result.last_free_day)) result.last_free_day = null;
  if (!isReasonableDate(result.action_deadline)) result.action_deadline = null;

  // ========================================================================
  // LAYER 2: Field-Specific Rules (LFD only from arrival docs)
  // ========================================================================
  if (documentType && LFD_INVALID_DOC_TYPES.has(documentType)) {
    // LFD should NOT be extracted from pre-departure documents
    if (result.last_free_day) {
      console.warn(
        `[DateValidation] Removing last_free_day from ${documentType} - LFD not valid for this doc type`
      );
      result.last_free_day = null;
    }
  }

  // ========================================================================
  // LAYER 3: Contextual Validation (Business Logic)
  // ========================================================================

  // 3a. Cutoffs must be BEFORE ETD (can't submit after departure)
  if (result.etd) {
    const etdDate = new Date(result.etd);
    if (result.si_cutoff && new Date(result.si_cutoff) > etdDate) {
      console.warn(`[DateValidation] SI cutoff ${result.si_cutoff} after ETD ${result.etd} - nullifying`);
      result.si_cutoff = null;
    }
    if (result.vgm_cutoff && new Date(result.vgm_cutoff) > etdDate) {
      console.warn(`[DateValidation] VGM cutoff ${result.vgm_cutoff} after ETD ${result.etd} - nullifying`);
      result.vgm_cutoff = null;
    }
    if (result.cargo_cutoff && new Date(result.cargo_cutoff) > etdDate) {
      console.warn(`[DateValidation] Cargo cutoff ${result.cargo_cutoff} after ETD ${result.etd} - nullifying`);
      result.cargo_cutoff = null;
    }
    if (result.doc_cutoff && new Date(result.doc_cutoff) > etdDate) {
      console.warn(`[DateValidation] Doc cutoff ${result.doc_cutoff} after ETD ${result.etd} - nullifying`);
      result.doc_cutoff = null;
    }
  }

  // 3b. ETA must be AFTER ETD (arrival after departure)
  if (result.etd && result.eta) {
    const etdDate = new Date(result.etd);
    const etaDate = new Date(result.eta);
    if (etaDate < etdDate) {
      console.warn(`[DateValidation] ETA ${result.eta} before ETD ${result.etd} - nullifying ETA`);
      result.eta = null;
    }
  }

  // 3b2. MINIMUM TRANSIT TIME - Ocean freight takes weeks, not days!
  // If ETD and ETA are less than 7 days apart, the ETA is wrong
  // (likely extracted cargo cutoff or transshipment date as ETA)
  const MINIMUM_OCEAN_TRANSIT_DAYS = 7;
  if (result.etd && result.eta) {
    const etdDate = new Date(result.etd);
    const etaDate = new Date(result.eta);
    const transitDays = Math.round((etaDate.getTime() - etdDate.getTime()) / (1000 * 60 * 60 * 24));
    if (transitDays < MINIMUM_OCEAN_TRANSIT_DAYS) {
      console.warn(
        `[DateValidation] Impossible transit: ${transitDays} days (ETD: ${result.etd}, ETA: ${result.eta}). ` +
        `Ocean freight minimum is ${MINIMUM_OCEAN_TRANSIT_DAYS} days. Nullifying ETA.`
      );
      result.eta = null;
    }
  }

  // 3c. LFD must be AFTER ETA (free time starts after arrival)
  if (result.eta && result.last_free_day) {
    const etaDate = new Date(result.eta);
    const lfdDate = new Date(result.last_free_day);
    if (lfdDate < etaDate) {
      console.warn(`[DateValidation] LFD ${result.last_free_day} before ETA ${result.eta} - nullifying LFD`);
      result.last_free_day = null;
    }
  }

  // 3d. LFD must be AFTER ETD (can't have free time before departure)
  if (result.etd && result.last_free_day) {
    const etdDate = new Date(result.etd);
    const lfdDate = new Date(result.last_free_day);
    if (lfdDate < etdDate) {
      console.warn(`[DateValidation] LFD ${result.last_free_day} before ETD ${result.etd} - nullifying LFD`);
      result.last_free_day = null;
    }
  }

  return result;
}

/**
 * Expected dates by document type - for monitoring extraction quality
 */
const EXPECTED_DATES_BY_DOC_TYPE: Record<string, string[]> = {
  booking_confirmation: ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff'],
  booking_amendment: ['etd', 'eta'],
  arrival_notice: ['eta', 'last_free_day'],
  delivery_order: ['last_free_day'],
  container_release: ['last_free_day'],
  schedule_update: ['etd', 'eta'],
};

/**
 * Check if expected dates were extracted for a document type
 * Returns list of missing expected dates for monitoring
 */
export function checkExpectedDates(
  documentType: string,
  extracted: {
    etd?: string | null;
    eta?: string | null;
    si_cutoff?: string | null;
    vgm_cutoff?: string | null;
    cargo_cutoff?: string | null;
    last_free_day?: string | null;
  }
): { missing: string[]; coverage: number } {
  const expected = EXPECTED_DATES_BY_DOC_TYPE[documentType];
  if (!expected || expected.length === 0) {
    return { missing: [], coverage: 100 };
  }

  const missing: string[] = [];
  let found = 0;

  for (const field of expected) {
    const value = extracted[field as keyof typeof extracted];
    if (value) {
      found++;
    } else {
      missing.push(field);
    }
  }

  const coverage = Math.round((found / expected.length) * 100);

  // Log warning if critical dates missing
  if (missing.length > 0) {
    console.warn(
      `[DateExtraction] ${documentType} missing expected dates: ${missing.join(', ')} (${coverage}% coverage)`
    );
  }

  return { missing, coverage };
}
