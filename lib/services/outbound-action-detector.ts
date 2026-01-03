/**
 * Outbound Action Detector
 *
 * Detects workflow actions from outbound emails (sent by Intoglo).
 * Maps outbound email patterns to workflow states like "Booking Shared", "Invoice Sent", etc.
 */

// Outbound action types that trigger workflow states
export type OutboundActionType =
  | 'booking_shared'
  | 'invoice_sent'
  | 'si_shared'
  | 'checklist_shared'
  | 'sob_confirmation'
  | 'bl_shared'
  | 'arrival_notice_shared'
  | 'duty_shared'
  | 'do_shared'
  | 'documents_shared';

// Map outbound action to workflow state
export const OUTBOUND_ACTION_TO_WORKFLOW_STATE: Record<OutboundActionType, string> = {
  'booking_shared': 'booking_confirmation_shared',
  'invoice_sent': 'invoice_sent',
  'si_shared': 'si_draft_received', // SI shared with carrier
  'checklist_shared': 'checklist_approved',
  'sob_confirmation': 'si_confirmed', // SOB = Shipped on Board = SI confirmed
  'bl_shared': 'hbl_released',
  'arrival_notice_shared': 'arrival_notice_shared',
  'duty_shared': 'duty_summary_shared',
  'do_shared': 'cargo_released',
  'documents_shared': 'booking_confirmation_shared',
};

// Intoglo email domains
const INTOGLO_DOMAINS = ['intoglo.com', 'intoglo.in'];

/**
 * Check if an email is outbound (sent by Intoglo)
 */
export function isOutboundEmail(senderEmail: string): boolean {
  if (!senderEmail) return false;
  const domain = senderEmail.split('@')[1]?.toLowerCase();
  return INTOGLO_DOMAINS.some(d => domain?.includes(d));
}

/**
 * Detect the action type from an outbound email subject
 */
export function detectOutboundAction(subject: string): OutboundActionType | null {
  if (!subject) return null;

  const s = subject.toUpperCase();

  // Order matters - more specific patterns first

  // SOB Confirmation (Shipped on Board = SI confirmed by carrier)
  if (s.includes('SOB CONFIRMATION') || s.includes('SOB CONF')) {
    return 'sob_confirmation';
  }

  // Checklist
  if (s.includes('CHECKLIST')) {
    return 'checklist_shared';
  }

  // Arrival Notice shared
  if (s.includes('ARRIVAL NOTICE') || s.match(/\bAN\s*\/\//)) {
    return 'arrival_notice_shared';
  }

  // Pre-alert (BL shared before arrival)
  if (s.includes('PRE-ALERT') || s.includes('PREALERT')) {
    return 'bl_shared';
  }

  // Shipping Instruction
  if (s.includes('SHIPPING INSTRUCTION') || s.match(/\bSI\s+FOR\b/) || s.match(/\bSIL\b/)) {
    return 'si_shared';
  }

  // Delivery Order
  if (s.includes('DO //') || s.includes('DELIVERY ORDER') || s.match(/\bD\/O\b/)) {
    return 'do_shared';
  }

  // BL/HBL related
  if (s.includes('HBL') || s.includes('MBL') || s.match(/\bB\/L\b/) || s.match(/\bBL\s+/)) {
    return 'bl_shared';
  }

  // Duty/Customs
  if (s.includes('DUTY') || s.includes('CUSTOMS')) {
    return 'duty_shared';
  }

  // Invoice
  if (s.includes('INVOICE') || s.match(/\bINV\s+/) || s.includes('IMP INV')) {
    return 'invoice_sent';
  }

  // Booking (generic)
  if (s.includes('BKG') || s.includes('BOOKING')) {
    return 'booking_shared';
  }

  // Documents shared
  if (s.includes('DOCUMENTS FOR') || s.includes('DOCS')) {
    return 'documents_shared';
  }

  return null;
}

/**
 * Get workflow states that can be completed by outbound emails
 */
export function getOutboundCompletableStates(): string[] {
  return Object.values(OUTBOUND_ACTION_TO_WORKFLOW_STATE);
}

/**
 * Detect all outbound actions from a list of emails
 */
export function detectOutboundActions(emails: Array<{ sender_email: string; subject: string }>): Set<string> {
  const workflowStates = new Set<string>();

  for (const email of emails) {
    if (isOutboundEmail(email.sender_email)) {
      const action = detectOutboundAction(email.subject);
      if (action) {
        const workflowState = OUTBOUND_ACTION_TO_WORKFLOW_STATE[action];
        if (workflowState) {
          workflowStates.add(workflowState);
        }
      }
    }
  }

  return workflowStates;
}
