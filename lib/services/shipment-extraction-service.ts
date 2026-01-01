/**
 * Shipment Extraction Service
 *
 * Comprehensive "ShipmentMaker" service that extracts ALL shipment data points
 * from emails and attachments with 100% field coverage.
 *
 * Principles:
 * - Deep Module: Simple extractFromEmail() interface, complex implementation
 * - Interface-Based Design: Carrier-specific extractors implement common interface
 * - Single Responsibility: Only shipment data extraction
 * - Configuration Over Code: Carrier patterns in database
 * - Fail Fast: Validates extracted data before returning
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { parseEntityDate, parseEntityDateTime } from '../utils/date-parser';

// ============================================================================
// Types
// ============================================================================

export interface ShipmentData {
  // Primary Identifiers
  booking_number: string | null;
  bl_number: string | null;
  container_numbers: string[];

  // Carrier & Voyage
  carrier_name: string | null;
  carrier_code: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  service_name: string | null;

  // Routing (includes inland ports)
  port_of_loading: string | null;
  port_of_loading_code: string | null;
  port_of_discharge: string | null;
  port_of_discharge_code: string | null;
  place_of_receipt: string | null;        // Inland origin (ICD, warehouse, factory)
  place_of_receipt_code: string | null;
  place_of_delivery: string | null;       // Inland destination (ICD, warehouse, consignee)
  place_of_delivery_code: string | null;
  transhipment_ports: string[];
  final_destination: string | null;       // Ultimate destination if different

  // Dates
  etd: string | null;
  eta: string | null;
  actual_departure: string | null;
  actual_arrival: string | null;

  // Cutoffs - ALL TYPES (CRITICAL - extract from any section)
  si_cutoff: string | null;               // Shipping Instruction / Documentation
  vgm_cutoff: string | null;              // VGM submission deadline
  cargo_cutoff: string | null;            // Cargo/CY/FCL delivery
  gate_cutoff: string | null;             // Terminal gate closing
  doc_cutoff: string | null;              // Document submission
  port_cutoff: string | null;             // Port/Terminal cutoff
  customs_cutoff: string | null;          // Customs clearance deadline
  hazmat_cutoff: string | null;           // Hazardous cargo deadline
  reefer_cutoff: string | null;           // Refrigerated cargo deadline
  early_return_date: string | null;       // ERD - earliest container return
  terminal_receiving_date: string | null; // TRD - terminal starts receiving
  late_gate: string | null;               // Late gate deadline (if extended)

  // Parties
  shipper_name: string | null;
  shipper_address: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  notify_party: string | null;
  notify_party_address: string | null;
  freight_forwarder: string | null;

  // Cargo Details
  commodity_description: string | null;
  container_type: string | null;
  weight_kg: number | null;
  volume_cbm: number | null;
  package_count: number | null;
  package_type: string | null;
  seal_numbers: string[];                 // Container seal numbers

  // HS Codes & Customs (from Arrival Notice / Duty Entry)
  hs_codes: string[];                     // Array of HS tariff codes
  an_number: string | null;               // Arrival Notice reference
  it_number: string | null;               // IT Number (Immediate Transportation) - starts with "IT"
  entry_number: string | null;            // Customs Entry Number
  bond_number: string | null;             // Customs Bond Number
  isf_number: string | null;              // Importer Security Filing
  ior_number: string | null;              // Importer of Record

  // Financial / Value Table (from commercial docs)
  cargo_value: number | null;             // Declared cargo value
  cargo_value_currency: string | null;    // Currency (USD, EUR, INR)
  duty_amount: number | null;             // Customs duty amount
  tax_amount: number | null;              // Tax amount
  freight_amount: number | null;          // Freight charges
  insurance_amount: number | null;        // Insurance value

  // Commercial Terms
  incoterms: string | null;
  freight_terms: string | null;

  // References (ALL document numbers)
  customer_reference: string | null;
  forwarder_reference: string | null;
  mbl_number: string | null;              // Master BL (if HBL exists)
  hbl_number: string | null;              // House BL
  po_numbers: string[];                   // Purchase Order numbers
  invoice_numbers: string[];              // Commercial invoice numbers

  // Metadata
  extraction_confidence: number;
  extraction_source: 'email_body' | 'pdf_attachment' | 'combined';
  fields_extracted: string[];
  raw_content_length: number;
}

export interface ExtractionResult {
  success: boolean;
  data: ShipmentData | null;
  error?: string;
  processingTime: number;
}

export interface CarrierConfig {
  id: string;
  carrier_name: string;
  carrier_code: string;
  email_patterns: string[];
  extraction_hints: Record<string, string>;
}

// ============================================================================
// Carrier Detection
// ============================================================================

type CarrierId = 'hapag-lloyd' | 'maersk' | 'cma-cgm' | 'msc' | 'cosco' | 'one' | 'evergreen' | 'yang-ming' | 'unknown';

const CARRIER_PATTERNS: Record<CarrierId, RegExp[]> = {
  'hapag-lloyd': [/hapag/i, /hlag/i, /hlcu/i, /hlxu/i],
  'maersk': [/maersk/i, /maeu/i, /msku/i, /sealand/i],
  'cma-cgm': [/cma[-\s]?cgm/i, /cmau/i, /anl/i, /apl/i],
  'msc': [/\bmsc\b/i, /mscu/i, /medu/i],
  'cosco': [/cosco/i, /cosu/i, /oocl/i],
  'one': [/\bone\b/i, /ocean\s*network/i, /oney/i],
  'evergreen': [/evergreen/i, /eglv/i, /eghu/i],
  'yang-ming': [/yang[-\s]?ming/i, /ymlu/i],
  'unknown': []
};

// ============================================================================
// AI Extraction Prompts
// ============================================================================

const COMPREHENSIVE_EXTRACTION_PROMPT = `You are a shipping document data extraction expert. Extract ALL shipping-related information from the provided content with maximum accuracy. Look in ALL sections including tables, headers, footers, and fine print.

EXTRACT THESE FIELDS (use null for missing values):

PRIMARY IDENTIFIERS:
- booking_number: Carrier booking reference (e.g., HLCU1234567, 262789456, COSU1234567890)
- bl_number: Bill of Lading number (MBL or HBL)
- mbl_number: Master Bill of Lading (if HBL exists separately)
- hbl_number: House Bill of Lading
- container_numbers: Array of ALL container numbers (e.g., ["HLXU1234567", "TCLU9876543"])

CARRIER & VOYAGE:
- carrier_name: Full name (Hapag-Lloyd, Maersk, CMA CGM, MSC, COSCO, ONE, Evergreen)
- carrier_code: SCAC code (HLCU, MAEU, CMDU, MSCU, COSU, ONEY)
- vessel_name: Ship name (without M/V, MV prefix)
- voyage_number: Voyage reference
- service_name: Service loop name if mentioned

ROUTING (BOTH SEA PORTS AND INLAND LOCATIONS):
- port_of_loading: Sea port name (e.g., Nhava Sheva, Shanghai, Rotterdam)
- port_of_loading_code: UN/LOCODE (5 chars, e.g., INNSA, CNSHA, NLRTM)
- port_of_discharge: Sea port name
- port_of_discharge_code: UN/LOCODE
- place_of_receipt: INLAND origin (ICD, warehouse, factory, rail yard)
- place_of_receipt_code: Location code if available
- place_of_delivery: INLAND destination (ICD, warehouse, consignee address)
- place_of_delivery_code: Location code if available
- final_destination: Ultimate destination city/location
- transhipment_ports: Array of intermediate ports

DATES (convert ALL to YYYY-MM-DD format):
- etd: Estimated Time of Departure
- eta: Estimated Time of Arrival
- actual_departure: Actual departure date (ATD)
- actual_arrival: Actual arrival date (ATA)

CUTOFFS - EXTRACT ALL (look in deadlines, cutoff sections, important dates):
- si_cutoff: Shipping Instruction / SI closing / Documentation deadline
- vgm_cutoff: VGM (Verified Gross Mass) submission deadline
- cargo_cutoff: Cargo/CY/FCL delivery / Container receiving deadline
- gate_cutoff: Terminal gate closing / Gate-in cutoff
- doc_cutoff: Document submission deadline
- port_cutoff: Port cutoff / Terminal cutoff (if different from cargo)
- customs_cutoff: Customs clearance deadline
- hazmat_cutoff: Hazardous/DG cargo deadline (often earlier)
- reefer_cutoff: Refrigerated cargo deadline (often earlier)
- early_return_date: ERD - Earliest Return Date for empty pickup
- terminal_receiving_date: TRD - When terminal starts receiving
- late_gate: Extended gate / Late gate deadline if offered

PARTIES:
- shipper_name: Exporter/Shipper company name
- shipper_address: Full address
- consignee_name: Importer/Consignee company name
- consignee_address: Full address
- notify_party: Notify party name
- notify_party_address: Notify party address
- freight_forwarder: Freight forwarder/NVOCC if mentioned

CARGO DETAILS:
- commodity_description: Description of goods / cargo description
- container_type: Size/type (20GP, 40GP, 40HC, 20RF, 45HC, etc.)
- weight_kg: Total weight in kilograms (convert: 1 MT = 1000 KG)
- volume_cbm: Total volume in cubic meters
- package_count: Number of packages/pieces
- package_type: Packaging type (CTNS, PALLETS, DRUMS, BAGS, etc.)
- seal_numbers: Array of seal numbers from containers

HS CODES & CUSTOMS (from Arrival Notice, Duty Entry Summary, customs docs):
- hs_codes: Array of ALL HS tariff codes (e.g., ["8471.30", "8473.21"])
- an_number: Arrival Notice reference number
- it_number: IT Number / Immediate Transportation number (starts with "IT", e.g., "IT1234567")
- entry_number: Customs Entry Number / Import Entry Number
- bond_number: Customs Bond Number
- isf_number: Importer Security Filing number (10+2)
- ior_number: Importer of Record number

FINANCIAL / VALUE TABLE (from commercial invoice, duty summary):
- cargo_value: Declared cargo/goods value (number only)
- cargo_value_currency: Currency code (USD, EUR, INR, CNY)
- duty_amount: Customs duty amount payable
- tax_amount: Tax amount (GST, VAT, etc.)
- freight_amount: Freight/shipping charges
- insurance_amount: Insurance value

COMMERCIAL TERMS:
- incoterms: Trade terms (FOB, CIF, EXW, DDP, DAP, etc.)
- freight_terms: Prepaid/Collect

REFERENCES - EXTRACT ALL NUMBERS:
- customer_reference: Shipper/buyer reference
- forwarder_reference: Forwarder's internal reference
- po_numbers: Array of Purchase Order numbers
- invoice_numbers: Array of Commercial Invoice numbers

IMPORTANT RULES:
1. Convert ALL dates to ISO format (YYYY-MM-DD or YYYY-MM-DD HH:MM)
2. Date formats to handle: DD-MMM-YYYY, DD/MM/YYYY, MM/DD/YYYY, MMM DD YYYY
3. Use null (not empty string) for missing values
4. Extract ALL container numbers, HS codes, PO numbers as arrays
5. Remove prefixes like "M/V", "MV", "Vessel:" from vessel names
6. For UN/LOCODEs, use standard 5-character format (XXYYY)
7. Convert weights: 1 MT = 1000 KG, 1 LB = 0.453592 KG
8. For cutoff times, preserve the time component when available
9. Look in TABLES, VALUE SECTIONS, FINE PRINT for amounts and codes
10. HS codes format: Include dots (e.g., "8471.30.00" not "84713000")

CONTENT TO EXTRACT FROM:
{CONTENT}

Return ONLY valid JSON matching this exact structure:
{
  "booking_number": string | null,
  "bl_number": string | null,
  "mbl_number": string | null,
  "hbl_number": string | null,
  "container_numbers": string[],
  "carrier_name": string | null,
  "carrier_code": string | null,
  "vessel_name": string | null,
  "voyage_number": string | null,
  "service_name": string | null,
  "port_of_loading": string | null,
  "port_of_loading_code": string | null,
  "port_of_discharge": string | null,
  "port_of_discharge_code": string | null,
  "place_of_receipt": string | null,
  "place_of_receipt_code": string | null,
  "place_of_delivery": string | null,
  "place_of_delivery_code": string | null,
  "final_destination": string | null,
  "transhipment_ports": string[],
  "etd": string | null,
  "eta": string | null,
  "actual_departure": string | null,
  "actual_arrival": string | null,
  "si_cutoff": string | null,
  "vgm_cutoff": string | null,
  "cargo_cutoff": string | null,
  "gate_cutoff": string | null,
  "doc_cutoff": string | null,
  "port_cutoff": string | null,
  "customs_cutoff": string | null,
  "hazmat_cutoff": string | null,
  "reefer_cutoff": string | null,
  "early_return_date": string | null,
  "terminal_receiving_date": string | null,
  "late_gate": string | null,
  "shipper_name": string | null,
  "shipper_address": string | null,
  "consignee_name": string | null,
  "consignee_address": string | null,
  "notify_party": string | null,
  "notify_party_address": string | null,
  "freight_forwarder": string | null,
  "commodity_description": string | null,
  "container_type": string | null,
  "weight_kg": number | null,
  "volume_cbm": number | null,
  "package_count": number | null,
  "package_type": string | null,
  "seal_numbers": string[],
  "hs_codes": string[],
  "an_number": string | null,
  "it_number": string | null,
  "entry_number": string | null,
  "bond_number": string | null,
  "isf_number": string | null,
  "ior_number": string | null,
  "cargo_value": number | null,
  "cargo_value_currency": string | null,
  "duty_amount": number | null,
  "tax_amount": number | null,
  "freight_amount": number | null,
  "insurance_amount": number | null,
  "incoterms": string | null,
  "freight_terms": string | null,
  "customer_reference": string | null,
  "forwarder_reference": string | null,
  "po_numbers": string[],
  "invoice_numbers": string[]
}`;

// Carrier-specific hints to prepend to the main prompt
// MERGED: Contains detailed extraction instructions from email-processing-orchestrator.ts
const CARRIER_HINTS: Record<CarrierId, string> = {
  'hapag-lloyd': `HAPAG-LLOYD SPECIFIC PATTERNS:
- Booking numbers: 8-10 digits, may have "HL-" or "HLCU" prefix

CUTOFFS - Look for "Deadline Information" section:
- "Shipping instruction closing" / "SI closing" → si_cutoff
- "VGM cut-off" / "VGM deadline" → vgm_cutoff
- "FCL delivery cut-off" / "Cargo cut-off" / "CY closing" → cargo_cutoff
- "Documentation cut-off" / "Doc closing" → doc_cutoff
- "Gate closing" / "Terminal cut-off" → gate_cutoff
- "Customs cut-off" → customs_cutoff
- "Hazardous cargo cut-off" / "DG cut-off" → hazmat_cutoff
- "Reefer cut-off" → reefer_cutoff

- Look for "Vessel/Voyage" for vessel and voyage info
- Dates are typically in format: DD-Mon-YYYY HH:MM (e.g., "25-Dec-2025 10:00")

ARRIVAL NOTICE fields:
- "IT Number" / "In-Bond Number" → it_number (starts with "IT")
- "Entry Number" → entry_number
`,
  'maersk': `MAERSK SPECIFIC PATTERNS:
CRITICAL RULES:
1. Extract data ONLY from the CONTENT section below - not from these instructions
2. DO NOT use any example data from these instructions
3. If you cannot find a value in the CONTENT, use null

HEADER SECTION - Look for:
- "Booking No.:" followed by a 9-digit number → booking_number
- "From:" followed by city,state,country → port_of_loading (use just the city name)
- "To:" followed by city,state,country → port_of_discharge (use just the city name)

INTENDED TRANSPORT PLAN TABLE - Look for section containing:
- Columns: From | To | Mode | Vessel | Voy No. | ETD | ETA
- For multi-leg journeys: Use ETD from first row, ETA from last row
- vessel_name: Use the main ocean vessel (usually goes to final destination)
- Dates are in YYYY-MM-DD format

CUTOFF DATES - Look for:
- "SI Cut off" / "Documentation Cut off" → si_cutoff
- "VGM" deadline / "VGM Cut off" → vgm_cutoff
- "Gate-In Cut off" / "Gate Cut off" → gate_cutoff
- "Cargo Cut off" / "CY Cut off" → cargo_cutoff
- "Port Cut off" → port_cutoff
- "Early Return Date" / "ERD" → early_return_date
- "Terminal Receiving" / "TRD" → terminal_receiving_date

ARRIVAL NOTICE fields:
- "IT Number" → it_number
- "Entry No." → entry_number

IMPORTANT:
- All dates should be in YYYY-MM-DD format
- Current bookings have dates in 2025 or 2026
- If a date is from 2023 or earlier, it is likely wrong - use null
- Container codes: MAEU, MSKU
`,
  'cma-cgm': `CMA CGM SPECIFIC PATTERNS:
- Booking numbers may have "CMI" or alphanumeric format

CUTOFFS - Look for "Cut-off Dates" section:
- "SI Closing" / "Documentation Closing" → si_cutoff
- "VGM Closing" / "VGM Cut-off" → vgm_cutoff
- "Cargo Closing" / "CY Closing" → cargo_cutoff
- "Gate Closing" → gate_cutoff
- "Customs Closing" → customs_cutoff
- "DG Closing" / "Hazmat Closing" → hazmat_cutoff
- "Reefer Closing" → reefer_cutoff
- "Port Closing" → port_cutoff

- Dates often in format: DD/MM/YYYY HH:MM
- Container codes: CMAU, APLU

ARRIVAL NOTICE:
- "IT#" / "IT Number" → it_number
`,
  'msc': `MSC SPECIFIC PATTERNS:
CUTOFFS - Look for "Closing Date" sections:
- "SI Deadline" / "SI Closing" → si_cutoff
- "VGM Cut-off" / "VGM Deadline" → vgm_cutoff
- "Port Cut-off" / "Terminal Cut-off" → cargo_cutoff
- "Gate Cut-off" → gate_cutoff
- "Customs Cut-off" → customs_cutoff
- "DG Cut-off" → hazmat_cutoff
- "Reefer Cut-off" → reefer_cutoff
- "ERD" / "Earliest Return" → early_return_date

- Container codes: MSCU, MEDU

ARRIVAL NOTICE:
- "IT Number" → it_number
- "Entry Number" → entry_number
`,
  'cosco': `COSCO SPECIFIC PATTERNS:
- Booking numbers start with "COSU" followed by 10 digits

CUTOFFS - Look for "Cut-off" or "Closing" sections:
- "SI Cut-off" / "Documentation Deadline" → si_cutoff
- "VGM Cut-off" → vgm_cutoff
- "CY Cut-off" / "Cargo Cut-off" → cargo_cutoff
- "Gate Cut-off" → gate_cutoff
- "Port Cut-off" → port_cutoff

- Dates in various formats
- Container codes: COSU, OOLU

ARRIVAL NOTICE:
- "IT#" → it_number
`,
  'one': `ONE (OCEAN NETWORK EXPRESS) SPECIFIC PATTERNS:
- Booking numbers may have "ONEY" prefix

CUTOFFS - Look for "Deadline" or "Cut-off" sections:
- "SI Deadline" / "Documentation Deadline" → si_cutoff
- "VGM Deadline" → vgm_cutoff
- "CY/CFS Cut-off" → cargo_cutoff
- "Gate Cut-off" → gate_cutoff
- "Port Cut-off" → port_cutoff

- Container codes: ONEY
`,
  'evergreen': `EVERGREEN SPECIFIC PATTERNS:
- Booking numbers with "EGLV" prefix

CUTOFFS:
- "SI Cut-off" → si_cutoff
- "VGM Cut-off" → vgm_cutoff
- "CY Cut-off" → cargo_cutoff
- "Gate Cut-off" → gate_cutoff

- Container codes: EGLV, EGHU
`,
  'yang-ming': `YANG MING SPECIFIC PATTERNS:
- Booking numbers with "YMLU" prefix

CUTOFFS:
- "SI Deadline" → si_cutoff
- "VGM Deadline" → vgm_cutoff
- "CY Closing" → cargo_cutoff
- "Gate Closing" → gate_cutoff

- Container codes: YMLU
`,
  'unknown': `GENERIC CUTOFF TERMINOLOGY MAPPING:
Look for ANY of these terms and map to our fields:
- "SI" / "Shipping Instruction" / "Documentation" closing/deadline → si_cutoff
- "VGM" / "Verified Gross Mass" closing/deadline → vgm_cutoff
- "Cargo" / "CY" / "FCL" / "Container" closing/deadline → cargo_cutoff
- "Gate" / "Terminal Gate" closing/deadline → gate_cutoff
- "Port" / "Terminal" closing/deadline → port_cutoff
- "Customs" closing/deadline → customs_cutoff
- "Hazmat" / "DG" / "Dangerous Goods" / "Hazardous" closing/deadline → hazmat_cutoff
- "Reefer" / "Refrigerated" closing/deadline → reefer_cutoff
- "ERD" / "Early Return" / "Earliest Return Date" → early_return_date
- "TRD" / "Terminal Receiving" / "Receiving Date" → terminal_receiving_date
- "Late Gate" / "Extended Gate" → late_gate

ARRIVAL NOTICE:
- "IT Number" / "IT#" / "In-Bond" (starts with "IT") → it_number
- "Entry Number" / "Entry#" / "Import Entry" → entry_number
- "AN Number" / "Arrival Notice#" → an_number
`
};

// ============================================================================
// Main Service
// ============================================================================

export class ShipmentExtractionService {
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private useAdvancedModel: boolean;

  constructor(
    supabase: SupabaseClient,
    anthropicApiKey: string,
    options: { useAdvancedModel?: boolean } = {}
  ) {
    this.supabase = supabase;
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.useAdvancedModel = options.useAdvancedModel ?? true;
  }

  /**
   * Extract all shipment data from an email
   * Deep module: Simple interface, complex implementation
   */
  async extractFromEmail(emailId: string): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      // 1. Get email content
      const { data: email, error: emailError } = await this.supabase
        .from('raw_emails')
        .select('id, subject, body_text, sender_email')
        .eq('id', emailId)
        .single();

      if (emailError || !email) {
        return {
          success: false,
          data: null,
          error: `Email not found: ${emailId}`,
          processingTime: Date.now() - startTime
        };
      }

      // 2. Get PDF attachments with extracted text
      const { data: attachments } = await this.supabase
        .from('raw_attachments')
        .select('filename, extracted_text, mime_type')
        .eq('email_id', emailId);

      // 3. Combine content
      let combinedContent = `Subject: ${email.subject || ''}\n\n`;
      combinedContent += `Email Body:\n${email.body_text || ''}\n`;

      let hasPdfContent = false;
      for (const att of attachments || []) {
        if (att.extracted_text && att.mime_type?.includes('pdf')) {
          combinedContent += `\n\n--- PDF ATTACHMENT: ${att.filename} ---\n${att.extracted_text}`;
          hasPdfContent = true;
        }
      }

      // 4. Detect carrier
      const carrier = this.detectCarrier(email.sender_email, combinedContent);

      // 5. Extract using AI
      const extracted = await this.extractWithAI(combinedContent, carrier);

      if (!extracted) {
        return {
          success: false,
          data: null,
          error: 'AI extraction failed',
          processingTime: Date.now() - startTime
        };
      }

      // 6. Normalize and validate
      const normalized = this.normalizeExtractedData(extracted);
      normalized.extraction_source = hasPdfContent ? 'combined' : 'email_body';
      normalized.raw_content_length = combinedContent.length;

      return {
        success: true,
        data: normalized,
        processingTime: Date.now() - startTime
      };

    } catch (error: any) {
      return {
        success: false,
        data: null,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Extract shipment data from raw text (for PDF-only extraction)
   */
  async extractFromPdfText(text: string, carrier?: CarrierId): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      const detectedCarrier = carrier || this.detectCarrier('', text);
      const extracted = await this.extractWithAI(text, detectedCarrier);

      if (!extracted) {
        return {
          success: false,
          data: null,
          error: 'AI extraction failed',
          processingTime: Date.now() - startTime
        };
      }

      const normalized = this.normalizeExtractedData(extracted);
      normalized.extraction_source = 'pdf_attachment';
      normalized.raw_content_length = text.length;

      return {
        success: true,
        data: normalized,
        processingTime: Date.now() - startTime
      };

    } catch (error: any) {
      return {
        success: false,
        data: null,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Extract shipment data from pre-combined content
   * Used by EmailProcessingOrchestrator to avoid re-fetching email/attachments
   *
   * This is the CONSOLIDATED extraction entry point for the cron job
   */
  async extractFromContent(input: {
    emailId: string;
    subject: string;
    bodyText: string;
    pdfContent: string;
    carrier: string;
  }): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      // Combine content in expected format
      const content = `Subject: ${input.subject}\n\nBody:\n${input.bodyText}\n\n--- PDF ---\n${input.pdfContent}`;

      // Map carrier string to CarrierId
      const carrierId = this.mapToCarrierId(input.carrier);

      // Extract using AI with anti-hallucination validation
      const extracted = await this.extractWithAI(content, carrierId);

      if (!extracted) {
        return {
          success: false,
          data: null,
          error: 'AI extraction failed',
          processingTime: Date.now() - startTime
        };
      }

      // Apply anti-hallucination validation
      const validated = this.validateAndCorrectExtraction(extracted, content);

      // Normalize data
      const normalized = this.normalizeExtractedData(validated);
      normalized.extraction_source = input.pdfContent ? 'combined' : 'email_body';
      normalized.raw_content_length = content.length;

      return {
        success: true,
        data: normalized,
        processingTime: Date.now() - startTime
      };

    } catch (error: any) {
      console.error(`[ShipmentExtractionService] extractFromContent error:`, error.message);
      return {
        success: false,
        data: null,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Map carrier string to CarrierId enum
   */
  private mapToCarrierId(carrier: string): CarrierId {
    const mapping: Record<string, CarrierId> = {
      'hapag-lloyd': 'hapag-lloyd',
      'maersk': 'maersk',
      'cma-cgm': 'cma-cgm',
      'msc': 'msc',
      'cosco': 'cosco',
      'one': 'one',
      'evergreen': 'evergreen',
      'yang-ming': 'yang-ming',
      'default': 'unknown',
    };
    return mapping[carrier.toLowerCase()] || 'unknown';
  }

  /**
   * Anti-hallucination validation and correction
   * Detects when AI has hallucinated values and attempts regex fallback
   */
  private validateAndCorrectExtraction(data: any, content: string): any {
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 1; // Allow last year for recent bookings

    // Check ETD for hallucination (dates from training data)
    if (data.etd) {
      const etdYear = parseInt(data.etd.substring(0, 4));
      if (etdYear < minYear || etdYear > currentYear + 2) {
        console.warn(`[ShipmentExtractionService] Detected hallucinated ETD: ${data.etd}, attempting regex fallback`);

        // Try to extract date directly from content using regex
        const dateMatches = content.match(/20(?:2[4-9]|3\d)-\d{2}-\d{2}/g);
        if (dateMatches?.length) {
          data.etd = dateMatches[0];
          if (dateMatches.length > 1) {
            data.eta = dateMatches[dateMatches.length - 1];
          }
        } else {
          data.etd = null;
          data.eta = null;
        }
      }
    }

    // Check ETA for hallucination
    if (data.eta) {
      const etaYear = parseInt(data.eta.substring(0, 4));
      if (etaYear < minYear || etaYear > currentYear + 2) {
        console.warn(`[ShipmentExtractionService] Detected hallucinated ETA: ${data.eta}`);
        data.eta = null;
      }
    }

    // For Maersk PDFs, try to extract POL/POD from header as fallback
    // Header format: "From:\nMundra,GUJARAT,India" and "To:\nLos Angeles,California,United States"
    const polMatch = content.match(/\bFrom:\s*\n?([A-Za-z\s]+)/);
    const podMatch = content.match(/\bTo:\s*\n?([A-Za-z\s]+)/);

    // Use regex extraction if AI returned generic/hallucinated values
    if (polMatch?.[1] && (!data.port_of_loading || data.port_of_loading.length < 3)) {
      const regexPol = polMatch[1].trim();
      if (regexPol.length > 1 && regexPol.length < 50) {
        data.port_of_loading = regexPol;
      }
    }

    if (podMatch?.[1] && (!data.port_of_discharge || data.port_of_discharge.length < 3)) {
      const regexPod = podMatch[1].trim();
      if (regexPod.length > 1 && regexPod.length < 50) {
        data.port_of_discharge = regexPod;
      }
    }

    // Validate ALL cutoff dates and other date fields
    const dateFields = [
      'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff',
      'port_cutoff', 'customs_cutoff', 'hazmat_cutoff', 'reefer_cutoff',
      'early_return_date', 'terminal_receiving_date', 'late_gate'
    ];
    for (const field of dateFields) {
      if (data[field]) {
        const year = parseInt(data[field].substring(0, 4));
        if (year < minYear || year > currentYear + 2) {
          console.warn(`[ShipmentExtractionService] Detected hallucinated ${field}: ${data[field]}`);
          data[field] = null;
        }
      }
    }

    return data;
  }

  /**
   * Detect carrier from sender email and content
   */
  private detectCarrier(senderEmail: string, content: string): CarrierId {
    const combined = `${senderEmail} ${content}`;

    for (const [carrierId, patterns] of Object.entries(CARRIER_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(combined)) {
          return carrierId as CarrierId;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Extract data using AI with carrier-specific hints
   */
  private async extractWithAI(content: string, carrier: CarrierId): Promise<any | null> {
    const carrierHint = CARRIER_HINTS[carrier] || '';
    const prompt = (carrierHint ? carrierHint + '\n\n' : '') +
      COMPREHENSIVE_EXTRACTION_PROMPT.replace('{CONTENT}', content.substring(0, 15000));

    try {
      // Use Sonnet for complex extraction, Haiku for simple
      const model = this.useAdvancedModel
        ? 'claude-sonnet-4-20250514'
        : 'claude-3-haiku-20240307';

      const response = await this.anthropic.messages.create({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return null;
    } catch (error: any) {
      console.error('AI extraction error:', error.message);
      return null;
    }
  }

  /**
   * Normalize and validate extracted data
   */
  normalizeExtractedData(raw: any): ShipmentData {
    const fieldsExtracted: string[] = [];

    // Helper to track non-null fields
    const track = <T>(value: T, fieldName: string): T => {
      if (value !== null && value !== undefined && value !== '' &&
          !(Array.isArray(value) && value.length === 0)) {
        fieldsExtracted.push(fieldName);
      }
      return value;
    };

    // Helper to clean strings
    const cleanString = (val: any): string | null => {
      if (val === null || val === undefined || val === 'null' || val === '') {
        return null;
      }
      return String(val).trim();
    };

    // Helper to clean arrays
    const cleanArray = (val: any): string[] => {
      if (!Array.isArray(val)) return [];
      return val.filter((v: any) => v && v !== 'null').map((v: any) => String(v).trim());
    };

    // Helper to parse number
    const parseNumber = (val: any): number | null => {
      if (val === null || val === undefined || val === 'null') return null;
      const num = parseFloat(val);
      return isNaN(num) ? null : num;
    };

    // Helper to normalize date
    const normalizeDate = (val: any): string | null => {
      if (!val || val === 'null') return null;
      // Try to parse as date
      const parsed = parseEntityDate(String(val));
      return parsed;
    };

    // Helper to normalize datetime (for cutoffs)
    const normalizeDatetime = (val: any): string | null => {
      if (!val || val === 'null') return null;
      // Try to preserve time component
      const parsed = parseEntityDateTime(String(val));
      // If datetime parsing worked, extract just the date part for database compatibility
      if (parsed) {
        return parsed.split('T')[0];
      }
      return parseEntityDate(String(val));
    };

    // Helper to clean vessel name
    const cleanVesselName = (val: any): string | null => {
      const cleaned = cleanString(val);
      if (!cleaned) return null;
      // Remove common prefixes
      return cleaned.replace(/^(M\/V|MV|Vessel:|V\.|Ship:)\s*/i, '').trim();
    };

    // Calculate confidence based on extracted fields
    const calculateConfidence = (): number => {
      const criticalFields = ['booking_number', 'carrier_name', 'port_of_loading', 'port_of_discharge'];
      const importantFields = ['etd', 'eta', 'vessel_name', 'container_numbers'];
      const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff'];

      let score = 0;
      const maxScore = 100;

      // Critical fields: 40 points total
      criticalFields.forEach(f => {
        if (fieldsExtracted.includes(f)) score += 10;
      });

      // Important fields: 30 points total
      importantFields.forEach(f => {
        if (fieldsExtracted.includes(f)) score += 7.5;
      });

      // Cutoff fields: 20 points total
      cutoffFields.forEach(f => {
        if (fieldsExtracted.includes(f)) score += 6.67;
      });

      // Remaining fields: 10 points total
      const remainingCount = fieldsExtracted.length -
        criticalFields.filter(f => fieldsExtracted.includes(f)).length -
        importantFields.filter(f => fieldsExtracted.includes(f)).length -
        cutoffFields.filter(f => fieldsExtracted.includes(f)).length;

      score += Math.min(remainingCount * 0.5, 10);

      return Math.min(Math.round(score), maxScore);
    };

    const result: ShipmentData = {
      // Primary Identifiers
      booking_number: track(cleanString(raw.booking_number), 'booking_number'),
      bl_number: track(cleanString(raw.bl_number), 'bl_number'),
      container_numbers: track(cleanArray(raw.container_numbers), 'container_numbers'),

      // Carrier & Voyage
      carrier_name: track(cleanString(raw.carrier_name), 'carrier_name'),
      carrier_code: track(cleanString(raw.carrier_code), 'carrier_code'),
      vessel_name: track(cleanVesselName(raw.vessel_name), 'vessel_name'),
      voyage_number: track(cleanString(raw.voyage_number), 'voyage_number'),
      service_name: track(cleanString(raw.service_name), 'service_name'),

      // Routing (including inland ports)
      port_of_loading: track(cleanString(raw.port_of_loading), 'port_of_loading'),
      port_of_loading_code: track(cleanString(raw.port_of_loading_code), 'port_of_loading_code'),
      port_of_discharge: track(cleanString(raw.port_of_discharge), 'port_of_discharge'),
      port_of_discharge_code: track(cleanString(raw.port_of_discharge_code), 'port_of_discharge_code'),
      place_of_receipt: track(cleanString(raw.place_of_receipt), 'place_of_receipt'),
      place_of_receipt_code: track(cleanString(raw.place_of_receipt_code), 'place_of_receipt_code'),
      place_of_delivery: track(cleanString(raw.place_of_delivery), 'place_of_delivery'),
      place_of_delivery_code: track(cleanString(raw.place_of_delivery_code), 'place_of_delivery_code'),
      transhipment_ports: track(cleanArray(raw.transhipment_ports), 'transhipment_ports'),
      final_destination: track(cleanString(raw.final_destination), 'final_destination'),

      // Dates
      etd: track(normalizeDate(raw.etd), 'etd'),
      eta: track(normalizeDate(raw.eta), 'eta'),
      actual_departure: track(normalizeDate(raw.actual_departure), 'actual_departure'),
      actual_arrival: track(normalizeDate(raw.actual_arrival), 'actual_arrival'),

      // Cutoffs - ALL types
      si_cutoff: track(normalizeDatetime(raw.si_cutoff), 'si_cutoff'),
      vgm_cutoff: track(normalizeDatetime(raw.vgm_cutoff), 'vgm_cutoff'),
      cargo_cutoff: track(normalizeDatetime(raw.cargo_cutoff), 'cargo_cutoff'),
      gate_cutoff: track(normalizeDatetime(raw.gate_cutoff), 'gate_cutoff'),
      doc_cutoff: track(normalizeDatetime(raw.doc_cutoff), 'doc_cutoff'),
      port_cutoff: track(normalizeDatetime(raw.port_cutoff), 'port_cutoff'),
      customs_cutoff: track(normalizeDatetime(raw.customs_cutoff), 'customs_cutoff'),
      hazmat_cutoff: track(normalizeDatetime(raw.hazmat_cutoff), 'hazmat_cutoff'),
      reefer_cutoff: track(normalizeDatetime(raw.reefer_cutoff), 'reefer_cutoff'),
      early_return_date: track(normalizeDatetime(raw.early_return_date), 'early_return_date'),
      terminal_receiving_date: track(normalizeDatetime(raw.terminal_receiving_date), 'terminal_receiving_date'),
      late_gate: track(normalizeDatetime(raw.late_gate), 'late_gate'),

      // Parties
      shipper_name: track(cleanString(raw.shipper_name), 'shipper_name'),
      shipper_address: track(cleanString(raw.shipper_address), 'shipper_address'),
      consignee_name: track(cleanString(raw.consignee_name), 'consignee_name'),
      consignee_address: track(cleanString(raw.consignee_address), 'consignee_address'),
      notify_party: track(cleanString(raw.notify_party), 'notify_party'),
      notify_party_address: track(cleanString(raw.notify_party_address), 'notify_party_address'),
      freight_forwarder: track(cleanString(raw.freight_forwarder), 'freight_forwarder'),

      // Cargo
      commodity_description: track(cleanString(raw.commodity_description), 'commodity_description'),
      container_type: track(cleanString(raw.container_type), 'container_type'),
      weight_kg: track(parseNumber(raw.weight_kg), 'weight_kg'),
      volume_cbm: track(parseNumber(raw.volume_cbm), 'volume_cbm'),
      package_count: track(parseNumber(raw.package_count), 'package_count'),
      package_type: track(cleanString(raw.package_type), 'package_type'),
      seal_numbers: track(cleanArray(raw.seal_numbers), 'seal_numbers'),

      // HS Codes & Customs (from Arrival Notice / Duty Entry)
      hs_codes: track(cleanArray(raw.hs_codes), 'hs_codes'),
      an_number: track(cleanString(raw.an_number), 'an_number'),
      it_number: track(cleanString(raw.it_number), 'it_number'),
      entry_number: track(cleanString(raw.entry_number), 'entry_number'),
      bond_number: track(cleanString(raw.bond_number), 'bond_number'),
      isf_number: track(cleanString(raw.isf_number), 'isf_number'),
      ior_number: track(cleanString(raw.ior_number), 'ior_number'),

      // Financial / Value Table
      cargo_value: track(parseNumber(raw.cargo_value), 'cargo_value'),
      cargo_value_currency: track(cleanString(raw.cargo_value_currency), 'cargo_value_currency'),
      duty_amount: track(parseNumber(raw.duty_amount), 'duty_amount'),
      tax_amount: track(parseNumber(raw.tax_amount), 'tax_amount'),
      freight_amount: track(parseNumber(raw.freight_amount), 'freight_amount'),
      insurance_amount: track(parseNumber(raw.insurance_amount), 'insurance_amount'),

      // Commercial
      incoterms: track(cleanString(raw.incoterms), 'incoterms'),
      freight_terms: track(cleanString(raw.freight_terms), 'freight_terms'),

      // References - ALL document numbers
      customer_reference: track(cleanString(raw.customer_reference), 'customer_reference'),
      forwarder_reference: track(cleanString(raw.forwarder_reference), 'forwarder_reference'),
      mbl_number: track(cleanString(raw.mbl_number), 'mbl_number'),
      hbl_number: track(cleanString(raw.hbl_number), 'hbl_number'),
      po_numbers: track(cleanArray(raw.po_numbers), 'po_numbers'),
      invoice_numbers: track(cleanArray(raw.invoice_numbers), 'invoice_numbers'),

      // Metadata
      extraction_confidence: 0, // Set below
      extraction_source: 'email_body',
      fields_extracted: fieldsExtracted,
      raw_content_length: 0
    };

    // Calculate confidence after collecting all fields
    result.extraction_confidence = calculateConfidence();

    return result;
  }

  /**
   * Convert extracted data to entity records for database storage
   */
  toEntityRecords(
    data: ShipmentData,
    emailId: string,
    classificationId?: string
  ): Array<{
    email_id: string;
    classification_id?: string;
    entity_type: string;
    entity_value: string;
    confidence_score: number;
    extraction_method: string;
  }> {
    const records: Array<{
      email_id: string;
      classification_id?: string;
      entity_type: string;
      entity_value: string;
      confidence_score: number;
      extraction_method: string;
    }> = [];

    const addEntity = (type: string, value: string | null | number) => {
      if (value !== null && value !== undefined) {
        records.push({
          email_id: emailId,
          classification_id: classificationId,
          entity_type: type,
          entity_value: String(value),
          confidence_score: data.extraction_confidence,
          extraction_method: 'ai_comprehensive'
        });
      }
    };

    // Map fields to entity types
    addEntity('booking_number', data.booking_number);
    addEntity('bl_number', data.bl_number);
    addEntity('carrier', data.carrier_name);
    addEntity('vessel_name', data.vessel_name);
    addEntity('voyage_number', data.voyage_number);
    addEntity('port_of_loading', data.port_of_loading);
    addEntity('port_of_loading_code', data.port_of_loading_code);
    addEntity('port_of_discharge', data.port_of_discharge);
    addEntity('port_of_discharge_code', data.port_of_discharge_code);
    addEntity('place_of_receipt', data.place_of_receipt);
    addEntity('place_of_delivery', data.place_of_delivery);
    addEntity('etd', data.etd);
    addEntity('eta', data.eta);
    addEntity('si_cutoff', data.si_cutoff);
    addEntity('vgm_cutoff', data.vgm_cutoff);
    addEntity('cargo_cutoff', data.cargo_cutoff);
    addEntity('gate_cutoff', data.gate_cutoff);
    addEntity('shipper', data.shipper_name);
    addEntity('consignee', data.consignee_name);
    addEntity('commodity', data.commodity_description);
    addEntity('weight', data.weight_kg);
    addEntity('volume', data.volume_cbm);
    addEntity('incoterms', data.incoterms);

    // Container numbers
    for (const container of data.container_numbers) {
      addEntity('container_number', container);
    }

    return records;
  }

  /**
   * Convert extracted data to shipment record for database
   */
  toShipmentRecord(data: ShipmentData): Partial<Record<string, any>> {
    return {
      booking_number: data.booking_number,
      bl_number: data.bl_number,
      container_number_primary: data.container_numbers[0] || null,
      vessel_name: data.vessel_name,
      voyage_number: data.voyage_number,
      port_of_loading: data.port_of_loading,
      port_of_loading_code: data.port_of_loading_code,
      port_of_discharge: data.port_of_discharge,
      port_of_discharge_code: data.port_of_discharge_code,
      place_of_receipt: data.place_of_receipt,
      place_of_delivery: data.place_of_delivery,
      etd: data.etd,
      eta: data.eta,
      atd: data.actual_departure,
      ata: data.actual_arrival,
      si_cutoff: data.si_cutoff,
      vgm_cutoff: data.vgm_cutoff,
      cargo_cutoff: data.cargo_cutoff,
      gate_cutoff: data.gate_cutoff,
      commodity_description: data.commodity_description,
      total_weight: data.weight_kg,
      total_volume: data.volume_cbm,
      weight_unit: 'KG',
      volume_unit: 'CBM',
      incoterms: data.incoterms,
      freight_terms: data.freight_terms,
      // Party names (stored inline for now, Party linking done separately)
      shipper_name: data.shipper_name,
      consignee_name: data.consignee_name
    };
  }
}

export default ShipmentExtractionService;
