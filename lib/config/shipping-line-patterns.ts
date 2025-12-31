/**
 * Deterministic Shipping Line Classification Patterns
 *
 * PRINCIPLE: Subject patterns + PDF presence = iron-clad classification
 *
 * Pattern Categories:
 * - Booking Confirmation: Original BC from carrier (MUST have PDF)
 * - Booking Amendment/Update: Changes to existing booking
 * - SI Confirmation: Shipping instruction submitted/confirmed
 * - Bill of Lading: Draft/Copy/Original BL
 * - Invoice: Freight/Proforma invoice
 * - Arrival Notice: Cargo arrival notification (VERY IMPORTANT)
 * - Shipment Notice: Shipment/Discharge notification
 * - General Correspondence: RE:/Re: threads, operational emails
 */

export type DocumentType =
  | 'booking_confirmation'
  | 'booking_amendment'
  | 'booking_cancellation'
  | 'arrival_notice'
  | 'shipment_notice'
  | 'bill_of_lading'
  | 'shipping_instruction'
  | 'invoice'
  | 'vgm_confirmation'
  | 'vgm_reminder'
  | 'vessel_schedule'
  | 'pickup_notification'
  | 'cutoff_advisory'
  | 'general_correspondence';

export interface CarrierPattern {
  documentType: DocumentType;
  subjectPatterns: RegExp[];
  senderPatterns: RegExp[];
  requiresPdf?: boolean;  // If true, MUST have PDF attachment
  attachmentPatterns?: RegExp[];
  attachmentContentPatterns?: RegExp[];  // Patterns to match in attachment TEXT (not filename)
  priority: number; // Higher = checked first
  notes?: string;  // Documentation for pattern
}

export interface CarrierConfig {
  carrierId: string;
  carrierName: string;
  senderDomains: string[];
  patterns: CarrierPattern[];
}

// ============================================================================
// MAERSK PATTERNS
// ============================================================================

