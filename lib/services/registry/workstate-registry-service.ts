/**
 * Workstate Registry Service
 *
 * Records workflow state transitions as an immutable history log.
 * Enables full journey reconstruction for any shipment.
 *
 * State Flow (typical):
 * booking_received → si_submitted → si_confirmed → draft_bl_issued →
 * bl_released → cargo_loaded → in_transit → arrived → delivered
 *
 * Responsibilities:
 * - Determine new state based on document type received
 * - Record every state transition with full context
 * - Enable state history queries for journey reconstruction
 * - Track what triggered each transition (email, document)
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface WorkstateRegistryInput {
  shipmentId: string;
  documentType: string;
  direction: 'inbound' | 'outbound';
  sourceEmailId: string;
  sourceDocumentId?: string;
  sourceAttachmentId?: string;
  transitionReason?: string;
}

export interface WorkstateRegistryResult {
  success: boolean;
  shipmentId: string;
  previousState: string | null;
  currentState: string;
  transitionRecorded: boolean;
  stateHistoryId?: string;
  error?: string;
}

export interface StateHistoryEntry {
  id: string;
  shipment_id: string;
  previous_state: string | null;
  new_state: string;
  triggered_by_document_type: string;
  triggered_by_email_id: string;
  triggered_by_document_id: string | null;
  triggered_by_attachment_id: string | null;
  transition_reason: string | null;
  direction: string;
  transitioned_at: string;
}

// ============================================================================
// STATE MAPPING
// ============================================================================

/**
 * Maps document type + direction to workflow state
 */
const DOCUMENT_TO_STATE_MAP: Record<string, Record<string, string>> = {
  // Inbound documents (from carrier/external)
  inbound: {
    booking_confirmation: 'booking_confirmed',
    booking_amendment: 'booking_amended',
    si_confirmation: 'si_confirmed',
    draft_bl: 'draft_bl_issued',
    draft_hbl: 'draft_bl_issued',
    final_bl: 'bl_released',
    final_hbl: 'bl_released',
    telex_release: 'telex_released',
    arrival_notice: 'arrived',
    delivery_order: 'delivery_ordered',
    invoice: 'invoiced',
    freight_invoice: 'invoiced',
  },
  // Outbound documents (from us)
  outbound: {
    booking_request: 'booking_requested',
    shipping_instructions: 'si_submitted',
    si_draft: 'si_submitted',
    si_amendment: 'si_amended',
    bl_instructions: 'bl_instructions_sent',
  },
};

/**
 * State progression order (for validation)
 */
const STATE_ORDER: string[] = [
  'pending',
  'booking_requested',
  'booking_confirmed',
  'booking_amended',
  'si_submitted',
  'si_confirmed',
  'si_amended',
  'bl_instructions_sent',
  'draft_bl_issued',
  'bl_released',
  'telex_released',
  'cargo_loaded',
  'departed',
  'in_transit',
  'arrived',
  'delivery_ordered',
  'delivered',
  'invoiced',
  'completed',
];

// ============================================================================
// SERVICE
// ============================================================================

