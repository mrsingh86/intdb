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

export type WorkflowPhase = 'pre_departure' | 'in_transit' | 'arrival' | 'delivery';

export interface WorkflowState {
  id: string;
  phase: WorkflowPhase;
  state_code: string;
  state_name: string;
  state_order: number;
  requires_document_types: string[] | null;
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
      is_complete: shipment.workflow_state === 'pod_received',
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
    const { error: updateError } = await this.supabase
      .from('shipments')
      .update({
        workflow_state: newStateCode,
        workflow_phase: newState.phase,
        workflow_state_updated_at: new Date().toISOString(),
      })
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
   * Auto-transition based on received document type
   */
  async autoTransitionFromDocument(
    shipmentId: string,
    documentType: string,
    emailId: string
  ): Promise<TransitionResult | null> {
    await this.ensureCacheValid();

    // Find states that can be triggered by this document type
    const matchingStates: WorkflowState[] = [];
    for (const state of this.statesCache.values()) {
      if (state.requires_document_types?.includes(documentType)) {
        matchingStates.push(state);
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
      notes: `Auto-transitioned from ${documentType}`,
      skip_validation: true, // Document-triggered transitions bypass normal validation
    });
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

    // Final state = 100%
    if (currentState.state_code === 'pod_received') return 100;

    // Based on state order (10-150 range)
    const minOrder = 10;
    const maxOrder = 150;
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
