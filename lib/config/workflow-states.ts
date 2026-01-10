/**
 * Workflow State Definitions for Journey Timeline
 *
 * Defines the 28 workflow states for visualizing shipment lifecycle.
 * States are derived from Chronicle records (document_type + direction).
 *
 * Following CLAUDE.md principles:
 * - Configuration Over Code (Principle #5)
 * - Single Responsibility (Principle #3)
 */

// =============================================================================
// TYPES
// =============================================================================

export type WorkflowPhase = 'pre_shipment' | 'in_transit' | 'arrival' | 'delivery';

export interface WorkflowStateDefinition {
  /** Unique state key (snake_case) */
  key: string;

  /** Human-readable label for UI */
  label: string;

  /** Order for progression (higher = later in flow) */
  order: number;

  /** Workflow phase grouping */
  phase: WorkflowPhase;

  /** Document types that trigger this state */
  documentTypes: string[];

  /** Required direction for this state */
  direction: 'inbound' | 'outbound';
}

export interface PhaseDefinition {
  key: WorkflowPhase;
  label: string;
  order: number;
}

// =============================================================================
// PHASE DEFINITIONS
// =============================================================================

export const WORKFLOW_PHASES: PhaseDefinition[] = [
  { key: 'pre_shipment', label: 'Pre-Departure', order: 1 },
  { key: 'in_transit', label: 'In Transit', order: 2 },
  { key: 'arrival', label: 'Arrival', order: 3 },
  { key: 'delivery', label: 'Delivery', order: 4 },
];

// =============================================================================
// WORKFLOW STATES (28 total)
// =============================================================================

