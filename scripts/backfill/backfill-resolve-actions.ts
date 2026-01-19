/**
 * Backfill script to resolve pending actions that have confirmations
 *
 * This fixes the gap where confirmations arrived but didn't trigger resolution
 * due to code path issues (now fixed in chronicle-service.ts)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Same resolution map as in chronicle-repository.ts
const resolutionMap: Record<string, string[]> = {
  // Pre-shipment confirmations
  'vgm_confirmation': ['vgm', 'verified gross mass', 'evgm'],
  'si_confirmation': ['si', 'shipping instruction', 'shipping instructions'],
  'si_submitted': ['si', 'shipping instruction', 'shipping instructions'],
  'sob_confirmation': ['shipped', 'on board', 'sob'],
  'booking_confirmation': ['booking', 'book'],
  'leo_copy': ['leo', 'let export', 'let export order'],
  'shipping_bill': ['shipping bill', 'sb copy', 'sb number'],
  // US Customs & Compliance
  'isf_filing': ['isf', 'importer security filing', '10+2'],
  'customs_entry': ['customs entry', 'entry filing', 'customs clearance'],
  'entry_summary': ['entry summary', 'customs entry'],
  // BL confirmations
  'draft_bl': ['bl draft', 'draft bl', 'draft bill'],
  'final_bl': ['release bl', 'bl release', 'share bl', 'provide bl', 'bill of lading', 'final bl'],
  'telex_release': ['release bl', 'bl release', 'telex', 'express release'],
  'sea_waybill': ['sea waybill', 'seaway', 'swb'],
  // Destination confirmations
  'arrival_notice': ['arrival', 'arrive'],
  'container_release': ['container release', 'pickup'],
  'delivery_order': ['delivery order', 'do release'],
  'pod_proof_of_delivery': ['proof of delivery', 'pod', 'delivered'],
};

async function backfillResolveActions() {
  console.log('=== Backfill: Resolve Pending Actions ===\n');

  // Get all pending actions
  const { data: pendingActions, error: actionsError } = await supabase
    .from('chronicle')
    .select('id, shipment_id, action_description, occurred_at')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null);

  if (actionsError) {
    console.error('Error fetching pending actions:', actionsError);
    return;
  }

  console.log(`Found ${pendingActions?.length || 0} pending actions\n`);

  // Get all confirmation documents
  const confirmationTypes = Object.keys(resolutionMap);
  const { data: confirmations, error: confError } = await supabase
    .from('chronicle')
    .select('id, shipment_id, document_type, occurred_at')
    .in('document_type', confirmationTypes)
    .not('shipment_id', 'is', null);

  if (confError) {
    console.error('Error fetching confirmations:', confError);
    return;
  }

  console.log(`Found ${confirmations?.length || 0} confirmation documents\n`);

  // Build map of shipment -> confirmations
  type Conf = { id: string; shipment_id: string; document_type: string; occurred_at: string };
  const confByShipment = new Map<string, Conf[]>();
  for (const c of (confirmations || []) as Conf[]) {
    if (!confByShipment.has(c.shipment_id)) confByShipment.set(c.shipment_id, []);
    confByShipment.get(c.shipment_id)!.push(c);
  }

  // Process each pending action
  let resolved = 0;
  let skipped = 0;
  const toResolve: { id: string; resolvedAt: string; reason: string }[] = [];

  for (const action of (pendingActions || [])) {
    const shipmentConfs = confByShipment.get(action.shipment_id);
    if (!shipmentConfs || shipmentConfs.length === 0) {
      skipped++;
      continue;
    }

    const actionDesc = (action.action_description || '').toLowerCase();
    const actionDate = new Date(action.occurred_at);

    // Find matching confirmation that arrived AFTER action
    for (const conf of shipmentConfs) {
      const confDate = new Date(conf.occurred_at);
      if (confDate < actionDate) continue; // Confirmation before action

      const keywords = resolutionMap[conf.document_type] || [];
      const matches = keywords.some(kw => actionDesc.includes(kw.toLowerCase()));

      if (matches) {
        toResolve.push({
          id: action.id,
          resolvedAt: conf.occurred_at,
          reason: `${conf.document_type} arrived ${confDate.toISOString()}`
        });
        break;
      }
    }
  }

  console.log(`Actions to resolve: ${toResolve.length}`);
  console.log(`Actions skipped (no matching confirmation): ${skipped}\n`);

  if (toResolve.length === 0) {
    console.log('No actions to resolve. Done!');
    return;
  }

  // Show what will be resolved
  console.log('Preview (first 10):');
  for (const item of toResolve.slice(0, 10)) {
    console.log(`  - ${item.id}: ${item.reason}`);
  }

  // Perform updates
  console.log('\nResolving actions...');
  for (const item of toResolve) {
    const { error } = await supabase
      .from('chronicle')
      .update({ action_completed_at: item.resolvedAt })
      .eq('id', item.id);

    if (error) {
      console.error(`Failed to resolve ${item.id}:`, error.message);
    } else {
      resolved++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Resolved: ${resolved}`);
  console.log(`Failed: ${toResolve.length - resolved}`);
}

backfillResolveActions();
