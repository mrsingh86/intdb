/**
 * Workflow State Service
 *
 * Manages shipment workflow state transitions using a state machine pattern.
 * Tracks 16 granular states across 4 phases: pre_departure, in_transit, arrival, delivery.
 *
 * Principles:
 * - State Machine: Valid transitions only, never regress
 * - Configuration Over Code: States defined in database
 * - Audit Trail: All transitions logged
 * - Fail Fast: Invalid transitions throw errors
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { detectDirection } from '../utils/direction-detector';

/**
 * Direction-aware document type to workflow state mapping.
 * INBOUND = email received from external party (not @intoglo.com)
 * OUTBOUND = email sent by Intoglo team (sender @intoglo.com or @intoglo.in)
 *
 * Key format: {document_type}:{direction}
 */
/**
 * Carrier sender patterns - used to identify emails from shipping lines
 */
const CARRIER_SENDER_PATTERNS = [
  /maersk/i,
  /hlag|hapag/i,
  /cosco|coscon/i,
  /cma.?cgm/i,
  /one-line|ocean network express/i,
  /evergreen/i,
  /\bmsc\b|mediterranean shipping/i,
  /yang.?ming|yml/i,
  /\bzim\b/i,
  /oocl/i,
  /apl\b/i,
  /noreply@hlag/i,
  /donotreply@maersk/i,
  /do_not_reply/i,
  /donotreply/i,
  /@service\.hlag/i,
];

/**
 * Check if sender email is from a known carrier/shipping line
 */
function isCarrierSender(senderEmail: string | null | undefined): boolean {
  if (!senderEmail) return false;
  const sender = senderEmail.toLowerCase();
  return CARRIER_SENDER_PATTERNS.some(pattern => pattern.test(sender));
}

