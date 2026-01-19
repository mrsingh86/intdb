/**
 * ActionAutoResolveService
 *
 * Automatically marks actions as completed when their resolution event occurs.
 * Uses the action_auto_resolve_on field from action_templates.
 *
 * Example: When vgm_confirmation arrives, all pending actions with
 * action_auto_resolve_on containing 'vgm_confirmation' are marked complete.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface AutoResolveResult {
  shipmentId: string;
  triggerDocumentType: string;
  resolvedCount: number;
  resolvedActions: string[];
}

export class ActionAutoResolveService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Called when a new document is processed for a shipment.
   * Checks if this document type should auto-resolve any pending actions.
   */
  async resolveActionsForDocument(
    shipmentId: string,
    documentType: string
  ): Promise<AutoResolveResult> {
    const result: AutoResolveResult = {
      shipmentId,
      triggerDocumentType: documentType,
      resolvedCount: 0,
      resolvedActions: [],
    };

    if (!shipmentId || !documentType) {
      return result;
    }

    // Find all pending actions for this shipment where action_auto_resolve_on contains this document type
    const { data: pendingActions, error: fetchError } = await this.supabase
      .from('chronicle')
      .select('id, action_description, action_auto_resolve_on')
      .eq('shipment_id', shipmentId)
      .eq('has_action', true)
      .is('action_completed_at', null)
      .not('action_auto_resolve_on', 'is', null);

    if (fetchError || !pendingActions || pendingActions.length === 0) {
      return result;
    }

    // Filter actions where action_auto_resolve_on array contains this document type
    const actionsToResolve = pendingActions.filter(action => {
      const resolveOn = action.action_auto_resolve_on;
      if (!Array.isArray(resolveOn)) return false;
      return resolveOn.some(trigger =>
        trigger.toLowerCase() === documentType.toLowerCase() ||
        documentType.toLowerCase().includes(trigger.toLowerCase()) ||
        trigger.toLowerCase().includes(documentType.toLowerCase())
      );
    });

    if (actionsToResolve.length === 0) {
      return result;
    }

    // Mark these actions as completed
    const actionIds = actionsToResolve.map(a => a.id);
    const now = new Date().toISOString();

    const { error: updateError } = await this.supabase
      .from('chronicle')
      .update({
        action_completed_at: now,
        action_completed_by: 'auto_resolve',
        action_resolution_note: `Auto-resolved by ${documentType} received`,
      })
      .in('id', actionIds);

    if (updateError) {
      console.error('[ActionAutoResolve] Error updating actions:', updateError);
      return result;
    }

    result.resolvedCount = actionsToResolve.length;
    result.resolvedActions = actionsToResolve.map(a => a.action_description || 'Unknown action');

    console.log(`[ActionAutoResolve] Resolved ${result.resolvedCount} actions for shipment ${shipmentId} triggered by ${documentType}`);

    return result;
  }

  /**
   * Batch process: Check all pending actions across shipments and resolve
   * those where the trigger document already exists.
   * Used for backfilling/cleanup.
   */
  async resolveAllPendingActions(limit: number = 1000): Promise<{
    totalResolved: number;
    shipmentsSummary: Record<string, number>;
  }> {
    // Get all pending actions with auto_resolve_on set
    const { data: pendingActions, error } = await this.supabase
      .from('chronicle')
      .select('id, shipment_id, action_description, action_auto_resolve_on')
      .eq('has_action', true)
      .is('action_completed_at', null)
      .not('action_auto_resolve_on', 'is', null)
      .not('shipment_id', 'is', null)
      .limit(limit);

    if (error || !pendingActions) {
      console.error('[ActionAutoResolve] Error fetching pending actions:', error);
      return { totalResolved: 0, shipmentsSummary: {} };
    }

    console.log(`[ActionAutoResolve] Found ${pendingActions.length} pending actions with auto_resolve_on`);

    // Group by shipment
    const byShipment: Record<string, typeof pendingActions> = {};
    for (const action of pendingActions) {
      if (!action.shipment_id) continue;
      if (!byShipment[action.shipment_id]) byShipment[action.shipment_id] = [];
      byShipment[action.shipment_id].push(action);
    }

    const shipmentsSummary: Record<string, number> = {};
    let totalResolved = 0;

    // For each shipment, check what document types exist
    for (const [shipmentId, actions] of Object.entries(byShipment)) {
      // Get all document types that exist for this shipment
      const { data: existingDocs } = await this.supabase
        .from('chronicle')
        .select('document_type')
        .eq('shipment_id', shipmentId)
        .not('document_type', 'is', null);

      const existingDocTypes = new Set(
        (existingDocs || []).map(d => d.document_type?.toLowerCase()).filter(Boolean)
      );

      // Find actions that should be resolved
      const actionsToResolve: string[] = [];

      for (const action of actions) {
        const resolveOn = action.action_auto_resolve_on;
        if (!Array.isArray(resolveOn)) continue;

        // Check if any trigger document exists
        const shouldResolve = resolveOn.some(trigger => {
          const triggerLower = trigger.toLowerCase();
          return existingDocTypes.has(triggerLower) ||
            Array.from(existingDocTypes).some(docType =>
              docType.includes(triggerLower) || triggerLower.includes(docType)
            );
        });

        if (shouldResolve) {
          actionsToResolve.push(action.id);
        }
      }

      if (actionsToResolve.length > 0) {
        const now = new Date().toISOString();
        const { error: updateError } = await this.supabase
          .from('chronicle')
          .update({
            action_completed_at: now,
            action_completed_by: 'auto_resolve_backfill',
            action_resolution_note: 'Auto-resolved by backfill - trigger document already exists',
          })
          .in('id', actionsToResolve);

        if (!updateError) {
          shipmentsSummary[shipmentId] = actionsToResolve.length;
          totalResolved += actionsToResolve.length;
        }
      }
    }

    console.log(`[ActionAutoResolve] Backfill complete: ${totalResolved} actions resolved across ${Object.keys(shipmentsSummary).length} shipments`);

    return { totalResolved, shipmentsSummary };
  }
}

export function createActionAutoResolveService(supabase: SupabaseClient): ActionAutoResolveService {
  return new ActionAutoResolveService(supabase);
}
