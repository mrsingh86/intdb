/**
 * Workflow Transition Rules Configuration
 *
 * Defines the complete shipment workflow state machine with DUAL TRIGGERS:
 * - Document Type: Traditional document-based transitions
 * - Email Type: Intent-based transitions (approvals, status updates)
 *
 * Direction is REQUIRED for all transitions:
 * - inbound: Received from external parties → Intoglo
 * - outbound: Sent from Intoglo → external parties
 *
 * Sender Authority validates who can trigger which states:
 * - carrier: Only shipping lines can confirm SOB, BL, arrival
 * - cha_india: CHAs confirm stuffing, gate-in, handover
 * - customs_broker_us: Brokers confirm entry, clearance, duty
 * - shipper/consignee: Can approve drafts
 */

import { EmailType, SenderCategory } from './email-type-config';

// =============================================================================
// TYPES
// =============================================================================

export type WorkflowPhase = 'pre_departure' | 'in_transit' | 'arrival' | 'delivery';

export interface WorkflowTransitionRule {
  /** Unique state code (snake_case) */
  state: string;

  /** Human-readable label */
  label: string;

  /** Order for progression (higher = later in flow) */
  order: number;

  /** Workflow phase grouping */
  phase: WorkflowPhase;

  /** Trigger conditions - document OR email can trigger */
  triggers: {
    /** Document types that trigger this state */
    documentTypes?: string[];

    /** Email types that trigger this state (NO document needed) */
    emailTypes?: EmailType[];

    /**
     * For approval_granted emails, subject must contain one of these
     * e.g., ['SI', 'shipping instruction'] for si_approved
     */
    emailSubjectPatterns?: string[];

    /** Required direction for this transition */
    direction: 'inbound' | 'outbound';

    /** Sender categories authorized to trigger this state */
    allowedSenderCategories?: SenderCategory[];
  };

  /** States that must be reached before this one (validation) */
  prerequisites?: string[];

  /** If true, this is a parallel/optional state that doesn't block main flow */
  isParallel?: boolean;

  /** Description for documentation/debugging */
  description?: string;
}

// =============================================================================
// WORKFLOW TRANSITION RULES
// =============================================================================