export class WorkstateRegistryService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Record a state transition based on document received
   */
  async recordTransition(input: WorkstateRegistryInput): Promise<WorkstateRegistryResult> {
    try {
      // 1. Get current shipment state
      const { data: shipment } = await this.supabase
        .from('shipments')
        .select('id, workflow_state, status')
        .eq('id', input.shipmentId)
        .single();

      if (!shipment) {
        return {
          success: false,
          shipmentId: input.shipmentId,
          previousState: null,
          currentState: '',
          transitionRecorded: false,
          error: 'Shipment not found',
        };
      }

      const previousState = shipment.workflow_state || shipment.status || 'pending';

      // 2. Determine new state based on document type
      const newState = this.determineNewState(input.documentType, input.direction, previousState);

      // 3. Check if transition is valid/needed
      if (newState === previousState) {
        return {
          success: true,
          shipmentId: input.shipmentId,
          previousState,
          currentState: previousState,
          transitionRecorded: false, // No change needed
        };
      }

      // 4. Record state history (immutable log)
      const { data: historyEntry, error: historyError } = await this.supabase
        .from('workflow_state_history')
        .insert({
          shipment_id: input.shipmentId,
          previous_state: previousState,
          new_state: newState,
          triggered_by_document_type: input.documentType,
          triggered_by_email_id: input.sourceEmailId,
          triggered_by_document_id: input.sourceDocumentId || null,
          triggered_by_attachment_id: input.sourceAttachmentId || null,
          transition_reason: input.transitionReason || `${input.documentType} received`,
          direction: input.direction,
          transitioned_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (historyError) {
        throw new Error(`Failed to record history: ${historyError.message}`);
      }

      // 5. Update shipment's current state
      await this.supabase
        .from('shipments')
        .update({
          workflow_state: newState,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.shipmentId);

      return {
        success: true,
        shipmentId: input.shipmentId,
        previousState,
        currentState: newState,
        transitionRecorded: true,
        stateHistoryId: historyEntry.id,
      };
    } catch (error) {
      console.error('[WorkstateRegistry] Error:', error);
      return {
        success: false,
        shipmentId: input.shipmentId,
        previousState: null,
        currentState: '',
        transitionRecorded: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Determine new state based on document type and direction
   */
  private determineNewState(
    documentType: string,
    direction: 'inbound' | 'outbound',
    currentState: string
  ): string {
    const normalizedDocType = documentType.toLowerCase().replace(/-/g, '_');
    const stateMap = DOCUMENT_TO_STATE_MAP[direction] || {};
    const mappedState = stateMap[normalizedDocType];

    if (!mappedState) {
      // No mapping found - keep current state
      return currentState;
    }

    // Check if new state is a progression (not a regression)
    const currentIndex = STATE_ORDER.indexOf(currentState);
    const newIndex = STATE_ORDER.indexOf(mappedState);

    // Allow transition if:
    // 1. New state is later in the order (progression)
    // 2. Or if it's a special case (amendment can happen at various stages)
    if (newIndex > currentIndex || mappedState.includes('amended')) {
      return mappedState;
    }

    // Already past this state - keep current
    return currentState;
  }

  /**
   * Get state history for a shipment (journey reconstruction)
   */
  async getStateHistory(shipmentId: string): Promise<StateHistoryEntry[]> {
    const { data } = await this.supabase
      .from('workflow_state_history')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('transitioned_at', { ascending: true });

    return data || [];
  }

  /**
   * Get current state for a shipment
   */
  async getCurrentState(shipmentId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('shipments')
      .select('workflow_state, status')
      .eq('id', shipmentId)
      .single();

    return data?.workflow_state || data?.status || null;
  }

  /**
   * Get shipments in a specific state
   */
  async getShipmentsByState(state: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('shipments')
      .select('id')
      .eq('workflow_state', state);

    return data?.map((s) => s.id) || [];
  }

  /**
   * Get state statistics
   */
  async getStateStatistics(): Promise<Record<string, number>> {
    const { data } = await this.supabase.from('shipments').select('workflow_state');

    const stats: Record<string, number> = {};
    for (const shipment of data || []) {
      const state = shipment.workflow_state || 'unknown';
      stats[state] = (stats[state] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get available state transitions from current state
   */
  getAvailableTransitions(currentState: string): string[] {
    const currentIndex = STATE_ORDER.indexOf(currentState);
    if (currentIndex === -1) return STATE_ORDER;
    return STATE_ORDER.slice(currentIndex + 1);
  }

  /**
   * Manually set state (for admin/override purposes)
   */
  async setStateManually(
    shipmentId: string,
    newState: string,
    reason: string
  ): Promise<WorkstateRegistryResult> {
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('workflow_state')
      .eq('id', shipmentId)
      .single();

    const previousState = shipment?.workflow_state || 'unknown';

    // Record in history
    const { data: historyEntry } = await this.supabase
      .from('workflow_state_history')
      .insert({
        shipment_id: shipmentId,
        previous_state: previousState,
        new_state: newState,
        triggered_by_document_type: 'manual_override',
        transition_reason: reason,
        direction: 'inbound',
        transitioned_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // Update shipment
    await this.supabase
      .from('shipments')
      .update({
        workflow_state: newState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipmentId);

    return {
      success: true,
      shipmentId,
      previousState,
      currentState: newState,
      transitionRecorded: true,
      stateHistoryId: historyEntry?.id,
    };
  }
}

// Factory function
export function createWorkstateRegistryService(supabase: SupabaseClient): WorkstateRegistryService {
  return new WorkstateRegistryService(supabase);
}

// Export state constants for external use
export { STATE_ORDER, DOCUMENT_TO_STATE_MAP };