const DIRECTION_WORKFLOW_MAPPING: Record<string, string> = {
  // ===== PRE_DEPARTURE =====
  // Booking stage
  'booking_confirmation:inbound': 'booking_confirmation_received',
  'booking_amendment:inbound': 'booking_confirmation_received',
  'booking_confirmation:outbound': 'booking_confirmation_shared',
  'booking_amendment:outbound': 'booking_confirmation_shared',

  // Cancellation (terminal state - order 999)
  'booking_cancellation:inbound': 'booking_cancelled',

  // Documentation from shipper
  'invoice:inbound': 'commercial_invoice_received',
  'commercial_invoice:inbound': 'commercial_invoice_received',
  'packing_list:inbound': 'packing_list_received',

  // SI flow - NOTE: shipping_instruction and si_draft are handled specially
  // by checkSISenderType() to distinguish shipper vs carrier
  // These are fallback mappings:
  'si_draft:outbound': 'si_draft_sent',
  'si_submission:outbound': 'si_submitted',
  'si_confirmation:inbound': 'si_confirmed',
  'si_confirmation:outbound': 'si_confirmed',

  // Checklist flow (export - India CHA)
  'checklist:inbound': 'checklist_received',
  'checklist:outbound': 'checklist_shared',
  'shipping_bill:inbound': 'shipping_bill_received',
  'leo_copy:inbound': 'shipping_bill_received',
  'bill_of_entry:inbound': 'customs_import_filed',

  // VGM
  'vgm_submission:inbound': 'vgm_confirmed',
  'vgm_submission:outbound': 'vgm_submitted',
  'vgm_confirmation:inbound': 'vgm_confirmed',
  'vgm_reminder:inbound': 'vgm_pending',

  // Gate-in & SOB
  'gate_in_confirmation:inbound': 'container_gated_in',
  'sob_confirmation:inbound': 'sob_received',

  // Departure
  'departure_notice:inbound': 'vessel_departed',
  'sailing_confirmation:inbound': 'vessel_departed',

  // ===== IN_TRANSIT =====
  // ISF (US import)
  'isf_submission:outbound': 'isf_filed',
  'isf_confirmation:inbound': 'isf_confirmed',
  'isf_filing:inbound': 'isf_filed',

  // MBL Draft (Proforma BL from carrier - INBOUND)
  'mbl_draft:inbound': 'mbl_draft_received',
  'bill_of_lading:inbound': 'mbl_draft_received',

  // HBL Draft (Intoglo creates and sends - OUTBOUND)
  'hbl_draft:outbound': 'hbl_draft_sent',
  'hbl_release:outbound': 'hbl_released',
  'bill_of_lading:outbound': 'hbl_released',
  'house_bl:outbound': 'hbl_released',

  // Invoice
  'freight_invoice:outbound': 'invoice_sent',
  'freight_invoice:inbound': 'commercial_invoice_received',
  'invoice:outbound': 'invoice_sent',
  'payment_confirmation:inbound': 'invoice_paid',

  // ===== PRE_ARRIVAL (US Customs) =====
  // From Customs Broker (INBOUND)
  'draft_entry:inbound': 'entry_draft_received',       // Broker sends draft for review
  'entry_summary:inbound': 'entry_filed',              // Broker files 7501
  // Shared with Customer (OUTBOUND)
  'draft_entry:outbound': 'entry_draft_shared',        // Intoglo shares draft with customer
  'entry_summary:outbound': 'entry_summary_shared',    // Intoglo shares 7501 with customer

  // ===== ARRIVAL =====
  'arrival_notice:inbound': 'arrival_notice_received',
  'arrival_notice:outbound': 'arrival_notice_shared',
  'shipment_notice:inbound': 'arrival_notice_received',

  // Customs Clearance
  'customs_clearance:inbound': 'customs_cleared',
  'customs_clearance:outbound': 'customs_cleared',
  'customs_document:inbound': 'duty_invoice_received',
  'duty_invoice:inbound': 'duty_invoice_received',
  'duty_invoice:outbound': 'duty_summary_shared',
  'customs_document:outbound': 'duty_summary_shared',
  'duty_summary:outbound': 'duty_summary_shared',

  // Exam/Hold
  'exam_notice:inbound': 'customs_hold',

  // Delivery Order
  'delivery_order:inbound': 'delivery_order_received',
  'delivery_order:outbound': 'delivery_order_shared',

  // ===== DELIVERY =====
  'container_release:inbound': 'container_released',
  'dispatch_notice:inbound': 'out_for_delivery',
  'delivery_confirmation:inbound': 'delivered',
  'pod:inbound': 'pod_received',
  'proof_of_delivery:inbound': 'pod_received',
  'empty_return:inbound': 'empty_returned',
  'empty_return_confirmation:inbound': 'empty_returned',

  // Certificates (generic document receipt)
  'certificate:inbound': 'documents_received',
};

export type WorkflowPhase = 'pre_departure' | 'in_transit' | 'pre_arrival' | 'arrival' | 'delivery';

export interface WorkflowState {
  id: string;
  phase: WorkflowPhase;
  state_code: string;
  state_name: string;
  state_order: number;
  requires_document_types: string[] | null;
  expected_direction: 'inbound' | 'outbound' | 'internal' | null;
  next_states: string[] | null;
  is_optional: boolean;
  is_milestone: boolean;
  description: string | null;
}

export interface WorkflowTransition {
  id: string;
  shipment_id: string;
  from_state: string | null;
  to_state: string;
  triggered_by_document_type: string | null;
  triggered_by_email_id: string | null;
  triggered_by_user_id: string | null;
  transition_notes: string | null;
  created_at: string;
}

export interface TransitionResult {
  success: boolean;
  from_state: string | null;
  to_state: string;
  transition_id?: string;
  error?: string;
}

export interface ShipmentWorkflowStatus {
  shipment_id: string;
  current_state: string | null;
  current_phase: WorkflowPhase | null;
  state_name: string | null;
  progress_percentage: number;
  next_states: WorkflowState[];
  is_complete: boolean;
}

