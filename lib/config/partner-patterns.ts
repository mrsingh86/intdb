/**
 * Partner Subject Patterns
 *
 * Classification patterns for non-carrier inbound emails:
 * - India CHA (Customs House Agent)
 * - US Customs Broker
 * - Truckers/Transporters
 * - Shippers/Clients
 * - Destination Agents
 */

export interface PartnerPattern {
  pattern: RegExp;
  type: string;
  priority: number;
  category: 'india_cha' | 'us_broker' | 'trucker' | 'client' | 'agent';
  notes?: string;
}

// ===== INDIA CHA PATTERNS =====
export const INDIA_CHA_PATTERNS: PartnerPattern[] = [
  // Checklist
  { pattern: /\bChecklist\b/i, type: 'checklist', priority: 85, category: 'india_cha' },
  { pattern: /Document\s*Checklist/i, type: 'checklist', priority: 86, category: 'india_cha' },
  { pattern: /Export\s*Checklist/i, type: 'checklist', priority: 86, category: 'india_cha' },
  { pattern: /Doc\s*List/i, type: 'checklist', priority: 84, category: 'india_cha' },
  { pattern: /Shipment\s*Checklist/i, type: 'checklist', priority: 85, category: 'india_cha' },

  // Shipping Bill
  { pattern: /Shipping\s*Bill/i, type: 'shipping_bill', priority: 90, category: 'india_cha' },
  { pattern: /\bSB\s*No\.?\s*\d+/i, type: 'shipping_bill', priority: 91, category: 'india_cha' },
  { pattern: /\bSB\b.*filed/i, type: 'shipping_bill', priority: 90, category: 'india_cha' },
  { pattern: /\bSB\b.*generated/i, type: 'shipping_bill', priority: 90, category: 'india_cha' },

  // LEO (Let Export Order)
  { pattern: /\bLEO\b/i, type: 'leo_copy', priority: 92, category: 'india_cha' },
  { pattern: /Let\s*Export\s*Order/i, type: 'leo_copy', priority: 93, category: 'india_cha' },

  // Bill of Entry (Import)
  { pattern: /Bill\s*of\s*Entry/i, type: 'bill_of_entry', priority: 90, category: 'india_cha' },
  { pattern: /\bBOE\b.*\d+/i, type: 'bill_of_entry', priority: 91, category: 'india_cha' },
  { pattern: /\bBE\s*No\.?\s*\d+/i, type: 'bill_of_entry', priority: 91, category: 'india_cha' },

  // Duty Invoice
  { pattern: /Duty\s*Invoice/i, type: 'duty_invoice', priority: 90, category: 'india_cha' },
  { pattern: /Customs\s*Invoice/i, type: 'duty_invoice', priority: 89, category: 'india_cha' },
  { pattern: /IGST\s*(Payment|Invoice)/i, type: 'duty_invoice', priority: 91, category: 'india_cha' },
  { pattern: /Duty\s*Payment/i, type: 'duty_invoice', priority: 88, category: 'india_cha' },

  // Customs Clearance
  { pattern: /Customs\s*Clear/i, type: 'customs_clearance', priority: 92, category: 'india_cha' },
  { pattern: /Out\s*of\s*Charge/i, type: 'customs_clearance', priority: 95, category: 'india_cha' },
  { pattern: /\bOOC\b/i, type: 'customs_clearance', priority: 95, category: 'india_cha' },
  { pattern: /Clearance\s*Done/i, type: 'customs_clearance', priority: 91, category: 'india_cha' },

  // Exam/Hold
  { pattern: /Customs\s*Hold/i, type: 'exam_notice', priority: 93, category: 'india_cha' },
  { pattern: /Exam\s*Order/i, type: 'exam_notice', priority: 93, category: 'india_cha' },
  { pattern: /DRI\s*Notice/i, type: 'exam_notice', priority: 94, category: 'india_cha' },
  { pattern: /Container\s*Held/i, type: 'exam_notice', priority: 92, category: 'india_cha' },
];