export const WORKFLOW_TRANSITION_RULES: WorkflowTransitionRule[] = [
  // ===========================================================================
  // PHASE 1: PRE-DEPARTURE (Origin - India)
  // ===========================================================================

  // --- BOOKING FLOW ---
  {
    state: 'booking_confirmed',
    label: 'Booking Confirmed',
    order: 10,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['booking_confirmation'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    description: 'Carrier confirms booking - creates shipment',
  },
  {
    state: 'booking_shared',
    label: 'Booking Shared',
    order: 15,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['booking_confirmation'],
      emailTypes: ['document_share'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['booking_confirmed'],
    description: 'Intoglo shares booking with customer/shipper',
  },

  // --- STUFFING FLOW (Email-only, no documents) ---
  {
    state: 'stuffing_started',
    label: 'Stuffing Started',
    order: 20,
    phase: 'pre_departure',
    triggers: {
      emailTypes: ['stuffing_update'],
      emailSubjectPatterns: ['start', 'begin', 'schedule', 'planning'],
      direction: 'inbound',
      allowedSenderCategories: ['cha_india', 'shipper', 'intoglo'],
    },
    prerequisites: ['booking_confirmed'],
    isParallel: true,
    description: 'Factory stuffing has started',
  },
  {
    state: 'stuffing_complete',
    label: 'Stuffing Complete',
    order: 25,
    phase: 'pre_departure',
    triggers: {
      emailTypes: ['stuffing_update'],
      emailSubjectPatterns: ['complete', 'done', 'finished', 'stuffed'],
      direction: 'inbound',
      allowedSenderCategories: ['cha_india', 'shipper'],
    },
    prerequisites: ['stuffing_started'],
    isParallel: true,
    description: 'Container stuffing completed at factory',
  },

  // --- GATE-IN FLOW (Email-only) ---
  {
    state: 'gate_in_complete',
    label: 'Gate In Complete',
    order: 30,
    phase: 'pre_departure',
    triggers: {
      emailTypes: ['gate_in_update'],
      direction: 'inbound',
      allowedSenderCategories: ['cha_india'],
    },
    prerequisites: ['stuffing_complete'],
    isParallel: true,
    description: 'Container gated in at port/ICD',
  },

  // --- HANDOVER FLOW (Email-only) ---
  {
    state: 'handover_complete',
    label: 'Handover Complete',
    order: 35,
    phase: 'pre_departure',
    triggers: {
      emailTypes: ['handover_update'],
      direction: 'inbound',
      allowedSenderCategories: ['cha_india'],
    },
    prerequisites: ['gate_in_complete'],
    isParallel: true,
    description: 'CHA handover/railout completed',
  },

  // --- SI FLOW ---
  {
    state: 'si_draft_sent',
    label: 'SI Draft Sent',
    order: 40,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['si_draft', 'shipping_instruction'],
      emailTypes: ['approval_request'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['booking_confirmed'],
    description: 'SI draft sent to customer for approval',
  },
  {
    state: 'si_approved',
    label: 'SI Approved',
    order: 45,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['si_confirmation'],
      emailTypes: ['approval_granted'],
      emailSubjectPatterns: ['SI', 'shipping instruction', 'S.I', 's/i'],
      direction: 'inbound',
      allowedSenderCategories: ['shipper', 'carrier', 'intoglo'],
    },
    prerequisites: ['si_draft_sent'],
    description: 'Customer approved SI draft (email or document)',
  },
  {
    state: 'si_submitted',
    label: 'SI Submitted',
    order: 50,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['si_submission', 'si_confirmation'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    prerequisites: ['si_approved'],
    description: 'SI submitted to carrier and confirmed',
  },

  // --- CHECKLIST FLOW ---
  {
    state: 'checklist_received',
    label: 'Checklist Received',
    order: 42,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['checklist'],
      direction: 'inbound',
      allowedSenderCategories: ['cha_india', 'shipper'],
    },
    prerequisites: ['booking_confirmed'],
    description: 'Export checklist received from CHA/shipper',
  },
  {
    state: 'checklist_shared',
    label: 'Checklist Shared',
    order: 44,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['checklist'],
      emailTypes: ['document_share', 'approval_request'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['checklist_received'],
    description: 'Checklist shared with customer for approval',
  },
  {
    state: 'checklist_approved',
    label: 'Checklist Approved',
    order: 46,
    phase: 'pre_departure',
    triggers: {
      emailTypes: ['approval_granted'],
      emailSubjectPatterns: ['checklist', 'check list', 'cha'],
      direction: 'inbound',
      allowedSenderCategories: ['shipper', 'intoglo'],
    },
    prerequisites: ['checklist_shared'],
    description: 'Customer approved checklist',
  },

  // --- LEO/SHIPPING BILL ---
  {
    state: 'shipping_bill_received',
    label: 'LEO/SB Received',
    order: 55,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['shipping_bill', 'leo_copy'],
      direction: 'inbound',
      allowedSenderCategories: ['cha_india'],
    },
    prerequisites: ['checklist_approved'],
    description: 'LEO/Shipping Bill received from CHA',
  },

  // --- VGM ---
  {
    state: 'vgm_submitted',
    label: 'VGM Submitted',
    order: 60,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['vgm_submission', 'vgm_confirmation'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier', 'cha_india'],
    },
    prerequisites: ['gate_in_complete'],
    description: 'VGM submitted and confirmed',
  },

  // --- SOB / DEPARTURE ---
  {
    state: 'sob_received',
    label: 'SOB Received',
    order: 70,
    phase: 'pre_departure',
    triggers: {
      documentTypes: ['sob_confirmation'],
      emailTypes: ['departure_update'],
      emailSubjectPatterns: ['SOB', 'shipped on board', 'on board'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    prerequisites: ['vgm_submitted'],
    description: 'Shipped On Board confirmation from carrier',
  },
  {
    state: 'departed',
    label: 'Vessel Departed',
    order: 75,
    phase: 'pre_departure',
    triggers: {
      emailTypes: ['departure_update'],
      emailSubjectPatterns: ['sailed', 'departed', 'departure', 'sailing'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    prerequisites: ['sob_received'],
    description: 'Vessel has sailed from origin port',
  },

  // ===========================================================================
  // PHASE 2: IN-TRANSIT
  // ===========================================================================

  {
    state: 'in_transit',
    label: 'In Transit',
    order: 80,
    phase: 'in_transit',
    triggers: {
      emailTypes: ['transit_update'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    prerequisites: ['departed'],
    description: 'Vessel in transit, status updates',
  },

  // --- BL FLOW (MBL from carrier) ---
  {
    state: 'bl_received',
    label: 'BL Received',
    order: 85,
    phase: 'in_transit',
    triggers: {
      documentTypes: ['bill_of_lading'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    prerequisites: ['departed'],
    description: 'Master BL received from carrier',
  },
  {
    state: 'bl_shared',
    label: 'BL Shared',
    order: 87,
    phase: 'in_transit',
    triggers: {
      documentTypes: ['bill_of_lading'],
      emailTypes: ['document_share'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['bl_received'],
    description: 'MBL shared with destination agent/broker',
  },

  // --- HBL FLOW ---
  {
    state: 'hbl_draft_sent',
    label: 'HBL Draft Sent',
    order: 90,
    phase: 'in_transit',
    triggers: {
      documentTypes: ['house_bl', 'hbl_draft'],
      emailTypes: ['approval_request'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['departed'],
    description: 'HBL draft sent to customer for approval',
  },
  {
    state: 'hbl_approved',
    label: 'HBL Approved',
    order: 95,
    phase: 'in_transit',
    triggers: {
      emailTypes: ['approval_granted'],
      emailSubjectPatterns: ['HBL', 'house bl', 'BL draft', 'draft bl', 'B/L'],
      direction: 'inbound',
      allowedSenderCategories: ['shipper', 'consignee'],
    },
    prerequisites: ['hbl_draft_sent'],
    description: 'Customer approved HBL draft',
  },
  {
    state: 'hbl_shared',
    label: 'HBL Shared',
    order: 100,
    phase: 'in_transit',
    triggers: {
      documentTypes: ['house_bl'],
      emailTypes: ['document_share'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['hbl_approved'],
    description: 'Final HBL shared with customer/consignee',
  },

  // --- INVOICE ---
  {
    state: 'invoice_sent',
    label: 'Invoice Sent',
    order: 105,
    phase: 'in_transit',
    triggers: {
      documentTypes: ['invoice', 'freight_invoice'],
      emailTypes: ['payment_request'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['hbl_shared'],
    description: 'Freight invoice sent to customer',
  },

  // ===========================================================================
  // PHASE 3: ARRIVAL & CUSTOMS (Destination - US)
  // ===========================================================================

  // --- PRE-ALERT ---
  {
    state: 'pre_alert_sent',
    label: 'Pre-Alert Sent',
    order: 110,
    phase: 'arrival',
    triggers: {
      emailTypes: ['pre_alert'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['departed'],
    description: 'Pre-arrival alert sent to US customs broker',
  },

  // --- ARRIVAL NOTICE ---
  {
    state: 'arrival_notice_received',
    label: 'AN Received',
    order: 115,
    phase: 'arrival',
    triggers: {
      documentTypes: ['arrival_notice'],
      emailTypes: ['arrival_update'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier'],
    },
    prerequisites: ['in_transit'],
    description: 'Arrival notice received from carrier',
  },
  {
    state: 'arrival_notice_shared',
    label: 'AN Shared',
    order: 117,
    phase: 'arrival',
    triggers: {
      documentTypes: ['arrival_notice'],
      emailTypes: ['document_share'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['arrival_notice_received'],
    description: 'Arrival notice shared with customer/consignee',
  },

  // --- ENTRY DRAFT FLOW ---
  {
    state: 'entry_draft_received',
    label: 'Entry Draft Received',
    order: 120,
    phase: 'arrival',
    triggers: {
      documentTypes: ['draft_entry', 'customs_document'],
      emailTypes: ['approval_request'],
      direction: 'inbound',
      allowedSenderCategories: ['customs_broker_us'],
    },
    prerequisites: ['pre_alert_sent'],
    description: 'Draft entry (7501) received from US broker',
  },
  {
    state: 'entry_draft_shared',
    label: 'Entry Draft Shared',
    order: 122,
    phase: 'arrival',
    triggers: {
      documentTypes: ['draft_entry'],
      emailTypes: ['document_share', 'approval_request'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['entry_draft_received'],
    description: 'Entry draft shared with customer for approval',
  },
  {
    state: 'entry_approved',
    label: 'Entry Approved',
    order: 125,
    phase: 'arrival',
    triggers: {
      emailTypes: ['approval_granted'],
      emailSubjectPatterns: ['entry', '7501', 'customs', 'draft entry'],
      direction: 'inbound',
      allowedSenderCategories: ['shipper', 'consignee', 'intoglo'],
    },
    prerequisites: ['entry_draft_shared'],
    description: 'Customer approved customs entry',
  },

  // --- CUSTOMS CLEARANCE ---
  {
    state: 'clearance_started',
    label: 'Clearance Started',
    order: 130,
    phase: 'arrival',
    triggers: {
      emailTypes: ['clearance_initiation'],
      direction: 'inbound',
      allowedSenderCategories: ['customs_broker_us'],
    },
    prerequisites: ['entry_approved'],
    description: 'Customs clearance process started',
  },
  {
    state: 'customs_cleared',
    label: 'Customs Cleared',
    order: 135,
    phase: 'arrival',
    triggers: {
      documentTypes: ['entry_summary'],
      emailTypes: ['clearance_complete'],
      direction: 'inbound',
      allowedSenderCategories: ['customs_broker_us', 'platform'],
    },
    prerequisites: ['clearance_started'],
    description: 'Customs cleared, cargo released by CBP',
  },

  // ===========================================================================
  // PHASE 4: DELIVERY
  // ===========================================================================

  {
    state: 'cargo_released',
    label: 'Cargo Released',
    order: 140,
    phase: 'delivery',
    triggers: {
      documentTypes: ['container_release'],
      direction: 'inbound',
      allowedSenderCategories: ['carrier', 'customs_broker_us'],
    },
    prerequisites: ['customs_cleared'],
    description: 'Container/cargo released for pickup',
  },

  // --- DUTY INVOICE ---
  {
    state: 'duty_invoice_received',
    label: 'Duty Invoice Received',
    order: 145,
    phase: 'delivery',
    triggers: {
      documentTypes: ['duty_invoice'],
      emailTypes: ['payment_request'],
      direction: 'inbound',
      allowedSenderCategories: ['customs_broker_us'],
    },
    prerequisites: ['customs_cleared'],
    description: 'Duty/customs invoice received from broker',
  },
  {
    state: 'duty_invoice_shared',
    label: 'Duty Invoice Shared',
    order: 147,
    phase: 'delivery',
    triggers: {
      documentTypes: ['duty_invoice'],
      emailTypes: ['document_share'],
      direction: 'outbound',
      allowedSenderCategories: ['intoglo'],
    },
    prerequisites: ['duty_invoice_received'],
    description: 'Duty invoice shared with customer',
  },

  // --- DELIVERY ---
  {
    state: 'delivery_scheduled',
    label: 'Delivery Scheduled',
    order: 150,
    phase: 'delivery',
    triggers: {
      emailTypes: ['delivery_scheduling', 'pickup_scheduling'],
      direction: 'inbound',
      allowedSenderCategories: ['trucker', 'consignee', 'customs_broker_us', 'warehouse'],
    },
    prerequisites: ['cargo_released'],
    description: 'Delivery appointment scheduled',
  },
  {
    state: 'delivered',
    label: 'Delivered',
    order: 155,
    phase: 'delivery',
    triggers: {
      documentTypes: ['proof_of_delivery', 'pod_confirmation'],
      emailTypes: ['delivery_complete'],
      direction: 'inbound',
      allowedSenderCategories: ['trucker', 'customs_broker_us', 'consignee', 'warehouse'],
    },
    prerequisites: ['delivery_scheduled'],
    description: 'Cargo delivered to consignee, POD received',
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all states for a phase
 */
export function getStatesForPhase(phase: WorkflowPhase): WorkflowTransitionRule[] {
  return WORKFLOW_TRANSITION_RULES.filter(rule => rule.phase === phase);
}

/**
 * Get a state by code
 */
export function getStateByCode(stateCode: string): WorkflowTransitionRule | undefined {
  return WORKFLOW_TRANSITION_RULES.find(rule => rule.state === stateCode);
}

/**
 * Get states that can be triggered by a document type
 */
export function getStatesForDocumentType(
  documentType: string,
  direction: 'inbound' | 'outbound'
): WorkflowTransitionRule[] {
  return WORKFLOW_TRANSITION_RULES.filter(rule =>
    rule.triggers.direction === direction &&
    rule.triggers.documentTypes?.includes(documentType)
  );
}

/**
 * Get states that can be triggered by an email type
 */
export function getStatesForEmailType(
  emailType: EmailType,
  direction: 'inbound' | 'outbound'
): WorkflowTransitionRule[] {
  return WORKFLOW_TRANSITION_RULES.filter(rule =>
    rule.triggers.direction === direction &&
    rule.triggers.emailTypes?.includes(emailType)
  );
}

/**
 * Check if a sender category is authorized for a state
 */
export function isSenderAuthorized(
  stateCode: string,
  senderCategory: SenderCategory
): boolean {
  const rule = getStateByCode(stateCode);
  if (!rule) return false;
  if (!rule.triggers.allowedSenderCategories) return true;
  return rule.triggers.allowedSenderCategories.includes(senderCategory);
}

/**
 * Get the order of a state (for progression comparison)
 */
export function getStateOrder(stateCode: string): number {
  const rule = getStateByCode(stateCode);
  return rule?.order ?? 0;
}

/**
 * Check if state B is after state A in the workflow
 */
export function isStateAfter(stateA: string, stateB: string): boolean {
  return getStateOrder(stateB) > getStateOrder(stateA);
}