export const MAERSK_CONFIG: CarrierConfig = {
  carrierId: 'maersk',
  carrierName: 'Maersk Line',
  senderDomains: ['maersk.com', 'sealand.com'],
  patterns: [
    // Booking Confirmation - MUST have PDF with "BOOKING CONFIRMATION" heading
    // Pattern 1: "Booking Confirmation : 263522431"
    // Pattern 2: "Booking Confirmation - MAEU9876543210"
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [
        /^Booking Confirmation\s*:\s*\d+/i,
        /^Booking Confirmation\s*-\s*MAEU\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],  // Match anywhere in domain
      requiresPdf: true,
      attachmentContentPatterns: [
        /BOOKING CONFIRMATION/i,  // Must have this heading in PDF
      ],
      priority: 100,
      notes: 'Primary BC format. PDF must contain "BOOKING CONFIRMATION" heading.',
    },
    // Booking Amendment
    // Pattern: "Booking Amendment : 262266445"
    {
      documentType: 'booking_amendment',
      subjectPatterns: [
        /^Booking Amendment\s*:\s*\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      requiresPdf: false,  // PDF not always attached
      priority: 95,
      notes: 'Booking changes/amendments.',
    },
    // Arrival Notice - VERY IMPORTANT
    // Pattern 1: "Arrival notice 261736030"
    // Pattern 2: "Arrival Notice : Container# MRKU7230190..."
    // Pattern 3: "Arrival Notice : Shipper : Matangi..."
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^Arrival notice\s+\d+/i,
        /^Arrival Notice\s*:/i,  // Covers Container# and Shipper formats
      ],
      senderPatterns: [/maersk\.com/i],
      requiresPdf: false,  // PDF not always attached
      priority: 90,
      notes: 'Arrival notification with cargo details.',
    },
    // Invoice
    // Pattern 1: "New invoice GJ26IN2500375201 (BL 262175704)"
    // Pattern 2: "New invoice MH26IN..." format
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^New invoice\s+[A-Z0-9]+\s*\(BL\s+\d+\)/i,
        /^New invoice\s+[A-Z]{2}\d{2}IN\d+/i,  // Covers GJ26IN, MH26IN formats
      ],
      senderPatterns: [/maersk\.com/i],
      requiresPdf: false,  // PDF not always attached
      attachmentPatterns: [/^invoice_[A-Z0-9]+\.pdf$/i],
      priority: 85,
      notes: 'Freight invoice with BL reference.',
    },
    // Customer Support Case
    // Pattern: "Your Case Number : 2512-344221792, ..."
    {
      documentType: 'general_correspondence',
      subjectPatterns: [
        /^Your Case Number\s*:/i,
        /Case Number\s*:\s*\d+-\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 40,
      notes: 'Customer support case emails - tracked but not shipment documents.',
    },
    // Shipping Instruction - Maersk
    // Pattern: "SI submitted 262874542-27Dec2025 20:48:34 UTC"
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [
        /^SI submitted\s+\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 90,
      notes: 'Maersk SI submitted confirmation.',
    },
    // Bill of Lading / Sea Waybill - Maersk (with PDF)
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /Bill of Lading/i,
        /^B\/L\s+/i,
        /Draft BL/i,
      ],
      senderPatterns: [/maersk\.com/i],
      requiresPdf: true,
      priority: 80,
      notes: 'Draft or final BL (requires PDF).',
    },
    // Sea Waybill Notifications - Maersk (PDF optional)
    // Pattern 1: "maersk TPDoc, sea waybill, shipped on board 263522003"
    // Pattern 2: "draft seaway bill notification"
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /TPDoc.*sea\s?waybill/i,
        /sea\s?waybill.*shipped on board/i,
        /draft sea\s?way\s?bill/i,
      ],
      senderPatterns: [/maersk\.com/i],
      requiresPdf: false,
      priority: 81,
      notes: 'Sea waybill notification (PDF may follow separately).',
    },
    // Last Free Day Notification (demurrage/detention deadline)
    // Pattern: "Maersk Last Free Day Notification"
    {
      documentType: 'cutoff_advisory',
      subjectPatterns: [
        /Maersk Last Free Day Notification/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 71,
      notes: 'Last free day for container pickup - demurrage deadline.',
    },
    // Post-Arrival Exception Report
    // Pattern: "Post-Arrival Maersk Exception Report"
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /Post-Arrival Maersk Exception Report/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 89,
      notes: 'Post-arrival exception notification.',
    },
    // VGM Confirmation
    {
      documentType: 'vgm_confirmation',
      subjectPatterns: [
        /VGM.*confirm/i,
        /VGM.*received/i,
        /Verified Gross Mass/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 75,
    },
    // Booking Cancellation
    // Pattern: "Booking Cancellation : 263625133"
    {
      documentType: 'booking_cancellation',
      subjectPatterns: [
        /^Booking Cancellation\s*:\s*\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 94,
      notes: 'Booking cancelled notification.',
    },
    // Cutoff Advisory
    // Pattern: "Maersk Customer Advisory Revised Cut Off"
    {
      documentType: 'cutoff_advisory',
      subjectPatterns: [
        /Maersk Customer Advisory.*Cut Off/i,
        /Your Transport Plan has Changed/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 70,
      notes: 'Cutoff/schedule change advisory.',
    },
    // Pickup Notification
    // Pattern: "CA - Maersk Line Pickup Number"
    {
      documentType: 'pickup_notification',
      subjectPatterns: [
        /Maersk.*Pickup Number/i,
        /Container Off-Rail Location Update/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 65,
      notes: 'Container pickup notification.',
    },
    // Shipment Notice (FMC Filing)
    // Pattern: "Shipment Number 262707011-FMC Filing reference Number"
    {
      documentType: 'shipment_notice',
      subjectPatterns: [
        /^Shipment Number\s+\d+-FMC Filing/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 60,
      notes: 'FMC filing notification.',
    },
    // SI Amendment Submitted
    // Pattern: "Amendment submitted 263022847-26Dec2025 15:54:30 UTC"
    {
      documentType: 'booking_amendment',
      subjectPatterns: [
        /^Amendment submitted\s+\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 88,
      notes: 'SI amendment confirmation from Maersk.',
    },
    // Daily Container Summary
    // Pattern: "Daily summary of Containers Gated-In"
    {
      documentType: 'shipment_notice',
      subjectPatterns: [
        /^Daily summary of Containers/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 55,
      notes: 'Daily operational summary.',
    },
    // Container Off-Rail Notification
    // Pattern: "Maersk Container Off-Rail Notification"
    {
      documentType: 'shipment_notice',
      subjectPatterns: [
        /Maersk Container Off-Rail/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 56,
      notes: 'Container rail operations notification.',
    },
  ],
};

// ============================================================================
// HAPAG-LLOYD PATTERNS
// ============================================================================

export const HAPAG_LLOYD_CONFIG: CarrierConfig = {
  carrierId: 'hapag-lloyd',
  carrierName: 'Hapag-Lloyd',
  senderDomains: ['hapag-lloyd.com', 'hlag.com', 'service.hlag.com', 'hlag.cloud'],
  patterns: [
    // Booking Confirmation - HL-XXXXXXX format with customer/port
    // Pattern: "HL-22970937 USNYC NORTHP" or "HL-21635244 USORF HIGHW"
    // REQUIRES: PDF with "BOOKING CONFIRMATION" heading OR "BC" in filename
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [
        /^HL-\d+\s+[A-Z]{5}\s+[A-Z]/i,  // HL-22970937 USNYC NORTHP
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      requiresPdf: false,
      attachmentPatterns: [/^HL-\d+.*BC.*\.PDF$/i],  // HL-22970937 USSAV RESILIENT BC 3RD UPDATE.PDF
      attachmentContentPatterns: [
        /BOOKING CONFIRMATION/i,  // Must have this heading in PDF
      ],
      priority: 100,
      notes: 'BC must have "BOOKING CONFIRMATION" heading in PDF.',
    },
    // Booking Amendment/Update
    // Pattern: "[Update] Booking 22970937 [isQQSpot=YES] - Change Empty Pick-up"
    {
      documentType: 'booking_amendment',
      subjectPatterns: [
        /^\[Update\]\s+Booking\s+\d+/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 95,
      notes: 'Booking update notification (change of pickup date, etc).',
    },
    // Shipping Instruction
    // Pattern: "Shipping Instruction Submitted Sh#19207547"
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [
        /^Shipping Instruction Submitted\s*Sh#\d+/i,  // No space before Sh#
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 90,
      notes: 'SI submitted confirmation.',
    },
    // Bill of Lading - Multiple formats
    // Pattern 1: "BL HLCL Sh#19207547 Doc#HLCUDE1251233590"
    // Pattern 2: "HLCL Sh# 28505550 Doc# HLCUDE1251114189" (with PDF ANMA0101_*.pdf)
    // Pattern 3: "SW HLCL Sh#21822663 Doc#HLCUBO12512BAXW7" (Seaway Bill)
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^BL HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+/i,
        /^HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+/i,
        /^SW HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+/i,  // Seaway Bill
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      requiresPdf: false,  // Not all BL emails have PDF
      attachmentPatterns: [/^ANMA\d+_\d+\.pdf$/i],  // ANMA0101_960787589.pdf
      priority: 85,
      notes: 'BL or Seaway Bill with document reference.',
    },
    // Invoice
    // Pattern: "2078405937 INTOGO 001 HLCUDE1251208192"
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^\d+\s+INTOG[LO]\s+001\s+HL[A-Z0-9]+/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      attachmentPatterns: [/^INVP\d+\.pdf$/i],
      priority: 80,
      notes: 'Hapag invoice format.',
    },
    // VGM Confirmation/Acceptance
    // Pattern: "VGM ACC BMOU5630848 94075162"
    {
      documentType: 'vgm_confirmation',
      subjectPatterns: [
        /^VGM ACC\s+[A-Z]{4}\d+/i,  // VGM ACC BMOU5630848
        /VGM.*confirm/i,
        /VGM.*received/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 75,
    },
    // VGM Reminder
    // Pattern: "93908595 BS EX VGM REMINDER" or "17891102 KYRA - NYK VGM REMINDER"
    {
      documentType: 'vgm_reminder',
      subjectPatterns: [
        /^\d+\s+.*VGM REMINDER/i,
        /BS EX VGM/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 74,
      notes: 'VGM submission reminder.',
    },
    // Arrival Notice - Hapag uses "ALERT - Bill of lading" format
    // Pattern: "ALERT - Bill of lading HLCUBO12509ARSP4 DP 670651 POD USPEF... Estimated date of discharge"
    // Body contains: "container(s) with subject bill of lading are arriving at the final port of discharge"
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^ALERT\s*-\s*Bill of lading.*POD/i,
        /^ALERT\s*-\s*Bill of lading.*discharge/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 91,
      notes: 'Hapag arrival notice format - containers arriving at port of discharge.',
    },
    // Shipping Instruction Notification (different from SI Submitted)
    // Pattern: "Shipping Instruction Notification || Hapag Lloyd 56909569/TOLTEN"
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [
        /^Shipping Instruction Notification\s*\|\|/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 89,
      notes: 'SI notification (different from SI Submitted).',
    },
    // Pickup Notification
    // Pattern: "Hapag Lloyd Container Pick up Notification 29982815/BREMEN EXPRESS"
    {
      documentType: 'pickup_notification',
      subjectPatterns: [
        /Hapag Lloyd Container Pick up Notification/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 65,
      notes: 'Container pickup notification.',
    },
    // Cutoff Advisory
    // Pattern: "Hapag Lloyd Advisory || VESSEL CUT OFF DETAILS"
    {
      documentType: 'cutoff_advisory',
      subjectPatterns: [
        /Hapag Lloyd Advisory\s*\|\|.*CUT OFF/i,
        /Hapag Lloyd Advisory\s*\|\|.*VESSEL/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 70,
      notes: 'Vessel cutoff advisory.',
    },
    // Shipment/BL Status
    // Pattern: "Shipment: 93963751 / BL: HLCUBO12511BHKF1 - HB Filling Missing"
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^Shipment:\s*\d+\s*\/\s*BL:\s*HL[A-Z0-9]+/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 84,
      notes: 'BL status notification.',
    },
  ],
};

// ============================================================================
// CMA CGM PATTERNS
// ============================================================================

export const CMA_CGM_CONFIG: CarrierConfig = {
  carrierId: 'cma-cgm',
  carrierName: 'CMA CGM',
  senderDomains: ['cma-cgm.com', 'apl.com'],
  patterns: [
    // Booking Confirmation
    // Pattern: "CMA CGM - Booking confirmation available – CEI0329370 -  - 0INLLW1MA"
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [
        /^CMA CGM - Booking confirmation available/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],  // Match anywhere in domain
      requiresPdf: true,
      attachmentPatterns: [/^BKGCONF_[A-Z0-9]+\.pdf$/i],  // BKGCONF_CEI0329370.pdf
      attachmentContentPatterns: [
        /BOOKING CONFIRMATION/i,  // Must have this heading in PDF
      ],
      priority: 100,
      notes: 'BC with BKGCONF PDF. PDF must contain "BOOKING CONFIRMATION" heading.',
    },
    // Shipping Instruction
    // Pattern: "CMA CGM - Shipping instruction submitted - AMC2475643"
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [
        /^CMA CGM - Shipping instruction submitted/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 90,
      notes: 'SI submitted confirmation.',
    },
    // Arrival Notice - VERY IMPORTANT
    // Pattern: "CMA CGM - Arrival notice available - AMC2459902"
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^CMA CGM - Arrival notice available/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 95,
      notes: 'Arrival notification - critical for consignee.',
    },
    // Bill of Lading
    // Pattern: "My Customer Service - My Export BL Request - BL CAD0845048"
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^My Customer Service.*BL Request.*BL [A-Z0-9]+/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 85,
      notes: 'BL request/confirmation.',
    },
    // Invoice
    // Pattern 1: "CMA-CGM Freight Invoice"
    // Pattern 2: "CMA CGM - Export Invoice available - INEMHC26113448"
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^CMA-CGM Freight Invoice/i,
        /^CMA CGM - Export Invoice available/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 80,
      notes: 'Freight or export invoice.',
    },
    // Bill of Lading Draft
    // Pattern 1: "Modification requested on draft BL EID0918049"
    // Pattern 2: "B/L Draft: EID0918049 - Booking: EID0918049"
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^Modification requested on draft BL/i,
        /^B\/L Draft:/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 84,
      notes: 'BL draft modification/notification.',
    },
    // VGM Notification
    // Pattern: "VGM declaration Missing"
    {
      documentType: 'vgm_reminder',
      subjectPatterns: [
        /VGM declaration Missing/i,
        /VGM.*Missing/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 74,
      notes: 'VGM declaration missing notification.',
    },
  ],
};

// ============================================================================
// COSCO PATTERNS
// ============================================================================

export const COSCO_CONFIG: CarrierConfig = {
  carrierId: 'cosco',
  carrierName: 'COSCO Shipping',
  senderDomains: ['coscon.com', 'oocl.com'],
  patterns: [
    // Booking Confirmation
    // Pattern: "Cosco Shipping Line Booking Confirmation - COSU6439083630 / Booking Office: MRA"
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [
        /^Cosco Shipping Line Booking Confirmation\s*-\s*COSU\d+/i,
      ],
      senderPatterns: [/coscon\.com/i],  // Match anywhere in domain
      requiresPdf: true,
      attachmentPatterns: [/^\d{10}\.pdf$/i],  // 6439083630.pdf
      attachmentContentPatterns: [
        /BOOKING CONFIRMATION/i,  // Must have this heading in PDF
      ],
      priority: 100,
      notes: 'BC with 10-digit PDF filename. PDF must contain "BOOKING CONFIRMATION" heading.',
    },
    // Shipment Notice (similar to arrival notice)
    // Pattern: "Cosco Shipping Line -Shipment Notice: XIN LOS ANGELES 176 East -Booking: COSU643"
    {
      documentType: 'shipment_notice',
      subjectPatterns: [
        /^Cosco Shipping Line\s*-Shipment Notice:/i,
      ],
      senderPatterns: [/coscon\.com/i],
      requiresPdf: true,
      priority: 95,
      notes: 'Shipment/discharge notification.',
    },
    // Arrival Notice
    // Pattern: "COSCO Arrival Notice with Freight COSU6435548630"
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^COSCO Arrival Notice/i,
      ],
      senderPatterns: [/coscon\.com/i],
      priority: 95,
      notes: 'Arrival notification with freight details.',
    },
    // Bill of Lading - Proforma and Copy
    // Pattern 1: "COSCON - Proforma Bill of Lading for COSU6436834960/Vessel: CMA CGM PHOENIX"
    // Pattern 2: "COSCON - Copy Bill of Lading for COSU6434944110"
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^COSCON\s*-\s*(Proforma |Copy )?Bill of Lading/i,
      ],
      senderPatterns: [/coscon\.com/i],
      requiresPdf: true,
      attachmentPatterns: [/^\d+-\d+\.PDF$/i],  // 6436834960-20251205095515.PDF
      priority: 85,
      notes: 'Proforma or Copy BL.',
    },
    // Invoice
    // Pattern: "PROD_Invoice INTOGLO PRIVATE LIMITED SAP 7085061000 B/L COSU6439083510"
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^PROD_Invoice\s+INTOGLO/i,
      ],
      senderPatterns: [/coscon\.com/i],
      requiresPdf: true,
      attachmentPatterns: [/^IN\d+-\d+-\d+-\d+-[A-Z0-9]+-invoice\.pdf$/i],
      priority: 80,
      notes: 'Invoice with PROD_Invoice prefix.',
    },
    // Shipping Instruction
    // Pattern: "COSCO SHIPPING LINES - 6439083510 - Document Shipping Instruction"
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [
        /^COSCO SHIPPING LINES\s*-\s*\d+\s*-\s*Document Shipping Instruction/i,
      ],
      senderPatterns: [/coscon\.com/i],
      priority: 90,
      notes: 'SI document uploaded notification.',
    },
    // Invoice Verification
    // Pattern: "PROD_VERF INTOGLO PRIVATE LIMITED B/L 6435682540..."
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^PROD_VERF\s+INTOGLO/i,
      ],
      senderPatterns: [/coscon\.com/i],
      priority: 79,
      notes: 'Invoice verification notification.',
    },
  ],
};

