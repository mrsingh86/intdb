/**
 * Body Content Indicators
 *
 * Priority 2 classification signal.
 * Matches phrases in email body that indicate document type.
 * Used when attachment filename doesn't provide classification.
 */

export interface BodyIndicator {
  pattern: RegExp;
  type: string;
  priority: number;
  notes?: string;
}

export const BODY_INDICATORS: BodyIndicator[] = [
  // ===== SHIPPING INSTRUCTION =====
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?SI\b/i, type: 'si_draft', priority: 90 },
  { pattern: /PFA\s*(the\s*)?SI\b/i, type: 'si_draft', priority: 90 },
  { pattern: /attached\s*(is\s*)?(the\s*)?shipping\s*instruction/i, type: 'si_draft', priority: 89 },
  { pattern: /kindly\s*find\s*(the\s*)?SI\b/i, type: 'si_draft', priority: 88 },

  // ===== INVOICE =====
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?invoice/i, type: 'invoice', priority: 88 },
  { pattern: /PFA\s*(the\s*)?invoice/i, type: 'invoice', priority: 88 },
  { pattern: /attached\s*(is\s*)?(the\s*)?invoice/i, type: 'invoice', priority: 87 },
  { pattern: /kindly\s*find\s*duty\s*invoice/i, type: 'duty_invoice', priority: 90 },
  { pattern: /PFA\s*(the\s*)?duty\s*invoice/i, type: 'duty_invoice', priority: 90 },

  // ===== POD =====
  { pattern: /PFA\s*(the\s*)?POD\b/i, type: 'proof_of_delivery', priority: 92 },
  { pattern: /POD\s*(is\s*)?attached/i, type: 'proof_of_delivery', priority: 92 },
  { pattern: /attached\s*(is\s*)?(the\s*)?proof\s*of\s*delivery/i, type: 'proof_of_delivery', priority: 91 },
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?POD\b/i, type: 'proof_of_delivery', priority: 91 },

  // ===== DELIVERY CONFIRMATION =====
  { pattern: /delivery\s*(has\s*been\s*)?completed/i, type: 'delivery_confirmation', priority: 88 },
  { pattern: /successfully\s*delivered/i, type: 'delivery_confirmation', priority: 88 },
  { pattern: /cargo\s*(has\s*been\s*)?delivered/i, type: 'delivery_confirmation', priority: 87 },

  // ===== PACKING LIST =====
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?packing\s*list/i, type: 'packing_list', priority: 88 },
  { pattern: /PFA\s*(the\s*)?(PL\b|packing\s*list)/i, type: 'packing_list', priority: 88 },
  { pattern: /attached\s*(is\s*)?(the\s*)?packing\s*list/i, type: 'packing_list', priority: 87 },

  // ===== COMMERCIAL INVOICE =====
  { pattern: /attached\s*(is\s*)?(the\s*)?commercial\s*invoice/i, type: 'commercial_invoice', priority: 89 },
  { pattern: /PFA\s*(the\s*)?CI\b/i, type: 'commercial_invoice', priority: 89 },
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?commercial\s*invoice/i, type: 'commercial_invoice', priority: 88 },

  // ===== HBL DRAFT =====
  { pattern: /please\s*(find|review)\s*(the\s*)?draft\s*(HBL|BL|B\/L)/i, type: 'hbl_draft', priority: 90 },
  { pattern: /(HBL|BL)\s*draft\s*(for\s*)?(your\s*)?(review|approval)/i, type: 'hbl_draft', priority: 90 },
  { pattern: /attached\s*(is\s*)?(the\s*)?draft\s*(HBL|house\s*b\/l)/i, type: 'hbl_draft', priority: 89 },
  { pattern: /PFA\s*(the\s*)?draft\s*(HBL|BL)/i, type: 'hbl_draft', priority: 89 },

  // ===== CUSTOMS - INDIA =====
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?shipping\s*bill/i, type: 'shipping_bill', priority: 90 },
  { pattern: /PFA\s*(the\s*)?SB\b/i, type: 'shipping_bill', priority: 90 },
  { pattern: /shipping\s*bill\s*(is\s*)?attached/i, type: 'shipping_bill', priority: 89 },
  { pattern: /LEO\s*(copy\s*)?(attached|enclosed)/i, type: 'leo_copy', priority: 92 },
  { pattern: /let\s*export\s*order/i, type: 'leo_copy', priority: 91 },
  { pattern: /PFA\s*(the\s*)?LEO/i, type: 'leo_copy', priority: 92 },
  { pattern: /PFA\s*(the\s*)?checklist/i, type: 'checklist', priority: 88 },
  { pattern: /document\s*checklist\s*(is\s*)?(attached|enclosed)/i, type: 'checklist', priority: 88 },
  { pattern: /export\s*checklist\s*(attached|enclosed)/i, type: 'checklist', priority: 87 },
  { pattern: /attached\s*(is\s*)?(the\s*)?bill\s*of\s*entry/i, type: 'bill_of_entry', priority: 90 },
  { pattern: /PFA\s*(the\s*)?BOE\b/i, type: 'bill_of_entry', priority: 90 },

  // ===== CUSTOMS - US =====
  { pattern: /entry\s*summary\s*(is\s*)?(attached|enclosed)/i, type: 'entry_summary', priority: 90 },
  { pattern: /PFA\s*(the\s*)?entry\s*summary/i, type: 'entry_summary', priority: 90 },
  { pattern: /draft\s*entry\s*(for\s*)?(review|approval)/i, type: 'draft_entry', priority: 91 },
  { pattern: /please\s*review\s*(the\s*)?draft\s*entry/i, type: 'draft_entry', priority: 91 },
  { pattern: /duty\s*entry\s*summary/i, type: 'entry_summary', priority: 89 },
  { pattern: /ISF\s*(has\s*been\s*)?filed/i, type: 'isf_filing', priority: 90 },
  { pattern: /ISF\s*confirmation/i, type: 'isf_filing', priority: 90 },
  { pattern: /10\+2\s*(has\s*been\s*)?filed/i, type: 'isf_filing', priority: 89 },

  // ===== CUSTOMS CLEARANCE =====
  { pattern: /customs\s*(has\s*been\s*)?cleared/i, type: 'customs_clearance', priority: 92 },
  { pattern: /out\s*of\s*charge/i, type: 'customs_clearance', priority: 93 },
  { pattern: /\bOOC\b.*received/i, type: 'customs_clearance', priority: 93 },
  { pattern: /clearance\s*(is\s*)?done/i, type: 'customs_clearance', priority: 91 },

  // ===== BOOKING CONFIRMATION =====
  { pattern: /booking\s*(has\s*been\s*)?confirmed/i, type: 'booking_confirmation', priority: 88 },
  { pattern: /PFA\s*(the\s*)?booking\s*confirm/i, type: 'booking_confirmation', priority: 88 },
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?booking\s*confirm/i, type: 'booking_confirmation', priority: 87 },

  // ===== ARRIVAL NOTICE - STRICT =====
  // Only explicit "Arrival Notice" text indicates an arrival notice document
  { pattern: /PFA\s*(the\s*)?arrival\s*notice/i, type: 'arrival_notice', priority: 88 },
  // REMOVED: vessel\s*(has\s*)?arrived - Too broad, catches status updates
  // REMOVED: cargo\s*(has\s*)?arrived - Too broad, catches Maersk Last Free Day emails

  // ===== GATE IN =====
  { pattern: /container\s*(has\s*)?reached/i, type: 'gate_in_confirmation', priority: 88 },
  { pattern: /gate[d\-\s]?in\s*(confirm|done|complete)/i, type: 'gate_in_confirmation', priority: 89 },
  { pattern: /arrived\s*at\s*(CFS|ICD|port)/i, type: 'gate_in_confirmation', priority: 88 },

  // ===== EMPTY RETURN =====
  { pattern: /empty\s*(has\s*been\s*)?returned/i, type: 'empty_return', priority: 90 },
  { pattern: /container\s*(has\s*been\s*)?returned/i, type: 'empty_return', priority: 89 },
  { pattern: /empty\s*dropped/i, type: 'empty_return', priority: 88 },
];

/**
 * Match body text against indicators
 * Returns the highest priority match
 */
export function matchBodyIndicator(
  bodyText: string
): { type: string; pattern: string } | null {
  let bestMatch: { type: string; pattern: string; priority: number } | null = null;

  for (const { pattern, type, priority } of BODY_INDICATORS) {
    if (pattern.test(bodyText)) {
      if (!bestMatch || priority > bestMatch.priority) {
        bestMatch = { type, pattern: pattern.source, priority };
      }
    }
  }

  return bestMatch ? { type: bestMatch.type, pattern: bestMatch.pattern } : null;
}
