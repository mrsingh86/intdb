/**
 * Shipping Line Classification Patterns V2
 *
 * FIXES from LLM Judge Evaluation:
 * 1. HLCL Sh# Doc# → arrival_notice (was bill_of_lading)
 * 2. Shipment: / BL: - HB Filling → cutoff_advisory (was bill_of_lading)
 * 3. Last Free Day → pickup_notification (was cutoff_advisory)
 * 4. Transport Plan Changed → vessel_schedule (was cutoff_advisory)
 * 5. Container Off-Rail → pickup_notification (was shipment_notice)
 * 6. Hapag-Lloyd Info Mail → Needs body check for MTD/BL
 *
 * NEW DOCUMENT TYPES:
 * - customer_case: Support cases, complaints, inquiries
 * - exception_report: Post-arrival exceptions, delays, issues
 * - vessel_schedule: Transport plan changes, sailing schedules
 * - rate_advisory: Rate changes, surcharge updates
 *
 * STRATEGY:
 * - High confidence patterns (≥85) for known formats → Deterministic
 * - RE:/FW: threads → AI (often contain amendments/actions)
 * - Ambiguous patterns → AI
 * - Non-shipping line → Document Stage AI Classification
 */

export type DocumentType =
  // === BOOKING STAGE ===
  | 'booking_confirmation'
  | 'booking_amendment'
  | 'booking_cancellation'
  | 'rate_quote'

  // === SHIPPING INSTRUCTION STAGE ===
  | 'shipping_instruction'
  | 'si_draft'                // SI draft from shipper
  | 'bl_instruction'          // BL instruction from shipper to FF
  | 'vgm_confirmation'
  | 'vgm_reminder'
  | 'sob_confirmation'        // Shipped on Board confirmation
  | 'checklist'               // Pre-shipping checklist for approval
  | 'forwarding_note'         // Manual forwarding note
  | 'commercial_invoice'      // CI for customs/shipping
  | 'packing_list'            // PL attached

  // === BILL OF LADING STAGE ===
  | 'bill_of_lading'
  | 'bl_draft'
  | 'bl_released'
  | 'hbl_draft'               // House BL draft
  | 'hbl_released'            // House BL released

  // === ARRIVAL/DELIVERY STAGE ===
  | 'arrival_notice'
  | 'pickup_notification'
  | 'delivery_order'

  // === FINANCIAL ===
  | 'invoice'

  // === CUTOFFS & SCHEDULES ===
  | 'cutoff_advisory'
  | 'vessel_schedule'

  // === CUSTOMS ===
  | 'customs_clearance'
  | 'customs_hold'
  | 'isf_filing'              // ISF filing request/status
  | 'duty_entry'              // Customs duty entry summary
  | 'customs_document'        // General customs document

  // === OPERATIONAL ===
  | 'shipment_notice'
  | 'exception_report'

  // === SUPPORT ===
  | 'customer_case'
  | 'rate_advisory'

  // === FALLBACK ===
  | 'general_correspondence';