// ============================================================================
// MSC PATTERNS
// ============================================================================

export const MSC_CONFIG: CarrierConfig = {
  carrierId: 'msc',
  carrierName: 'MSC',
  senderDomains: ['msc.com'],
  patterns: [
    // Booking Amendment
    // Pattern: "INTOGLO PRIVATE LIMITED / 25-342OTEW / AMM # 11"
    {
      documentType: 'booking_amendment',
      subjectPatterns: [
        /INTOGLO.*\/.*AMM\s*#\s*\d+/i,
      ],
      senderPatterns: [/msc\.com/i],  // Match anywhere in domain
      priority: 95,
      notes: 'Amendment notification (AMM #).',
    },
    // Booking Confirmation (need more samples to confirm pattern)
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [
        /MSC.*Booking Confirm/i,
      ],
      senderPatterns: [/msc\.com/i],
      requiresPdf: true,
      priority: 100,
      notes: 'Standard BC format (needs verification with more samples).',
    },
    // Bill of Lading
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /MSC.*B\/L/i,
        /Bill of Lading.*MSC/i,
      ],
      senderPatterns: [/msc\.com/i],
      priority: 85,
    },
  ],
};

// ============================================================================
// ALL CARRIER CONFIGS
// ============================================================================

export const ALL_CARRIER_CONFIGS: CarrierConfig[] = [
  MAERSK_CONFIG,
  HAPAG_LLOYD_CONFIG,
  CMA_CGM_CONFIG,
  COSCO_CONFIG,
  MSC_CONFIG,
];

