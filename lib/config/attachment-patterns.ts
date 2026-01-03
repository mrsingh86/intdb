/**
 * Attachment Filename Patterns
 *
 * Priority 1 classification signal - strongest indicator of document type.
 * If attachment filename matches, use this classification regardless of subject.
 */

export interface AttachmentPattern {
  pattern: RegExp;
  type: string;
  priority: number;
  notes?: string;
}

export const ATTACHMENT_PATTERNS: AttachmentPattern[] = [
  // ===== SHIPPING INSTRUCTION =====
  { pattern: /^SI[_\-\s]/i, type: 'si_draft', priority: 100 },
  { pattern: /Shipping[_\-\s]?Instruction/i, type: 'si_draft', priority: 99 },

  // ===== INVOICE =====
  { pattern: /^Invoice/i, type: 'invoice', priority: 95 },
  { pattern: /^INV[_\-]/i, type: 'invoice', priority: 95 },
  { pattern: /Freight[_\-\s]?Invoice/i, type: 'invoice', priority: 94 },
  { pattern: /Duty[_\-\s]?Invoice/i, type: 'duty_invoice', priority: 96 },

  // ===== POD =====
  { pattern: /^POD/i, type: 'proof_of_delivery', priority: 100 },
  { pattern: /Proof[_\-\s]?of[_\-\s]?Delivery/i, type: 'proof_of_delivery', priority: 99 },

  // ===== PACKING LIST =====
  { pattern: /Packing[_\-\s]?List/i, type: 'packing_list', priority: 95 },
  { pattern: /^PL[_\-]/i, type: 'packing_list', priority: 94 },

  // ===== COMMERCIAL INVOICE =====
  { pattern: /Commercial[_\-\s]?Invoice/i, type: 'commercial_invoice', priority: 96 },
  { pattern: /^CI[_\-]/i, type: 'commercial_invoice', priority: 95 },

  // ===== BILL OF LADING =====
  { pattern: /^HBL/i, type: 'hbl_draft', priority: 90 },
  { pattern: /^MBL/i, type: 'bill_of_lading', priority: 90 },
  { pattern: /Draft[_\-\s]?BL/i, type: 'hbl_draft', priority: 92 },
  { pattern: /Draft[_\-\s]?HBL/i, type: 'hbl_draft', priority: 93 },
  { pattern: /Bill[_\-\s]?of[_\-\s]?Lading/i, type: 'bill_of_lading', priority: 88 },
  { pattern: /Proforma[_\-\s]?BL/i, type: 'mbl_draft', priority: 91 },

  // ===== BOOKING =====
  { pattern: /^BC[_\-]/i, type: 'booking_confirmation', priority: 90 },
  { pattern: /Booking[_\-\s]?Confirm/i, type: 'booking_confirmation', priority: 89 },

  // ===== ARRIVAL NOTICE =====
  { pattern: /^AN[_\-]/i, type: 'arrival_notice', priority: 90 },
  { pattern: /Arrival[_\-\s]?Notice/i, type: 'arrival_notice', priority: 89 },

  // ===== CUSTOMS - INDIA =====
  { pattern: /Shipping[_\-\s]?Bill/i, type: 'shipping_bill', priority: 95 },
  { pattern: /^SB[_\-]/i, type: 'shipping_bill', priority: 94 },
  { pattern: /LEO/i, type: 'leo_copy', priority: 95 },
  { pattern: /Bill[_\-\s]?of[_\-\s]?Entry/i, type: 'bill_of_entry', priority: 95 },
  { pattern: /^BOE/i, type: 'bill_of_entry', priority: 94 },
  { pattern: /^BE[_\-]/i, type: 'bill_of_entry', priority: 93 },

  // ===== CUSTOMS - US =====
  { pattern: /Entry[_\-\s]?Summary/i, type: 'entry_summary', priority: 95 },
  { pattern: /^7501/i, type: 'entry_summary', priority: 96, notes: 'CBP Form 7501' },
  { pattern: /Draft[_\-\s]?Entry/i, type: 'draft_entry', priority: 94 },
  { pattern: /ISF/i, type: 'isf_filing', priority: 93 },

  // ===== CHECKLIST =====
  { pattern: /Checklist/i, type: 'checklist', priority: 85 },
  { pattern: /Doc[_\-\s]?List/i, type: 'checklist', priority: 84 },

  // ===== CERTIFICATES =====
  { pattern: /^COO/i, type: 'certificate', priority: 90 },
  { pattern: /Certificate[_\-\s]?of[_\-\s]?Origin/i, type: 'certificate', priority: 89 },
  { pattern: /Phyto/i, type: 'certificate', priority: 88 },
  { pattern: /Fumigation/i, type: 'certificate', priority: 88 },
  { pattern: /Certificate/i, type: 'certificate', priority: 80 },

  // ===== DELIVERY ORDER =====
  { pattern: /^DO[_\-]/i, type: 'delivery_order', priority: 90 },
  { pattern: /Delivery[_\-\s]?Order/i, type: 'delivery_order', priority: 89 },
];

/**
 * Match attachment filename against patterns
 * Returns the highest priority match
 */
export function matchAttachmentPattern(
  filename: string
): { type: string; pattern: string } | null {
  let bestMatch: { type: string; pattern: string; priority: number } | null = null;

  for (const { pattern, type, priority } of ATTACHMENT_PATTERNS) {
    if (pattern.test(filename)) {
      if (!bestMatch || priority > bestMatch.priority) {
        bestMatch = { type, pattern: pattern.source, priority };
      }
    }
  }

  return bestMatch ? { type: bestMatch.type, pattern: bestMatch.pattern } : null;
}

/**
 * Match multiple attachment filenames
 * Returns the highest priority match across all files
 */
export function matchAttachmentPatterns(
  filenames: string[]
): { type: string; pattern: string; filename: string } | null {
  let bestMatch: { type: string; pattern: string; filename: string; priority: number } | null = null;

  for (const filename of filenames) {
    for (const { pattern, type, priority } of ATTACHMENT_PATTERNS) {
      if (pattern.test(filename)) {
        if (!bestMatch || priority > bestMatch.priority) {
          bestMatch = { type, pattern: pattern.source, filename, priority };
        }
      }
    }
  }

  return bestMatch ? { type: bestMatch.type, pattern: bestMatch.pattern, filename: bestMatch.filename } : null;
}