// Document Stage Mapping (for lifecycle tracking)
export const DOCUMENT_STAGE_MAP: Record<DocumentType, string> = {
  // Pre-booking
  'rate_quote': 'pre_booking',
  'rate_advisory': 'pre_booking',

  // Booking
  'booking_confirmation': 'booking',
  'booking_amendment': 'booking',
  'booking_cancellation': 'booking',

  // SI Stage (documentation preparation)
  'shipping_instruction': 'shipping_instruction',
  'si_draft': 'shipping_instruction',
  'bl_instruction': 'shipping_instruction',
  'vgm_confirmation': 'shipping_instruction',
  'vgm_reminder': 'shipping_instruction',
  'sob_confirmation': 'shipping_instruction',
  'checklist': 'shipping_instruction',
  'forwarding_note': 'shipping_instruction',
  'commercial_invoice': 'shipping_instruction',
  'packing_list': 'shipping_instruction',

  // BL Stage
  'bill_of_lading': 'bill_of_lading',
  'bl_draft': 'bill_of_lading',
  'bl_released': 'bill_of_lading',
  'hbl_draft': 'bill_of_lading',
  'hbl_released': 'bill_of_lading',

  // Cutoff/Schedule (applies to booking/SI stage)
  'cutoff_advisory': 'shipping_instruction',
  'vessel_schedule': 'booking',

  // In Transit
  'shipment_notice': 'in_transit',
  'exception_report': 'in_transit',

  // Arrival/Delivery
  'arrival_notice': 'arrival',
  'pickup_notification': 'delivery',
  'delivery_order': 'delivery',

  // Customs
  'customs_clearance': 'customs',
  'customs_hold': 'customs',
  'isf_filing': 'customs',
  'duty_entry': 'customs',
  'customs_document': 'customs',

  // Financial (can be any stage)
  'invoice': 'financial',

  // Support
  'customer_case': 'support',
  'general_correspondence': 'support',
};

export interface CarrierPattern {
  documentType: DocumentType;
  subjectPatterns: RegExp[];
  senderPatterns: RegExp[];
  bodyPatterns?: RegExp[];  // NEW: Check body for confirmation
  requiresPdf?: boolean;
  attachmentPatterns?: RegExp[];
  priority: number;
  useAI?: boolean;  // NEW: Force AI for this pattern
  notes?: string;
}

export interface CarrierConfig {
  carrierId: string;
  carrierName: string;
  senderDomains: string[];
  patterns: CarrierPattern[];
}

// ============================================================================
// MAERSK PATTERNS (FIXED)
// ============================================================================

