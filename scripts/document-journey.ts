/**
 * Document State Journey - Shows document progression for all shipments
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function documentJourney() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('DOCUMENT STATE JOURNEY - ALL SHIPMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  // Document stages in order
  const stages = ['BKG', 'INV', 'PKG', 'SI', 'VGM', 'BL', 'ARR', 'CUS', 'DEL'];

  // Map document types to stages
  const docToStage: Record<string, string> = {
    'booking_confirmation': 'BKG',
    'booking_request': 'BKG',
    'booking_amendment': 'BKG',
    'commercial_invoice': 'INV',
    'proforma_invoice': 'INV',
    'invoice': 'INV',
    'tax_invoice': 'INV',
    'packing_list': 'PKG',
    'si_draft': 'SI',
    'shipping_instruction': 'SI',
    'si_submission': 'SI',
    'bl_instruction': 'SI',
    'sob_confirmation': 'SI',
    'checklist': 'SI',
    'forwarding_note': 'SI',
    'vgm_confirmation': 'VGM',
    'vgm_submission': 'VGM',
    'bl_draft': 'BL',
    'hbl_draft': 'BL',
    'bill_of_lading': 'BL',
    'bl_released': 'BL*',
    'hbl_released': 'BL*',
    'telex_release': 'BL*',
    'arrival_notice': 'ARR',
    'customs_clearance': 'CUS',
    'customs_document': 'CUS',
    'isf_filing': 'CUS',
    'duty_entry': 'CUS',
    'delivery_order': 'DEL',
    'pod_confirmation': 'DEL',
    'pickup_notification': 'DEL',
    'delivery_coordination': 'DEL',
  };

  // Get all shipments with their documents
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .order('created_at', { ascending: false });

  console.log('Legend: BKG=Booking | INV=Invoice | PKG=Packing | SI=Shipping Instr | VGM=VGM | BL=Bill of Lading | ARR=Arrival | CUS=Customs | DEL=Delivery');
  console.log('        ✓ = Document received | ★ = BL Released | · = Not received\n');

  console.log('BOOKING NUMBER'.padEnd(30) + '| ' + stages.map(s => s.padEnd(4)).join('| ') + '| WORKFLOW STATE');
  console.log('─'.repeat(30) + '┼' + stages.map(() => '─'.repeat(5)).join('┼') + '┼' + '─'.repeat(25));

  for (const ship of shipments || []) {
    // Get document lifecycle for this shipment
    const { data: docs } = await supabase
      .from('document_lifecycle')
      .select('document_type')
      .eq('shipment_id', ship.id);

    const docTypes = docs?.map(d => d.document_type) || [];

    // Build stage status
    const stageStatus: Record<string, string> = {};
    for (const docType of docTypes) {
      const stage = docToStage[docType];
      if (stage) {
        if (stage === 'BL*') {
          stageStatus['BL'] = '★';  // Released
        } else if (stageStatus[stage] !== '★') {
          stageStatus[stage] = '✓';
        }
      }
    }

    // Build row
    const row = stages.map(s => {
      const status = stageStatus[s] || '·';
      return status.padEnd(4);
    }).join('| ');

    console.log((ship.booking_number || 'N/A').substring(0, 28).padEnd(30) + '| ' + row + '| ' + (ship.workflow_state || ''));
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════════════');

  // Summary
  const { data: allDocs } = await supabase.from('document_lifecycle').select('document_type, shipment_id');

  // Count unique shipments per stage
  const shipmentsByStage: Record<string, Set<string>> = {};
  for (const stage of stages) {
    shipmentsByStage[stage] = new Set();
  }

  for (const d of allDocs || []) {
    let stage = docToStage[d.document_type];
    if (stage === 'BL*') stage = 'BL';
    if (stage && shipmentsByStage[stage]) {
      shipmentsByStage[stage].add(d.shipment_id);
    }
  }

  const totalShipments = shipments?.length || 1;

  console.log('\nDOCUMENT COVERAGE SUMMARY (shipments with at least one document in stage):');
  console.log('─'.repeat(60));
  for (const stage of stages) {
    const count = shipmentsByStage[stage].size;
    const pct = Math.round((count / totalShipments) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5));
    console.log('  ' + stage.padEnd(5) + ': ' + String(count).padStart(4) + '/' + totalShipments + ' (' + String(pct).padStart(3) + '%) ' + bar);
  }

  // Workflow state distribution
  console.log('\nWORKFLOW STATE DISTRIBUTION:');
  console.log('─'.repeat(60));
  const stateCounts: Record<string, number> = {};
  for (const ship of shipments || []) {
    const state = ship.workflow_state || 'unknown';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  }
  for (const [state, count] of Object.entries(stateCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / totalShipments) * 100);
    console.log('  ' + state.padEnd(30) + ': ' + String(count).padStart(4) + ' (' + String(pct).padStart(3) + '%)');
  }
}

documentJourney().catch(console.error);