export const WORKFLOW_STATES: WorkflowStateDefinition[] = [
  // ===========================================================================
  // PHASE: PRE-SHIPMENT (9 states)
  // ===========================================================================
  {
    key: 'booking_confirmation_received',
    label: 'BC Received',
    order: 10,
    phase: 'pre_shipment',
    documentTypes: ['booking_confirmation', 'booking_amendment'],
    direction: 'inbound',
  },
  {
    key: 'booking_confirmation_shared',
    label: 'BC Shared',
    order: 15,
    phase: 'pre_shipment',
    documentTypes: ['booking_confirmation', 'booking_amendment'],
    direction: 'outbound',
  },
  {
    key: 'si_draft_received',
    label: 'SI Draft Received',
    order: 30,
    phase: 'pre_shipment',
    documentTypes: ['shipping_instructions'],
    direction: 'inbound',
  },
  {
    key: 'si_draft_sent',
    label: 'SI Draft Sent',
    order: 32,
    phase: 'pre_shipment',
    documentTypes: ['shipping_instructions'],
    direction: 'outbound',
  },
  {
    key: 'checklist_received',
    label: 'Checklist Received',
    order: 40,
    phase: 'pre_shipment',
    documentTypes: ['checklist'],
    direction: 'inbound',
  },
  {
    key: 'checklist_shared',
    label: 'Checklist Shared',
    order: 42,
    phase: 'pre_shipment',
    documentTypes: ['checklist'],
    direction: 'outbound',
  },
  {
    key: 'shipping_bill_received',
    label: 'LEO/SB Received',
    order: 48,
    phase: 'pre_shipment',
    documentTypes: ['shipping_bill', 'leo_copy'],
    direction: 'inbound',
  },
  {
    key: 'si_confirmed',
    label: 'SI Confirmed',
    order: 60,
    phase: 'pre_shipment',
    documentTypes: ['si_confirmation'],
    direction: 'inbound',
  },
  {
    key: 'vgm_submitted',
    label: 'VGM Submitted',
    order: 65,
    phase: 'pre_shipment',
    documentTypes: ['vgm_confirmation'],
    direction: 'inbound',
  },

  // ===========================================================================
  // PHASE: IN-TRANSIT (5 states)
  // ===========================================================================
  {
    key: 'sob_received',
    label: 'SOB Received',
    order: 80,
    phase: 'in_transit',
    documentTypes: ['sob_confirmation'],
    direction: 'inbound',
  },
  {
    key: 'bl_received',
    label: 'BL Received',
    order: 119,
    phase: 'in_transit',
    documentTypes: ['draft_bl', 'final_bl'],
    direction: 'inbound',
  },
  {
    key: 'hbl_draft_sent',
    label: 'HBL Draft Sent',
    order: 120,
    phase: 'in_transit',
    documentTypes: ['draft_bl', 'house_bl'],
    direction: 'outbound',
  },
  {
    key: 'hbl_shared',
    label: 'HBL Shared',
    order: 132,
    phase: 'in_transit',
    documentTypes: ['final_bl', 'house_bl'],
    direction: 'outbound',
  },
  {
    key: 'invoice_sent',
    label: 'Invoice Sent',
    order: 135,
    phase: 'in_transit',
    documentTypes: ['invoice', 'debit_note'],
    direction: 'outbound',
  },

  // ===========================================================================
  // PHASE: ARRIVAL (10 states)
  // ===========================================================================
  {
    key: 'entry_draft_received',
    label: 'Entry Draft Received',
    order: 153,
    phase: 'arrival',
    documentTypes: ['customs_entry'],
    direction: 'inbound',
  },
  {
    key: 'entry_draft_shared',
    label: 'Entry Draft Shared',
    order: 156,
    phase: 'arrival',
    documentTypes: ['customs_entry'],
    direction: 'outbound',
  },
  {
    key: 'entry_summary_received',
    label: 'Entry Summary Received',
    order: 168,
    phase: 'arrival',
    documentTypes: ['entry_summary'],
    direction: 'inbound',
  },
  {
    key: 'entry_summary_shared',
    label: 'Entry Summary Shared',
    order: 172,
    phase: 'arrival',
    documentTypes: ['entry_summary'],
    direction: 'outbound',
  },
  {
    key: 'arrival_notice_received',
    label: 'AN Received',
    order: 180,
    phase: 'arrival',
    documentTypes: ['arrival_notice'],
    direction: 'inbound',
  },
  {
    key: 'arrival_notice_shared',
    label: 'AN Shared',
    order: 185,
    phase: 'arrival',
    documentTypes: ['arrival_notice'],
    direction: 'outbound',
  },
  {
    key: 'cargo_released',
    label: 'Cargo Released',
    order: 192,
    phase: 'arrival',
    documentTypes: ['container_release', 'freight_release'],
    direction: 'inbound',
  },
  {
    key: 'duty_invoice_received',
    label: 'Duty Invoice Received',
    order: 195,
    phase: 'arrival',
    documentTypes: ['duty_invoice'],
    direction: 'inbound',
  },
  {
    key: 'duty_summary_shared',
    label: 'Duty Invoice Shared',
    order: 200,
    phase: 'arrival',
    documentTypes: ['duty_invoice'],
    direction: 'outbound',
  },

  // ===========================================================================
  // PHASE: DELIVERY (4 states)
  // ===========================================================================
  {
    key: 'delivery_order_received',
    label: 'DO Received',
    order: 205,
    phase: 'delivery',
    documentTypes: ['delivery_order'],
    direction: 'inbound',
  },
  {
    key: 'delivery_order_shared',
    label: 'DO Shared',
    order: 210,
    phase: 'delivery',
    documentTypes: ['delivery_order'],
    direction: 'outbound',
  },
  {
    key: 'container_released',
    label: 'Container Released',
    order: 220,
    phase: 'delivery',
    documentTypes: ['container_release'],
    direction: 'outbound',
  },
  {
    key: 'pod_received',
    label: 'POD Received',
    order: 235,
    phase: 'delivery',
    documentTypes: ['pod_proof_of_delivery'],
    direction: 'inbound',
  },
  {
    key: 'pod_shared',
    label: 'POD Shared',
    order: 240,
    phase: 'delivery',
    documentTypes: ['pod_proof_of_delivery'],
    direction: 'outbound',
  },
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get workflow state from document type and direction
 */
export function getWorkflowStateFromDocument(
  documentType: string,
  direction: 'inbound' | 'outbound'
): WorkflowStateDefinition | null {
  return (
    WORKFLOW_STATES.find(
      (state) =>
        state.documentTypes.includes(documentType) && state.direction === direction
    ) || null
  );
}

/**
 * Get all states for a phase
 */
export function getStatesForPhase(phase: WorkflowPhase): WorkflowStateDefinition[] {
  return WORKFLOW_STATES.filter((state) => state.phase === phase).sort(
    (a, b) => a.order - b.order
  );
}

/**
 * Get phase definition by key
 */
export function getPhaseDefinition(phase: WorkflowPhase): PhaseDefinition | undefined {
  return WORKFLOW_PHASES.find((p) => p.key === phase);
}

/**
 * Get state definition by key
 */
export function getStateByKey(key: string): WorkflowStateDefinition | undefined {
  return WORKFLOW_STATES.find((state) => state.key === key);
}

/**
 * Get the highest order state (max progression)
 */
export const MAX_WORKFLOW_ORDER = 240;