// ============================================================================
// CLASSIFICATION FUNCTION
// ============================================================================

export interface ClassificationResult {
  carrierId: string;
  carrierName: string;
  documentType: DocumentType;
  matchedPattern: string;
  confidence: number;
  requiresPdfValidation: boolean;
}

/**
 * Classify an email deterministically based on subject patterns and sender.
 *
 * @param subject Email subject line
 * @param senderEmail Sender email address
 * @param attachmentFilenames Optional list of attachment filenames
 * @returns Classification result or null if not from known carrier
 */
export function classifyEmail(
  subject: string,
  senderEmail: string,
  attachmentFilenames?: string[],
  attachmentContent?: string  // NEW: Extracted text from attachments
): ClassificationResult | null {
  const sender = senderEmail.toLowerCase();

  // Skip RE:/Re:/FW:/Fw: threads - these are correspondence, not original documents
  const isReplyOrForward = /^(RE|Re|FW|Fw|FWD|Fwd):\s*/i.test(subject);

  for (const config of ALL_CARRIER_CONFIGS) {
    // Check if sender matches carrier domain
    const matchesDomain = config.senderDomains.some(d => sender.includes(d));
    if (!matchesDomain) continue;

    // Check patterns in priority order
    const sortedPatterns = [...config.patterns].sort((a, b) => b.priority - a.priority);

    for (const pattern of sortedPatterns) {
      // Check sender patterns
      const matchesSender = pattern.senderPatterns.some(p => p.test(senderEmail));
      if (!matchesSender) continue;

      // Check subject patterns
      for (const subjectPattern of pattern.subjectPatterns) {
        if (subjectPattern.test(subject)) {
          // If this pattern requires PDF and we have attachment info, validate
          let hasPdf = true;
          if (pattern.requiresPdf && attachmentFilenames) {
            hasPdf = attachmentFilenames.some(f => f.toLowerCase().endsWith('.pdf'));
          }

          // If attachment patterns specified, check those too
          let matchesAttachment = true;
          if (pattern.attachmentPatterns && attachmentFilenames) {
            matchesAttachment = attachmentFilenames.some(filename =>
              pattern.attachmentPatterns!.some(ap => ap.test(filename))
            );
          }

          // NEW: If attachment content patterns specified, validate content
          // If patterns are specified, content MUST be present and match
          let matchesContent = true;
          if (pattern.attachmentContentPatterns) {
            if (!attachmentContent || attachmentContent.length < 50) {
              matchesContent = false;  // No content = can't validate = skip
            } else {
              matchesContent = pattern.attachmentContentPatterns.some(cp =>
                cp.test(attachmentContent)
              );
            }
          }

          // For BC types that require PDF, if no PDF present, it's not a valid BC
          if (pattern.requiresPdf && !hasPdf) {
            continue;  // Skip this pattern, try next
          }

          // Skip if content patterns required but don't match
          if (pattern.attachmentContentPatterns && !matchesContent) {
            continue;  // Skip this pattern - attachment doesn't have required heading
          }

          return {
            carrierId: config.carrierId,
            carrierName: config.carrierName,
            documentType: pattern.documentType,
            matchedPattern: subjectPattern.source,
            confidence: pattern.priority,
            requiresPdfValidation: pattern.requiresPdf || false,
          };
        }
      }
    }

    // Sender matches but no pattern matched
    // If it's a reply/forward, mark as correspondence
    if (isReplyOrForward) {
      return {
        carrierId: config.carrierId,
        carrierName: config.carrierName,
        documentType: 'general_correspondence',
        matchedPattern: 'reply_or_forward',
        confidence: 10,
        requiresPdfValidation: false,
      };
    }

    // Unknown document type from known carrier
    return {
      carrierId: config.carrierId,
      carrierName: config.carrierName,
      documentType: 'general_correspondence',
      matchedPattern: 'no_match',
      confidence: 0,
      requiresPdfValidation: false,
    };
  }

  return null; // Not from a known shipping line
}

/**
 * Get carrier config by ID
 */
export function getCarrierConfig(carrierId: string): CarrierConfig | undefined {
  return ALL_CARRIER_CONFIGS.find(c => c.carrierId === carrierId);
}

/**
 * Check if sender is from a known shipping line
 */
export function isShippingLineEmail(senderEmail: string): boolean {
  const sender = senderEmail.toLowerCase();
  return ALL_CARRIER_CONFIGS.some(config =>
    config.senderDomains.some(d => sender.includes(d))
  );
}