export const MAERSK_CONFIG: CarrierConfig = {
  carrierId: 'maersk',
  carrierName: 'Maersk Line',
  senderDomains: ['maersk.com', 'sealand.com'],
  patterns: [
    // ========== EXCLUSIONS (110) - NOT booking confirmations ==========

    // FMC Filing - NOT a booking confirmation
    {
      documentType: 'shipment_notice',
      subjectPatterns: [
        /Shipment Number\s*\d+-FMC Filing/i,
        /FMC Filing reference/i,
      ],
      senderPatterns: [/maersk\.com/i, /.*/i],
      priority: 110,
      notes: 'FMC regulatory filing - NOT a booking confirmation.',
    },

    // Price Overview - Rate quote, NOT a booking confirmation
    {
      documentType: 'rate_quote',
      subjectPatterns: [
        /^Price overview\s*-\s*booking confirmation/i,
        /^Price overview\s*:/i,
      ],
      senderPatterns: [/maersk\.com/i, /.*/i],
      priority: 110,
      notes: 'Price/rate overview - NOT a booking confirmation.',
    },

    // SOB Confirmation - Shipped on Board, NOT booking confirmation
    {
      documentType: 'sob_confirmation',
      subjectPatterns: [
        /SOB CONFIRMATION/i,
        /Shipped on Board.*Confirmation/i,
      ],
      senderPatterns: [/maersk\.com/i, /hlag\.com/i, /.*/i],
      priority: 110,
      notes: 'Shipped on Board confirmation - cargo already loaded.',
    },

    // Railment Confirmation - NOT a booking confirmation
    {
      documentType: 'shipment_notice',
      subjectPatterns: [
        /RAILMENT CONFIRMATION/i,
      ],
      senderPatterns: [/.*/i],
      priority: 110,
      notes: 'Rail movement confirmation - NOT a booking.',
    },

    // ========== HIGH CONFIDENCE (100) - Deterministic ==========

    // Booking Confirmation - MUST have PDF
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [
        /^Booking Confirmation\s*:\s*\d+/i,
        /^Booking Confirmation\s*-\s*MAEU\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      requiresPdf: true,
      priority: 100,
      notes: 'Primary BC format with booking number.',
    },

    // Booking Amendment - Explicit format
    {
      documentType: 'booking_amendment',
      subjectPatterns: [
        /^Booking Amendment\s*:\s*\d+/i,
        /^Amendment submitted\s+\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 100,
      notes: 'Booking changes/amendments.',
    },

    // Booking Cancellation
    {
      documentType: 'booking_cancellation',
      subjectPatterns: [/^Booking Cancellation\s*:\s*\d+/i],
      senderPatterns: [/maersk\.com/i],
      priority: 100,
    },

    // Arrival Notice - Explicit
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^Arrival notice\s+\d+/i,
        /^Arrival Notice\s*:/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 100,
    },

    // Invoice - Explicit
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^New invoice\s+[A-Z0-9]+\s*\(BL\s+\d+\)/i,
        /^New invoice\s+[A-Z]{2}\d{2}IN\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 100,
    },

    // SI Submitted
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [/^SI submitted\s+\d+/i],
      senderPatterns: [/maersk\.com/i],
      priority: 100,
    },

    // BL Draft - Sea Waybill verification
    {
      documentType: 'bl_draft',
      subjectPatterns: [
        /TPDoc.*sea\s?waybill.*shipped on board/i,
        /draft sea\s?way\s?bill/i,
      ],
      senderPatterns: [/maersk\.com/i],
      bodyPatterns: [/verif/i],  // If mentions verification, it's a draft
      priority: 98,
      notes: 'FIXED: Sea waybill verification = draft.',
    },

    // Bill of Lading - Final Sea Waybill (no verification)
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /TPDoc.*sea\s?waybill.*shipped on board/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 95,
    },

    // ========== FIXED PATTERNS ==========

    // FIXED: Last Free Day → pickup_notification (was cutoff_advisory)
    {
      documentType: 'pickup_notification',
      subjectPatterns: [/Maersk Last Free Day Notification/i],
      senderPatterns: [/maersk\.com/i],
      priority: 95,
      notes: 'FIXED: Container pickup deadline, not cutoff.',
    },

    // FIXED: Transport Plan Changed → vessel_schedule (was cutoff_advisory)
    {
      documentType: 'vessel_schedule',
      subjectPatterns: [/Your Transport Plan has Changed/i],
      senderPatterns: [/maersk\.com/i],
      priority: 95,
      notes: 'FIXED: Vessel schedule change, not cutoff.',
    },

    // FIXED: Container Off-Rail → pickup_notification (was shipment_notice)
    {
      documentType: 'pickup_notification',
      subjectPatterns: [
        /Maersk Container Off-Rail Notification/i,
        /Container Off-Rail Location Update/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 95,
      notes: 'FIXED: Container ready for pickup.',
    },

    // Cutoff Advisory - Explicit "Cut Off" in subject
    {
      documentType: 'cutoff_advisory',
      subjectPatterns: [/Maersk Customer Advisory.*Cut Off/i],
      senderPatterns: [/maersk\.com/i],
      priority: 90,
    },

    // Exception Report
    {
      documentType: 'exception_report',
      subjectPatterns: [/Post-Arrival Maersk Exception Report/i],
      senderPatterns: [/maersk\.com/i],
      priority: 90,
    },

    // Pickup Number
    {
      documentType: 'pickup_notification',
      subjectPatterns: [/Maersk.*Pickup Number/i],
      senderPatterns: [/maersk\.com/i],
      priority: 90,
    },

    // Shipment Notice - FMC Filing
    {
      documentType: 'shipment_notice',
      subjectPatterns: [/^Shipment Number\s+\d+-FMC Filing/i],
      senderPatterns: [/maersk\.com/i],
      priority: 85,
    },

    // Daily Container Summary
    {
      documentType: 'shipment_notice',
      subjectPatterns: [/^Daily summary of Containers/i],
      senderPatterns: [/maersk\.com/i],
      priority: 80,
    },

    // ========== USE AI FOR THESE ==========

    // Customer Case - Use AI to determine actual content
    {
      documentType: 'customer_case',
      subjectPatterns: [
        /^Your Case Number\s*:/i,
        /Case Number\s*:\s*\d+-\d+/i,
      ],
      senderPatterns: [/maersk\.com/i],
      priority: 50,
      useAI: true,
      notes: 'Case emails often contain amendments/actions - use AI.',
    },

    // Price Overview - NOT a booking confirmation (no PDF)
    {
      documentType: 'rate_quote',
      subjectPatterns: [/Price overview.*booking confirmation/i],
      senderPatterns: [/maersk\.com/i],
      priority: 85,
      notes: 'Price overview emails, not actual BC.',
    },
  ],
};

