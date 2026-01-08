import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('WORKFLOW STATE AUDIT');
  console.log('='.repeat(70));

  // Issue 1: Shipments with NULL workflow_state
  const { data: nullState } = await supabase
    .from('shipments')
    .select('booking_number')
    .is('workflow_state', null);

  console.log('\n1. Shipments with NULL workflow_state:', nullState?.length || 0);
  for (const s of (nullState || []).slice(0, 5)) {
    console.log('   -', s.booking_number);
  }

  // Issue 2: Shipments with no linked documents
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state');

  // Paginate to get ALL documents (default limit is 1000)
  let allDocs: Array<{ shipment_id: string }> = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: batch } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .range(offset, offset + pageSize - 1);
    if (!batch || batch.length === 0) break;
    allDocs = allDocs.concat(batch);
    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  const shipmentWithDocs = new Set(allDocs.map(d => d.shipment_id));
  const noDocShipments = (allShipments || []).filter(s => !shipmentWithDocs.has(s.id));

  console.log('\n2. Shipments with NO linked documents:', noDocShipments.length);
  for (const s of noDocShipments.slice(0, 5)) {
    console.log('   -', s.booking_number, '| state:', s.workflow_state);
  }

  // Issue 3: Check for unusual state/phase combinations
  const { data: statePhase } = await supabase
    .from('shipments')
    .select('booking_number, workflow_state, workflow_phase');

  const validCombos: Record<string, string[]> = {
    'booking': ['booking_confirmed', 'booking_amended', 'booking_cancelled'],
    'pre_departure': ['si_submitted', 'si_draft_sent', 'vgm_submitted', 'container_gated_in', 'hbl_draft_sent', 'bl_draft_received', 'bl_received'],
    'in_transit': ['departed', 'isf_filed'],
    'arrival': ['arrival_notice_received', 'customs_cleared', 'delivery_order_received', 'container_released'],
    'delivery': ['delivery_scheduled', 'delivered'],
  };

  const invalidCombos: Array<{ booking: string; state: string; phase: string }> = [];
  for (const s of statePhase || []) {
    if (!s.workflow_state || !s.workflow_phase) continue;
    const validStates = validCombos[s.workflow_phase] || [];
    if (!validStates.includes(s.workflow_state)) {
      invalidCombos.push({ booking: s.booking_number, state: s.workflow_state, phase: s.workflow_phase });
    }
  }

  console.log('\n3. Shipments with INVALID state/phase combo:', invalidCombos.length);
  for (const s of invalidCombos.slice(0, 5)) {
    console.log('   -', s.booking, '| state:', s.state, '| phase:', s.phase);
  }

  // Issue 4: Shipments stuck in early phase with old documents
  const { data: earlyPhase } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_phase, created_at')
    .in('workflow_phase', ['booking', 'pre_departure']);

  const stuckShipments: Array<{ booking: string; phase: string; age: number }> = [];
  const now = new Date();
  for (const s of earlyPhase || []) {
    const created = new Date(s.created_at);
    const ageInDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    if (ageInDays > 7) {
      stuckShipments.push({ booking: s.booking_number, phase: s.workflow_phase, age: ageInDays });
    }
  }

  console.log('\n4. Shipments stuck in early phase (> 7 days old):', stuckShipments.length);
  for (const s of stuckShipments.slice(0, 10)) {
    console.log('   -', s.booking, '| phase:', s.phase, '| age:', s.age, 'days');
  }

  // Issue 5: Check document type distribution per phase
  console.log('\n5. Document types by current phase:');

  const phases = ['booking', 'pre_departure', 'in_transit', 'arrival', 'delivery'];
  for (const phase of phases) {
    const { data: phaseShipments } = await supabase
      .from('shipments')
      .select('id')
      .eq('workflow_phase', phase);

    if (!phaseShipments || phaseShipments.length === 0) continue;

    const shipmentIds = phaseShipments.map(s => s.id);
    const { data: phaseDocs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .in('shipment_id', shipmentIds);

    const docTypeCounts: Record<string, number> = {};
    for (const d of phaseDocs || []) {
      docTypeCounts[d.document_type] = (docTypeCounts[d.document_type] || 0) + 1;
    }

    console.log('\n   ' + phase.toUpperCase() + ' (' + phaseShipments.length + ' shipments):');
    const sorted = Object.entries(docTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [docType, count] of sorted) {
      console.log('      ' + docType.padEnd(25) + ': ' + count);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('AUDIT COMPLETE');
}

main().catch(console.error);
