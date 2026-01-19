/**
 * Backfill script to auto-resolve pending actions where the trigger document already exists.
 * Uses the action_auto_resolve_on field from action_templates.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runBackfill() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         ACTION AUTO-RESOLVE BACKFILL                                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Get all pending actions with auto_resolve_on set
  const { data: pendingActions, error } = await supabase
    .from('chronicle')
    .select('id, shipment_id, action_description, action_auto_resolve_on, document_type')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('action_auto_resolve_on', 'is', null)
    .not('shipment_id', 'is', null)
    .limit(2000);

  if (error) {
    console.error('Error fetching pending actions:', error);
    return;
  }

  console.log(`Found ${pendingActions?.length || 0} pending actions with auto_resolve_on set`);
  console.log('');

  if (!pendingActions || pendingActions.length === 0) {
    console.log('No pending actions to process.');
    return;
  }

  // Group by shipment
  const byShipment = {};
  for (const action of pendingActions) {
    if (!action.shipment_id) continue;
    if (!byShipment[action.shipment_id]) byShipment[action.shipment_id] = [];
    byShipment[action.shipment_id].push(action);
  }

  console.log(`Processing ${Object.keys(byShipment).length} shipments...`);
  console.log('');

  let totalResolved = 0;
  const shipmentsSummary = {};

  // For each shipment, check what document types exist
  for (const [shipmentId, actions] of Object.entries(byShipment)) {
    // Get all document types that exist for this shipment
    const { data: existingDocs } = await supabase
      .from('chronicle')
      .select('document_type')
      .eq('shipment_id', shipmentId)
      .not('document_type', 'is', null);

    const existingDocTypes = new Set(
      (existingDocs || []).map(d => d.document_type?.toLowerCase()).filter(Boolean)
    );

    // Find actions that should be resolved
    const actionsToResolve = [];
    const resolutionDetails = [];

    for (const action of actions) {
      const resolveOn = action.action_auto_resolve_on;
      if (!Array.isArray(resolveOn)) continue;

      // Check if any trigger document exists
      let matchedTrigger = null;
      for (const trigger of resolveOn) {
        const triggerLower = trigger.toLowerCase();
        if (existingDocTypes.has(triggerLower)) {
          matchedTrigger = trigger;
          break;
        }
        // Also check partial matches
        for (const docType of existingDocTypes) {
          if (docType.includes(triggerLower) || triggerLower.includes(docType)) {
            matchedTrigger = trigger;
            break;
          }
        }
        if (matchedTrigger) break;
      }

      if (matchedTrigger) {
        actionsToResolve.push(action.id);
        resolutionDetails.push({
          action: action.action_description?.substring(0, 50) || 'Unknown',
          trigger: matchedTrigger
        });
      }
    }

    if (actionsToResolve.length > 0) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
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

        // Show first 3 shipments in detail
        if (Object.keys(shipmentsSummary).length <= 3) {
          console.log(`  Shipment ${shipmentId.substring(0, 8)}... - Resolved ${actionsToResolve.length} actions:`);
          for (const detail of resolutionDetails.slice(0, 3)) {
            console.log(`    - "${detail.action}" resolved by "${detail.trigger}"`);
          }
          if (resolutionDetails.length > 3) {
            console.log(`    ... and ${resolutionDetails.length - 3} more`);
          }
          console.log('');
        }
      } else {
        console.error(`  Error updating shipment ${shipmentId}:`, updateError.message);
      }
    }
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  BACKFILL COMPLETE');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Total Actions Resolved: ${totalResolved}`);
  console.log(`  Shipments Affected: ${Object.keys(shipmentsSummary).length}`);
  console.log('');

  // Show top 10 shipments by resolved count
  const topShipments = Object.entries(shipmentsSummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topShipments.length > 0) {
    console.log('  Top shipments by resolved actions:');
    for (const [shipmentId, count] of topShipments) {
      console.log(`    ${shipmentId.substring(0, 8)}... : ${count} actions`);
    }
  }
  console.log('');
}

runBackfill().catch(console.error);
