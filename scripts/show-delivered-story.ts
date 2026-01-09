/**
 * Show full story of shipments with delivery-related documents
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Document types that indicate delivery stage
const DELIVERY_DOC_TYPES = [
  'pod_proof_of_delivery',
  'delivery_order',
  'gate_pass',
  'container_release',
  'freight_release'
];

async function main() {
  // Find shipments that have delivery-related documents
  const { data: deliveredChronicles, error: chrErr } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .in('document_type', DELIVERY_DOC_TYPES)
    .not('shipment_id', 'is', null);

  if (chrErr) {
    console.error('Error finding delivered:', chrErr);
    return;
  }

  // Get unique shipment IDs
  const shipmentIds = [...new Set((deliveredChronicles || []).map(c => c.shipment_id))];

  console.log('='.repeat(80));
  console.log('DELIVERED SHIPMENTS - FULL STORY');
  console.log('(Shipments with delivery documents: POD, delivery order, gate pass, etc.)');
  console.log('='.repeat(80));
  console.log(`Found ${shipmentIds.length} shipments with delivery documents\n`);

  if (shipmentIds.length === 0) {
    // Show what document types we have instead
    const { data: docTypes } = await supabase
      .from('chronicle')
      .select('document_type')
      .not('shipment_id', 'is', null);

    const counts: Record<string, number> = {};
    for (const row of docTypes || []) {
      counts[row.document_type] = (counts[row.document_type] || 0) + 1;
    }

    console.log('Available document types in linked chronicle:');
    for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
    return;
  }

  for (const shipmentId of shipmentIds) {
    // Get shipment details
    const { data: ship } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    if (!ship) continue;

    console.log('\n' + '-'.repeat(80));
    console.log(`SHIPMENT: ${ship.intoglo_reference || ship.booking_number || ship.bl_number}`);
    console.log('-'.repeat(80));
    console.log(`  Booking: ${ship.booking_number || '-'}`);
    console.log(`  MBL: ${ship.mbl_number || ship.bl_number || '-'}`);
    console.log(`  SEINUS: ${ship.intoglo_reference || '-'}`);
    console.log(`  Container: ${ship.container_number_primary || '-'}`);
    console.log(`  Vessel: ${ship.vessel_name || '-'} ${ship.voyage_number || ''}`);
    console.log(`  Route: ${ship.pol || ship.origin || '?'} -> ${ship.pod || ship.destination || '?'}`);
    console.log(`  ETD: ${ship.etd || '-'} | ETA: ${ship.eta || '-'}`);

    // Get ALL chronicle entries for this shipment
    const { data: chronicles, error: chrErr2 } = await supabase
      .from('chronicle')
      .select('occurred_at, document_type, message_type, from_party, subject, summary, has_action, action_description, has_issue, issue_type, issue_description, direction')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: true });

    if (chrErr2) {
      console.log(`  Error fetching chronicles: ${chrErr2.message}`);
      continue;
    }

    console.log(`\n  TIMELINE (${chronicles?.length || 0} communications):`);

    for (const c of chronicles || []) {
      const date = new Date(c.occurred_at).toISOString().split('T')[0];
      const arrow = c.direction === 'outbound' ? '->' : '<-';
      const actionFlag = c.has_action ? ' [ACTION]' : '';
      const issueFlag = c.has_issue ? ' [ISSUE]' : '';

      // Highlight delivery documents
      const isDelivery = DELIVERY_DOC_TYPES.includes(c.document_type);
      const marker = isDelivery ? '***' : '   ';

      console.log(`\n${marker}${date} ${arrow} [${c.document_type}]${actionFlag}${issueFlag}`);
      console.log(`    From: ${c.from_party}`);
      console.log(`    Subject: ${(c.subject || '').substring(0, 70)}`);
      console.log(`    Summary: ${c.summary || '-'}`);

      if (c.has_action && c.action_description) {
        console.log(`    ACTION NEEDED: ${c.action_description}`);
      }
      if (c.has_issue && c.issue_description) {
        console.log(`    ISSUE (${c.issue_type}): ${c.issue_description}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