export class WorkflowStateService {
  private statesCache: Map<string, WorkflowState> = new Map();
  private statesByPhase: Map<WorkflowPhase, WorkflowState[]> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Get current workflow status for a shipment
   */
  async getShipmentWorkflowStatus(shipmentId: string): Promise<ShipmentWorkflowStatus> {
    // Get shipment
    const { data: shipment, error } = await this.supabase
      .from('shipments')
      .select('id, workflow_state, workflow_phase')
      .eq('id', shipmentId)
      .single();

    if (error || !shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    await this.ensureCacheValid();

    const currentState = shipment.workflow_state
      ? this.statesCache.get(shipment.workflow_state)
      : null;

    const nextStates = currentState?.next_states
      ? await this.getStatesFromCodes(currentState.next_states)
      : await this.getInitialStates();

    const progress = this.calculateProgress(currentState ?? null);

    return {
      shipment_id: shipmentId,
      current_state: shipment.workflow_state,
      current_phase: shipment.workflow_phase as WorkflowPhase | null,
      state_name: currentState?.state_name || null,
      progress_percentage: progress,
      next_states: nextStates,
      is_complete: shipment.workflow_state === 'pod_received' ||
                   shipment.workflow_state === 'shipment_closed' ||
                   shipment.workflow_state === 'booking_cancelled',
    };
  }

  /**
   * Transition shipment to a new workflow state
   */
  async transitionTo(
    shipmentId: string,
    newStateCode: string,
    options: {
      triggered_by_email_id?: string;
      triggered_by_document_type?: string;
      triggered_by_user_id?: string;
      notes?: string;
      skip_validation?: boolean;
    } = {}
  ): Promise<TransitionResult> {
    await this.ensureCacheValid();

    // Get current shipment state
    const { data: shipment, error: shipmentError } = await this.supabase
      .from('shipments')
      .select('id, workflow_state, workflow_phase')
      .eq('id', shipmentId)
      .single();

    if (shipmentError || !shipment) {
      return {
        success: false,
        from_state: null,
        to_state: newStateCode,
        error: 'Shipment not found',
      };
    }

    const currentStateCode = shipment.workflow_state;
    const newState = this.statesCache.get(newStateCode);

    if (!newState) {
      return {
        success: false,
        from_state: currentStateCode,
        to_state: newStateCode,
        error: `Invalid state: ${newStateCode}`,
      };
    }

    // Validate transition (unless explicitly skipped)
    if (!options.skip_validation) {
      const validationError = this.validateTransition(currentStateCode, newStateCode);
      if (validationError) {
        return {
          success: false,
          from_state: currentStateCode,
          to_state: newStateCode,
          error: validationError,
        };
      }
    }

    // Create transition record
    const { data: transition, error: transitionError } = await this.supabase
      .from('shipment_workflow_history')
      .insert({
        shipment_id: shipmentId,
        from_state: currentStateCode,
        to_state: newStateCode,
        triggered_by_document_type: options.triggered_by_document_type,
        triggered_by_email_id: options.triggered_by_email_id,
        triggered_by_user_id: options.triggered_by_user_id,
        transition_notes: options.notes,
      })
      .select('id')
      .single();

    if (transitionError) {
      return {
        success: false,
        from_state: currentStateCode,
        to_state: newStateCode,
        error: `Failed to create transition record: ${transitionError.message}`,
      };
    }

    // Update shipment state
    const updateData: Record<string, unknown> = {
      workflow_state: newStateCode,
      workflow_phase: newState.phase,
      workflow_state_updated_at: new Date().toISOString(),
    };

    // Special handling: If transitioning to booking_cancelled, also update status
    if (newStateCode === 'booking_cancelled') {
      updateData.status = 'cancelled';
    }

    const { error: updateError } = await this.supabase
      .from('shipments')
      .update(updateData)
      .eq('id', shipmentId);

    if (updateError) {
      return {
        success: false,
        from_state: currentStateCode,
        to_state: newStateCode,
        error: `Failed to update shipment: ${updateError.message}`,
      };
    }

    return {
      success: true,
      from_state: currentStateCode,
      to_state: newStateCode,
      transition_id: transition.id,
    };
  }

  /**
   * Force set workflow state (for backfill operations)
   * Bypasses all validation and forward-only checks.
   * Use with caution - only for data migration/backfill.
   */
  async forceSetState(
    shipmentId: string,
    newStateCode: string,
    options: {
      triggered_by_email_id?: string;
      triggered_by_document_type?: string;
      notes?: string;
    } = {}
  ): Promise<TransitionResult> {
    await this.ensureCacheValid();

    const newState = this.statesCache.get(newStateCode);
    if (!newState) {
      return {
        success: false,
        from_state: null,
        to_state: newStateCode,
        error: `Invalid state: ${newStateCode}`,
      };
    }

    // Get current state for logging
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('workflow_state')
      .eq('id', shipmentId)
      .single();

    const currentStateCode = shipment?.workflow_state;

    // Skip history for backfill to avoid clutter
    // Just update the shipment directly
    const updateData: Record<string, unknown> = {
      workflow_state: newStateCode,
      workflow_phase: newState.phase,
      workflow_state_updated_at: new Date().toISOString(),
    };

    // Special handling: If transitioning to booking_cancelled, also update status
    if (newStateCode === 'booking_cancelled') {
      updateData.status = 'cancelled';
    }

    const { error: updateError } = await this.supabase
      .from('shipments')
      .update(updateData)
      .eq('id', shipmentId);

    if (updateError) {
      return {
        success: false,
        from_state: currentStateCode,
        to_state: newStateCode,
        error: `Failed to update shipment: ${updateError.message}`,
      };
    }

    return {
      success: true,
      from_state: currentStateCode,
      to_state: newStateCode,
    };
  }

  /**
   * Auto-transition based on document type and email direction
   * Direction-aware: INBOUND (from external) vs OUTBOUND (from Intoglo)
   *
   * Special handling for SI documents:
   * - SI from shipper/client → si_draft_received
   * - SI confirmation from carrier → si_confirmed
   */
  async autoTransitionFromDocument(
    shipmentId: string,
    documentType: string,
    emailId: string
  ): Promise<TransitionResult | null> {
    await this.ensureCacheValid();

    // Determine email direction and sender
    const direction = await this.getEmailDirection(emailId);
    const senderEmail = await this.getEmailSender(emailId);

    // Special handling for SI documents - check sender type
    const siDocTypes = ['shipping_instruction', 'si_draft', 'si_submission'];
    if (siDocTypes.includes(documentType) && direction === 'inbound') {
      const mappedState = this.getSIStateFromSender(documentType, senderEmail);
      if (mappedState) {
        return await this.tryTransitionToState(shipmentId, mappedState, emailId, documentType, direction);
      }
    }

    // Try direction-aware mapping first
    const mappingKey = `${documentType}:${direction}`;
    const mappedState = DIRECTION_WORKFLOW_MAPPING[mappingKey];

    if (mappedState) {
      // Check if this state exists and is forward progression
      const targetState = this.statesCache.get(mappedState);
      if (targetState) {
        const { data: shipment } = await this.supabase
          .from('shipments')
          .select('workflow_state')
          .eq('id', shipmentId)
          .single();

        const currentStateCode = shipment?.workflow_state;
        const currentState = currentStateCode ? this.statesCache.get(currentStateCode) : null;
        const currentOrder = currentState?.state_order || 0;

        // Only transition if it's forward progression
        if (targetState.state_order > currentOrder) {
          return await this.transitionTo(shipmentId, mappedState, {
            triggered_by_email_id: emailId,
            triggered_by_document_type: documentType,
            notes: `Auto-transitioned from ${documentType} (${direction})`,
            skip_validation: true,
          });
        }
      }
    }

    // Fallback: Find states that can be triggered by this document type with matching direction
    const matchingStates: WorkflowState[] = [];
    for (const state of this.statesCache.values()) {
      if (state.requires_document_types?.includes(documentType)) {
        // Match direction if specified
        if (!state.expected_direction || state.expected_direction === direction) {
          matchingStates.push(state);
        }
      }
    }

    if (matchingStates.length === 0) {
      return null; // No auto-transition for this document type
    }

    // Get current state
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('workflow_state')
      .eq('id', shipmentId)
      .single();

    const currentStateCode = shipment?.workflow_state;
    const currentState = currentStateCode ? this.statesCache.get(currentStateCode) : null;
    const currentOrder = currentState?.state_order || 0;

    // Find the next valid state that this document can trigger
    const validNextStates = matchingStates
      .filter(s => s.state_order > currentOrder) // Must be forward progression
      .sort((a, b) => a.state_order - b.state_order);

    if (validNextStates.length === 0) {
      return null; // No forward progression possible
    }

    // Transition to the next appropriate state
    return await this.transitionTo(shipmentId, validNextStates[0].state_code, {
      triggered_by_email_id: emailId,
      triggered_by_document_type: documentType,
      notes: `Auto-transitioned from ${documentType} (${direction})`,
      skip_validation: true,
    });
  }

  /**
   * Get email direction from persisted field or calculate from sender.
   * Uses persisted email_direction if available, otherwise calculates.
   *
   * OUTBOUND = sender is @intoglo.com or @intoglo.in (direct, not via group)
   * INBOUND = all other senders (carriers, partners, clients, group forwards)
   */
  private async getEmailDirection(emailId: string): Promise<'inbound' | 'outbound'> {
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('email_direction, sender_email')
      .eq('id', emailId)
      .single();

    // Use persisted direction if available
    if (email?.email_direction) {
      return email.email_direction as 'inbound' | 'outbound';
    }

    // Fallback to calculating from sender
    return detectDirection(email?.sender_email);
  }

  /**
   * Get sender email address for an email
   */
  private async getEmailSender(emailId: string): Promise<string | null> {
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('sender_email')
      .eq('id', emailId)
      .single();

    return email?.sender_email || null;
  }

  /**
   * Determine the correct workflow state for SI documents based on sender type.
   *
   * SI FLOW:
   * - SI from shipper/client (non-carrier) → si_draft_received
   * - SI submission confirmation from carrier → si_confirmed
   */
  private getSIStateFromSender(documentType: string, senderEmail: string | null): string | null {
    const fromCarrier = isCarrierSender(senderEmail);

    // si_submission is always a confirmation from carrier
    if (documentType === 'si_submission') {
      return 'si_confirmed';
    }

    // shipping_instruction or si_draft
    if (fromCarrier) {
      // Carrier sending SI confirmation/notification → si_confirmed
      return 'si_confirmed';
    } else {
      // Shipper/client sending SI draft → si_draft_received
      return 'si_draft_received';
    }
  }

  /**
   * Helper to try transitioning to a mapped state with forward-only check
   */
  private async tryTransitionToState(
    shipmentId: string,
    targetStateCode: string,
    emailId: string,
    documentType: string,
    direction: string
  ): Promise<TransitionResult | null> {
    const targetState = this.statesCache.get(targetStateCode);
    if (!targetState) return null;

    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('workflow_state')
      .eq('id', shipmentId)
      .single();

    const currentStateCode = shipment?.workflow_state;
    const currentState = currentStateCode ? this.statesCache.get(currentStateCode) : null;
    const currentOrder = currentState?.state_order || 0;

    // Only transition if it's forward progression
    if (targetState.state_order > currentOrder) {
      return await this.transitionTo(shipmentId, targetStateCode, {
        triggered_by_email_id: emailId,
        triggered_by_document_type: documentType,
        notes: `Auto-transitioned from ${documentType} (${direction})`,
        skip_validation: true,
      });
    }

    return null;
  }

  /**
   * Get workflow history for a shipment
   */
  async getWorkflowHistory(shipmentId: string): Promise<WorkflowTransition[]> {
    const { data, error } = await this.supabase
      .from('shipment_workflow_history')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch workflow history: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get all valid next states from current state
   */
  async getValidTransitions(currentStateCode: string | null): Promise<WorkflowState[]> {
    await this.ensureCacheValid();

    if (!currentStateCode) {
      return this.getInitialStates();
    }

    const currentState = this.statesCache.get(currentStateCode);
    if (!currentState?.next_states) {
      return [];
    }

    return this.getStatesFromCodes(currentState.next_states);
  }

  /**
   * Check if a state can be skipped (for optional states)
   */
  async canSkipState(stateCode: string): Promise<boolean> {
    await this.ensureCacheValid();
    const state = this.statesCache.get(stateCode);
    return state?.is_optional || false;
  }

  /**
   * Get all states in a phase
   */
  async getStatesInPhase(phase: WorkflowPhase): Promise<WorkflowState[]> {
    await this.ensureCacheValid();
    return this.statesByPhase.get(phase) || [];
  }

  /**
   * Initialize workflow for a new shipment
   */
  async initializeWorkflow(
    shipmentId: string,
    initialState?: string
  ): Promise<TransitionResult> {
    const stateCode = initialState || 'booking_confirmation_received';

    return await this.transitionTo(shipmentId, stateCode, {
      notes: 'Workflow initialized',
      skip_validation: true,
    });
  }

  /**
   * Validate transition is allowed
   */
  private validateTransition(
    currentStateCode: string | null,
    newStateCode: string
  ): string | null {
    // If no current state, only allow initial states
    if (!currentStateCode) {
      if (newStateCode !== 'booking_confirmation_received') {
        return 'Workflow must start with booking_confirmation_received';
      }
      return null;
    }

    const currentState = this.statesCache.get(currentStateCode);
    const newState = this.statesCache.get(newStateCode);

    if (!currentState) {
      return `Current state not found: ${currentStateCode}`;
    }

    if (!newState) {
      return `Target state not found: ${newStateCode}`;
    }

    // Check if new state is in the allowed next_states
    if (!currentState.next_states?.includes(newStateCode)) {
      // Allow skipping to any future state if intermediate states are optional
      if (newState.state_order > currentState.state_order) {
        const canSkipIntermediate = this.canSkipIntermediateStates(
          currentState.state_order,
          newState.state_order
        );
        if (canSkipIntermediate) {
          return null;
        }
      }

      return `Cannot transition from ${currentStateCode} to ${newStateCode}. Valid transitions: ${currentState.next_states?.join(', ') || 'none'}`;
    }

    // Prevent backward transitions
    if (newState.state_order < currentState.state_order) {
      return 'Cannot transition to an earlier state';
    }

    return null;
  }

  /**
   * Check if intermediate states can be skipped
   */
  private canSkipIntermediateStates(fromOrder: number, toOrder: number): boolean {
    for (const state of this.statesCache.values()) {
      if (state.state_order > fromOrder && state.state_order < toOrder) {
        if (!state.is_optional) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Calculate progress percentage
   */
  private calculateProgress(currentState: WorkflowState | null): number {
    if (!currentState) return 0;

    // Final/terminal states = 100%
    if (currentState.state_code === 'shipment_closed' ||
        currentState.state_code === 'pod_received' ||
        currentState.state_code === 'booking_cancelled') return 100;

    // Based on state order (10-245 range)
    const minOrder = 10;
    const maxOrder = 245;
    const progress = ((currentState.state_order - minOrder) / (maxOrder - minOrder)) * 100;

    return Math.round(Math.min(Math.max(progress, 0), 100));
  }

  /**
   * Get initial states (for new shipments)
   */
  private getInitialStates(): WorkflowState[] {
    const initial = this.statesCache.get('booking_confirmation_received');
    return initial ? [initial] : [];
  }

  /**
   * Get state objects from codes
   */
  private async getStatesFromCodes(codes: string[]): Promise<WorkflowState[]> {
    return codes
      .map(code => this.statesCache.get(code))
      .filter((s): s is WorkflowState => s !== undefined);
  }

  /**
   * Load and cache all workflow states
   */
  private async loadStates(): Promise<void> {
    const { data, error } = await this.supabase
      .from('shipment_workflow_states')
      .select('*')
      .order('state_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to load workflow states: ${error.message}`);
    }

    this.statesCache.clear();
    this.statesByPhase.clear();

    for (const state of data || []) {
      this.statesCache.set(state.state_code, state);

      const phaseStates = this.statesByPhase.get(state.phase) || [];
      phaseStates.push(state);
      this.statesByPhase.set(state.phase, phaseStates);
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
  }

  /**
   * Ensure cache is valid
   */
  private async ensureCacheValid(): Promise<void> {
    if (Date.now() >= this.cacheExpiry || this.statesCache.size === 0) {
      await this.loadStates();
    }
  }

  /**
   * Force cache refresh
   */
  async refreshCache(): Promise<void> {
    await this.loadStates();
  }
}