// ============================================================================
// HAPAG-LLOYD PATTERNS (FIXED)
// ============================================================================

export const HAPAG_LLOYD_CONFIG: CarrierConfig = {
  carrierId: 'hapag-lloyd',
  carrierName: 'Hapag-Lloyd',
  senderDomains: ['hapag-lloyd.com', 'hlag.com', 'service.hlag.com', 'hlag.cloud'],
  patterns: [
    // ========== HIGH CONFIDENCE - Deterministic ==========

    // Invoice - Very specific format
    {
      documentType: 'invoice',
      subjectPatterns: [/^\d+\s+INTOG[LO]\s+001\s+HL[A-Z0-9]+/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // Booking Amendment - [Update] format
    {
      documentType: 'booking_amendment',
      subjectPatterns: [/^\[Update\]\s+Booking\s+\d+/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // SI Submitted
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [
        /^Shipping Instruction Submitted\s*Sh#\d+/i,
        /^Shipping Instruction Notification\s*\|\|/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // BL Draft - SW HLCL Sh# format (FIXED: These are drafts!)
    {
      documentType: 'bl_draft',
      subjectPatterns: [
        /^SW HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+/i,  // Sea Waybill Draft
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      bodyPatterns: [/DRAFT/i, /draft/i],  // Look for DRAFT in body
      priority: 100,
      notes: 'FIXED: SW HLCL format are drafts, not final BL.',
    },

    // Final BL with explicit "BL" prefix
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^BL HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // VGM
    {
      documentType: 'vgm_confirmation',
      subjectPatterns: [/^VGM ACC\s+[A-Z]{4}\d+/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    {
      documentType: 'vgm_reminder',
      subjectPatterns: [/^\d+\s+.*VGM REMINDER/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // Arrival Notice - ALERT format
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^ALERT\s*-\s*Bill of lading.*POD/i,
        /^ALERT\s*-\s*Bill of lading.*discharge/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // Pickup Notification
    {
      documentType: 'pickup_notification',
      subjectPatterns: [/Hapag Lloyd Container Pick up Notification/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 100,
    },

    // Cutoff Advisory
    {
      documentType: 'cutoff_advisory',
      subjectPatterns: [
        /Hapag Lloyd Advisory\s*\|\|.*CUT OFF/i,
        /Hapag Lloyd Advisory\s*\|\|.*VESSEL/i,
      ],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 95,
    },

    // ========== FIXED PATTERNS ==========

    // FIXED: HLCL Sh# Doc# (without BL prefix) → arrival_notice
    {
      documentType: 'arrival_notice',
      subjectPatterns: [/^HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      bodyPatterns: [/ARRIVAL ACKNOWLEDGEMENT/i, /arriving at the final port/i],
      priority: 95,
      notes: 'FIXED: These are arrival notices, not BL.',
    },

    // FIXED: Shipment: / BL: - HB Filling → cutoff_advisory
    {
      documentType: 'cutoff_advisory',
      subjectPatterns: [/^Shipment:\s*\d+\s*\/\s*BL:\s*HL[A-Z0-9]+.*HB Fil/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 95,
      notes: 'FIXED: AMS filing cutoff, not BL.',
    },

    // ========== USE AI FOR THESE ==========

    // Booking Confirmation - HL-XXXXXXX format needs AI verification
    // (Some are BC, some are UPDATE emails)
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [/^HL-\d+\s+[A-Z]{5}\s+[A-Z]/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 80,
      useAI: true,
      notes: 'Needs AI: Some are BC, some are UPDATE/Amendment.',
    },

    // Info Mail - Needs AI to determine type
    {
      documentType: 'general_correspondence',
      subjectPatterns: [/^Hapag-Lloyd Info Mail/i],
      senderPatterns: [/hlag\.(com|cloud)/i, /hapag-lloyd\.com/i],
      priority: 50,
      useAI: true,
      notes: 'Needs AI: Could be BL, Advisory, or general.',
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
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [/^CMA CGM - Booking confirmation available/i],
      senderPatterns: [/cma-cgm\.com/i],
      requiresPdf: true,
      priority: 100,
    },

    // SI Submitted
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [/^CMA CGM - Shipping instruction submitted/i],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 100,
    },

    // Arrival Notice
    {
      documentType: 'arrival_notice',
      subjectPatterns: [/^CMA CGM - Arrival notice available/i],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 100,
    },

    // BL Request
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [
        /^My Customer Service.*BL Request.*BL [A-Z0-9]+/i,
        /^B\/L Draft:/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 95,
    },

    // Invoice
    {
      documentType: 'invoice',
      subjectPatterns: [
        /^CMA-CGM Freight Invoice/i,
        /^CMA CGM - Export Invoice available/i,
      ],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 100,
    },

    // VGM Reminder
    {
      documentType: 'vgm_reminder',
      subjectPatterns: [/VGM declaration Missing/i],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 95,
    },

    // FIXED: Modification requested → booking_amendment (not BL)
    {
      documentType: 'booking_amendment',
      subjectPatterns: [/^Modification requested on draft BL/i],
      senderPatterns: [/cma-cgm\.com/i],
      priority: 95,
      notes: 'FIXED: Amendment request, not BL document.',
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
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [/^Cosco Shipping Line Booking Confirmation\s*-\s*COSU\d+/i],
      senderPatterns: [/coscon\.com/i],
      requiresPdf: true,
      priority: 100,
    },

    // Shipment Notice
    {
      documentType: 'shipment_notice',
      subjectPatterns: [/^Cosco Shipping Line\s*-Shipment Notice:/i],
      senderPatterns: [/coscon\.com/i],
      priority: 100,
    },

    // Arrival Notice
    {
      documentType: 'arrival_notice',
      subjectPatterns: [
        /^COSCO Arrival Notice/i,
        /^OOCL Arrival Notice/i,
      ],
      senderPatterns: [/coscon\.com/i, /oocl\.com/i],
      priority: 100,
    },

    // Bill of Lading
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [/^COSCON\s*-\s*(Proforma |Copy )?Bill of Lading/i],
      senderPatterns: [/coscon\.com/i],
      priority: 100,
    },

    // Invoice
    {
      documentType: 'invoice',
      subjectPatterns: [/^PROD_Invoice\s+INTOGLO/i],
      senderPatterns: [/coscon\.com/i],
      priority: 100,
    },

    // SI
    {
      documentType: 'shipping_instruction',
      subjectPatterns: [/^COSCO SHIPPING LINES\s*-\s*\d+\s*-\s*Document Shipping Instruction/i],
      senderPatterns: [/coscon\.com/i],
      priority: 100,
    },

    // FIXED: PROD_VERF → bill_of_lading (not invoice)
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [/^PROD_VERF\s+INTOGLO.*B\/L/i],
      senderPatterns: [/coscon\.com/i],
      priority: 95,
      notes: 'FIXED: BL verification, not invoice.',
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
    // Booking Amendment - Use AI (some are invoices)
    {
      documentType: 'booking_amendment',
      subjectPatterns: [/INTOGLO.*\/.*AMM\s*#\s*\d+/i],
      senderPatterns: [/msc\.com/i],
      priority: 80,
      useAI: true,
      notes: 'Needs AI: Some AMM emails are invoices.',
    },

    // Booking Confirmation
    {
      documentType: 'booking_confirmation',
      subjectPatterns: [/MSC.*Booking Confirm/i],
      senderPatterns: [/msc\.com/i],
      requiresPdf: true,
      priority: 95,
    },

    // Bill of Lading
    {
      documentType: 'bill_of_lading',
      subjectPatterns: [/MSC.*B\/L/i, /Bill of Lading.*MSC/i],
      senderPatterns: [/msc\.com/i],
      priority: 95,
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
// CLASSIFICATION RESULT
// ============================================================================

export interface ClassificationResult {
  carrierId: string;
  carrierName: string;
  documentType: DocumentType;
  documentStage: string;
  matchedPattern: string;
  confidence: number;
  requiresPdfValidation: boolean;
  useAI: boolean;
  notes?: string;
}

// ============================================================================
// CLASSIFICATION FUNCTION (V2)
// ============================================================================

export function classifyEmailV2(
  subject: string,
  senderEmail: string,
  attachmentFilenames?: string[],
  bodyText?: string
): ClassificationResult | null {
  const sender = senderEmail.toLowerCase();

  // Check for RE:/FW: - Always recommend AI
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
          // Check body patterns if required
          if (pattern.bodyPatterns && bodyText) {
            const matchesBody = pattern.bodyPatterns.some(p => p.test(bodyText));
            if (!matchesBody) continue;
          }

          // PDF validation
          let hasPdf = true;
          if (pattern.requiresPdf && attachmentFilenames) {
            hasPdf = attachmentFilenames.some(f => f.toLowerCase().endsWith('.pdf'));
            if (!hasPdf) continue;
          }

          // If it's a reply/forward, force AI classification
          const shouldUseAI = isReplyOrForward || pattern.useAI || pattern.priority < 80;

          return {
            carrierId: config.carrierId,
            carrierName: config.carrierName,
            documentType: pattern.documentType,
            documentStage: DOCUMENT_STAGE_MAP[pattern.documentType],
            matchedPattern: subjectPattern.source,
            confidence: shouldUseAI ? 50 : pattern.priority,
            requiresPdfValidation: pattern.requiresPdf || false,
            useAI: shouldUseAI,
            notes: pattern.notes,
          };
        }
      }
    }

    // Sender matches but no pattern matched
    if (isReplyOrForward) {
      return {
        carrierId: config.carrierId,
        carrierName: config.carrierName,
        documentType: 'general_correspondence',
        documentStage: 'support',
        matchedPattern: 'reply_or_forward',
        confidence: 10,
        requiresPdfValidation: false,
        useAI: true,  // Always use AI for RE:/FW:
        notes: 'Reply/Forward - use AI to determine actual content.',
      };
    }

    // Unknown pattern from known carrier
    return {
      carrierId: config.carrierId,
      carrierName: config.carrierName,
      documentType: 'general_correspondence',
      documentStage: 'support',
      matchedPattern: 'no_match',
      confidence: 0,
      requiresPdfValidation: false,
      useAI: true,
      notes: 'Unknown pattern - use AI.',
    };
  }

  return null; // Not from a known shipping line
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getCarrierConfig(carrierId: string): CarrierConfig | undefined {
  return ALL_CARRIER_CONFIGS.find(c => c.carrierId === carrierId);
}

export function isShippingLineEmail(senderEmail: string): boolean {
  const sender = senderEmail.toLowerCase();
  return ALL_CARRIER_CONFIGS.some(config =>
    config.senderDomains.some(d => sender.includes(d))
  );
}

export function getDocumentStage(documentType: DocumentType): string {
  return DOCUMENT_STAGE_MAP[documentType] || 'unknown';
}