// ===== US CUSTOMS BROKER PATTERNS =====
export const US_CUSTOMS_BROKER_PATTERNS: PartnerPattern[] = [
  // Entry Summary (CBP Form 7501)
  { pattern: /Entry\s*Summary/i, type: 'entry_summary', priority: 92, category: 'us_broker' },
  { pattern: /\b7501\b/i, type: 'entry_summary', priority: 93, category: 'us_broker', notes: 'CBP Form 7501' },
  { pattern: /Duty\s*Entry\s*Summary/i, type: 'entry_summary', priority: 93, category: 'us_broker' },
  { pattern: /CBP\s*Entry/i, type: 'entry_summary', priority: 91, category: 'us_broker' },

  // Draft Entry (for review before filing)
  { pattern: /Draft\s*Entry/i, type: 'draft_entry', priority: 94, category: 'us_broker' },
  { pattern: /Entry\s*Draft/i, type: 'draft_entry', priority: 94, category: 'us_broker' },
  { pattern: /Entry\s*for\s*(your\s*)?(review|approval)/i, type: 'draft_entry', priority: 93, category: 'us_broker' },
  { pattern: /Review\s*Entry/i, type: 'draft_entry', priority: 92, category: 'us_broker' },
  { pattern: /Preliminary\s*Entry/i, type: 'draft_entry', priority: 92, category: 'us_broker' },

  // ISF (Importer Security Filing - 10+2)
  { pattern: /\bISF\b/i, type: 'isf_filing', priority: 90, category: 'us_broker' },
  { pattern: /Importer\s*Security\s*Filing/i, type: 'isf_filing', priority: 91, category: 'us_broker' },
  { pattern: /10\+2\s*Filing/i, type: 'isf_filing', priority: 91, category: 'us_broker' },
  { pattern: /ISF\s*Confirm/i, type: 'isf_filing', priority: 92, category: 'us_broker' },

  // Duty Payment
  { pattern: /Duty\s*Payment/i, type: 'duty_invoice', priority: 88, category: 'us_broker' },
  { pattern: /ACH\s*Debit/i, type: 'duty_invoice', priority: 89, category: 'us_broker' },
  { pattern: /CBP\s*Duty/i, type: 'duty_invoice', priority: 89, category: 'us_broker' },

  // Release
  { pattern: /Customs\s*Release/i, type: 'customs_clearance', priority: 92, category: 'us_broker' },
  { pattern: /CBP\s*Release/i, type: 'customs_clearance', priority: 93, category: 'us_broker' },
  { pattern: /Entry\s*Released/i, type: 'customs_clearance', priority: 92, category: 'us_broker' },
  { pattern: /Cargo\s*Released/i, type: 'customs_clearance', priority: 91, category: 'us_broker' },

  // FDA/USDA Holds
  { pattern: /FDA\s*Hold/i, type: 'exam_notice', priority: 94, category: 'us_broker' },
  { pattern: /USDA\s*Hold/i, type: 'exam_notice', priority: 94, category: 'us_broker' },
  { pattern: /Intensive\s*Exam/i, type: 'exam_notice', priority: 93, category: 'us_broker' },
  { pattern: /X-?Ray\s*Exam/i, type: 'exam_notice', priority: 93, category: 'us_broker' },
  { pattern: /VACIS\s*Exam/i, type: 'exam_notice', priority: 93, category: 'us_broker' },
];

// ===== TRUCKER/TRANSPORTER PATTERNS =====
export const TRUCKER_PATTERNS: PartnerPattern[] = [
  // POD
  { pattern: /\bPOD\b/i, type: 'proof_of_delivery', priority: 95, category: 'trucker' },
  { pattern: /Proof\s*of\s*Delivery/i, type: 'proof_of_delivery', priority: 94, category: 'trucker' },
  { pattern: /Signed\s*(POD|Delivery)/i, type: 'proof_of_delivery', priority: 95, category: 'trucker' },
  { pattern: /Delivery\s*Proof/i, type: 'proof_of_delivery', priority: 94, category: 'trucker' },

  // Delivery Confirmation
  { pattern: /Deliver(y|ed)\s*(Done|Complete|Confirm)/i, type: 'delivery_confirmation', priority: 92, category: 'trucker' },
  { pattern: /Successfully\s*Delivered/i, type: 'delivery_confirmation', priority: 92, category: 'trucker' },
  { pattern: /Cargo\s*Delivered/i, type: 'delivery_confirmation', priority: 91, category: 'trucker' },
  { pattern: /Unloaded\s*(at|successfully)/i, type: 'delivery_confirmation', priority: 90, category: 'trucker' },

  // Gate-in
  { pattern: /Gate[-\s]?in/i, type: 'gate_in_confirmation', priority: 88, category: 'trucker' },
  { pattern: /Container\s*reached/i, type: 'gate_in_confirmation', priority: 87, category: 'trucker' },
  { pattern: /Arrived\s*at\s*(CFS|ICD|Port|Warehouse)/i, type: 'gate_in_confirmation', priority: 88, category: 'trucker' },
  { pattern: /Container\s*handed\s*over/i, type: 'gate_in_confirmation', priority: 87, category: 'trucker' },

  // Empty Return
  { pattern: /Empty\s*Return/i, type: 'empty_return', priority: 90, category: 'trucker' },
  { pattern: /Container\s*Returned/i, type: 'empty_return', priority: 89, category: 'trucker' },
  { pattern: /Empty\s*Dropped/i, type: 'empty_return', priority: 89, category: 'trucker' },
  { pattern: /MTY\s*Return/i, type: 'empty_return', priority: 90, category: 'trucker' },

  // Vehicle Assignment
  { pattern: /Vehicle\s*Assigned/i, type: 'vehicle_assignment', priority: 80, category: 'trucker' },
  { pattern: /Truck\s*Details/i, type: 'vehicle_assignment', priority: 79, category: 'trucker' },
];

