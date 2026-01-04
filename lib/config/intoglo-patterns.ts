/**
 * Intoglo Outbound Patterns
 *
 * Classification patterns for OUTBOUND emails sent by Intoglo team.
 * These are emails from @intoglo.com or @intoglo.in with ops group in CC.
 *
 * Document types mapped to workflow states via outbound direction.
 */

export interface IntogloPattern {
  pattern: RegExp;
  type: string;
  priority: number;
  category: 'booking' | 'shipping' | 'customs' | 'delivery' | 'communication';
  notes?: string;
}

// ===== BOOKING STAGE PATTERNS =====
export const BOOKING_PATTERNS: IntogloPattern[] = [
  // Booking Confirmation Share
  { pattern: /Booking\s*Confirm/i, type: 'booking_confirmation', priority: 90, category: 'booking' },
  { pattern: /BC\s*-?\s*#?\d+/i, type: 'booking_confirmation', priority: 88, category: 'booking' },
  { pattern: /Fwd:?\s*Booking/i, type: 'booking_confirmation', priority: 87, category: 'booking' },
  { pattern: /Booking\s*Details/i, type: 'booking_confirmation', priority: 86, category: 'booking' },
  { pattern: /Booking\s*Amendment/i, type: 'booking_amendment', priority: 89, category: 'booking' },
  { pattern: /Booking\s*Updated/i, type: 'booking_amendment', priority: 88, category: 'booking' },
];

// ===== SI/BL STAGE PATTERNS =====
export const SI_BL_PATTERNS: IntogloPattern[] = [
  // SI Confirmation
  { pattern: /SI\s*Confirm/i, type: 'si_confirmation', priority: 92, category: 'shipping' },
  { pattern: /SI\s*Approved/i, type: 'si_confirmation', priority: 91, category: 'shipping' },
  { pattern: /SI\s*Accepted/i, type: 'si_confirmation', priority: 91, category: 'shipping' },
  { pattern: /Shipping\s*Instruction\s*Confirm/i, type: 'si_confirmation', priority: 90, category: 'shipping' },

  // BL Draft Share
  { pattern: /Draft\s*(HBL|BL|B\/L)/i, type: 'hbl_draft', priority: 93, category: 'shipping' },
  { pattern: /(HBL|BL)\s*Draft/i, type: 'hbl_draft', priority: 92, category: 'shipping' },
  { pattern: /Proforma\s*(HBL|BL)/i, type: 'hbl_draft', priority: 91, category: 'shipping' },
  { pattern: /Draft\s*House\s*Bill/i, type: 'hbl_draft', priority: 91, category: 'shipping' },

  // HBL Release
  { pattern: /HBL\s*Released/i, type: 'hbl_release', priority: 95, category: 'shipping' },
  { pattern: /HBL\s*Attached/i, type: 'hbl_release', priority: 94, category: 'shipping' },
  { pattern: /Final\s*HBL/i, type: 'hbl_release', priority: 94, category: 'shipping' },
  { pattern: /Signed\s*HBL/i, type: 'hbl_release', priority: 94, category: 'shipping' },
  { pattern: /House\s*Bill\s*Released/i, type: 'hbl_release', priority: 93, category: 'shipping' },

  // MBL Draft
  { pattern: /Proforma\s*MBL/i, type: 'mbl_draft', priority: 91, category: 'shipping' },
  { pattern: /Draft\s*MBL/i, type: 'mbl_draft', priority: 91, category: 'shipping' },
  { pattern: /MBL\s*Draft/i, type: 'mbl_draft', priority: 90, category: 'shipping' },
];

// ===== ARRIVAL & CUSTOMS PATTERNS =====
export const ARRIVAL_CUSTOMS_PATTERNS: IntogloPattern[] = [
  // Arrival Notice Share - STRICT: Only explicit "Arrival Notice" text
  { pattern: /Arrival\s*Notice/i, type: 'arrival_notice', priority: 88, category: 'delivery' },
  // REMOVED: Pre-?Alert - This is customs broker clearance initiation, NOT arrival notice
  // REMOVED: Vessel\s*ETA - Too broad, matches status updates

  // Duty Summary
  { pattern: /Duty\s*Summary/i, type: 'duty_summary', priority: 90, category: 'customs' },
  { pattern: /Duty\s*Invoice\s*(attached|shared)/i, type: 'duty_summary', priority: 89, category: 'customs' },
  { pattern: /Customs\s*Duty\s*Details/i, type: 'duty_summary', priority: 88, category: 'customs' },

  // Customs Status Update
  { pattern: /Customs\s*Cleared/i, type: 'customs_clearance', priority: 92, category: 'customs' },
  { pattern: /Clearance\s*Done/i, type: 'customs_clearance', priority: 91, category: 'customs' },
  { pattern: /Out\s*of\s*Charge/i, type: 'customs_clearance', priority: 93, category: 'customs' },
  { pattern: /\bOOC\b/i, type: 'customs_clearance', priority: 93, category: 'customs' },
];

// ===== INVOICE PATTERNS =====
export const INVOICE_PATTERNS: IntogloPattern[] = [
  // Freight Invoice
  { pattern: /Freight\s*Invoice/i, type: 'freight_invoice', priority: 90, category: 'communication' },
  { pattern: /Invoice\s*#?\d+/i, type: 'freight_invoice', priority: 85, category: 'communication' },
  { pattern: /Invoice\s*Attached/i, type: 'freight_invoice', priority: 86, category: 'communication' },
  { pattern: /PFA\s*(the\s*)?Invoice/i, type: 'freight_invoice', priority: 87, category: 'communication' },
];

// ===== CUSTOMS DOCUMENT SHARING PATTERNS =====
export const CUSTOMS_SHARE_PATTERNS: IntogloPattern[] = [
  // Checklist Shared
  { pattern: /Checklist/i, type: 'checklist', priority: 85, category: 'customs' },
  { pattern: /Doc(ument)?\s*List/i, type: 'checklist', priority: 84, category: 'customs' },

  // Draft Entry Shared
  { pattern: /Draft\s*Entry/i, type: 'draft_entry', priority: 90, category: 'customs' },
  { pattern: /Entry\s*Draft/i, type: 'draft_entry', priority: 90, category: 'customs' },
  { pattern: /Entry\s*for\s*(your\s*)?(review|approval)/i, type: 'draft_entry', priority: 89, category: 'customs' },

  // Entry Summary Shared
  { pattern: /Entry\s*Summary/i, type: 'entry_summary', priority: 90, category: 'customs' },
  { pattern: /7501/i, type: 'entry_summary', priority: 91, category: 'customs' },
];

// ===== COMMUNICATION PATTERNS =====
export const COMMUNICATION_PATTERNS: IntogloPattern[] = [
  // Status Update
  { pattern: /Shipment\s*Status/i, type: 'status_update', priority: 80, category: 'communication' },
  { pattern: /Status\s*Update/i, type: 'status_update', priority: 79, category: 'communication' },
  { pattern: /Tracking\s*Update/i, type: 'status_update', priority: 79, category: 'communication' },

  // Follow-up
  { pattern: /Following\s*Up/i, type: 'followup', priority: 75, category: 'communication' },
  { pattern: /Please\s*Confirm/i, type: 'followup', priority: 74, category: 'communication' },
  { pattern: /Kindly\s*Confirm/i, type: 'followup', priority: 74, category: 'communication' },
];

// ===== COMBINED PATTERNS =====
export const ALL_INTOGLO_PATTERNS: IntogloPattern[] = [
  ...BOOKING_PATTERNS,
  ...SI_BL_PATTERNS,
  ...ARRIVAL_CUSTOMS_PATTERNS,
  ...INVOICE_PATTERNS,
  ...CUSTOMS_SHARE_PATTERNS,
  ...COMMUNICATION_PATTERNS,
];

/**
 * Match subject against Intoglo outbound patterns
 * Returns the highest priority match
 */
export function matchIntogloPattern(
  subject: string
): { type: string; pattern: string; category: string } | null {
  let bestMatch: { type: string; pattern: string; category: string; priority: number } | null = null;

  for (const { pattern, type, priority, category } of ALL_INTOGLO_PATTERNS) {
    if (pattern.test(subject)) {
      if (!bestMatch || priority > bestMatch.priority) {
        bestMatch = { type, pattern: pattern.source, category, priority };
      }
    }
  }

  return bestMatch ? { type: bestMatch.type, pattern: bestMatch.pattern, category: bestMatch.category } : null;
}