// ===== CLIENT/SHIPPER PATTERNS =====
export const CLIENT_PATTERNS: PartnerPattern[] = [
  // SI
  { pattern: /\bSI\b\s*(attached|details|for)/i, type: 'si_draft', priority: 88, category: 'client' },
  { pattern: /Shipping\s*Instruction/i, type: 'si_draft', priority: 89, category: 'client' },
  { pattern: /SI\s*for\s*booking/i, type: 'si_draft', priority: 90, category: 'client' },

  // Commercial Invoice
  { pattern: /Commercial\s*Invoice/i, type: 'commercial_invoice', priority: 88, category: 'client' },
  { pattern: /\bCI\b\s*attached/i, type: 'commercial_invoice', priority: 89, category: 'client' },

  // Packing List
  { pattern: /Packing\s*List/i, type: 'packing_list', priority: 88, category: 'client' },
  { pattern: /\bPL\b\s*attached/i, type: 'packing_list', priority: 89, category: 'client' },

  // Certificates
  { pattern: /Certificate\s*of\s*Origin/i, type: 'certificate', priority: 88, category: 'client' },
  { pattern: /\bCOO\b/i, type: 'certificate', priority: 89, category: 'client' },
  { pattern: /Phyto(sanitary)?\s*Certificate/i, type: 'certificate', priority: 88, category: 'client' },
  { pattern: /Fumigation\s*Certificate/i, type: 'certificate', priority: 88, category: 'client' },
  { pattern: /Quality\s*Certificate/i, type: 'certificate', priority: 87, category: 'client' },
];

// ===== DESTINATION AGENT PATTERNS =====
export const AGENT_PATTERNS: PartnerPattern[] = [
  // Arrival Notice
  { pattern: /Arrival\s*Notice/i, type: 'arrival_notice', priority: 88, category: 'agent' },
  { pattern: /Cargo\s*Arrived/i, type: 'arrival_notice', priority: 87, category: 'agent' },
  { pattern: /Vessel\s*Arrived/i, type: 'arrival_notice', priority: 87, category: 'agent' },
  { pattern: /Pre-?Alert/i, type: 'arrival_notice', priority: 89, category: 'agent' },

  // Delivery Order
  { pattern: /DO\s*Release/i, type: 'delivery_order', priority: 90, category: 'agent' },
  { pattern: /Delivery\s*Order/i, type: 'delivery_order', priority: 89, category: 'agent' },
  { pattern: /\bDO\b\s*attached/i, type: 'delivery_order', priority: 90, category: 'agent' },

  // Container Release
  { pattern: /Container\s*Release/i, type: 'container_release', priority: 91, category: 'agent' },
  { pattern: /Release\s*Order/i, type: 'container_release', priority: 90, category: 'agent' },
  { pattern: /Pin\s*Release/i, type: 'container_release', priority: 90, category: 'agent' },
];

// ===== COMBINED PATTERNS =====
export const ALL_PARTNER_PATTERNS: PartnerPattern[] = [
  ...INDIA_CHA_PATTERNS,
  ...US_CUSTOMS_BROKER_PATTERNS,
  ...TRUCKER_PATTERNS,
  ...CLIENT_PATTERNS,
  ...AGENT_PATTERNS,
];

/**
 * Match subject against partner patterns
 * Returns the highest priority match
 */
export function matchPartnerPattern(
  subject: string
): { type: string; pattern: string; category: string } | null {
  let bestMatch: { type: string; pattern: string; category: string; priority: number } | null = null;

  for (const { pattern, type, priority, category } of ALL_PARTNER_PATTERNS) {
    if (pattern.test(subject)) {
      if (!bestMatch || priority > bestMatch.priority) {
        bestMatch = { type, pattern: pattern.source, category, priority };
      }
    }
  }

  return bestMatch ? { type: bestMatch.type, pattern: bestMatch.pattern, category: bestMatch.category } : null;
}
