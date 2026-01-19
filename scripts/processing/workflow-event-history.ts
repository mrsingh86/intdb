/**
 * Workflow State Event History for Active Shipments
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              WORKFLOW STATE EVENT HISTORY - ACTIVE SHIPMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status, carrier_name')
    .in('status', ['active', 'booked', 'in_transit'])
    .order('created_at', { ascending: false })
    .limit(100);

  console.log('Active shipments:', shipments?.length || 0);

  if (!shipments?.length) return;

  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('id, shipment_id, email_id, document_type')
    .in('shipment_id', shipments.map(s => s.id));

  console.log('Linked documents:', docs?.length || 0);

  const emailIds = [...new Set(docs?.map(d => d.email_id).filter(Boolean) || [])];

  const { data: classifications } = emailIds.length > 0
    ? await supabase
        .from('document_classifications')
        .select('email_id, document_type, document_direction, workflow_state')
        .in('email_id', emailIds)
    : { data: [] };

  const classMap = new Map(classifications?.map(c => [c.email_id, c]) || []);

  const stateCount: Record<string, number> = {};
  const stateByShipment: Record<string, Set<string>> = {};

  for (const doc of docs || []) {
    const c = classMap.get(doc.email_id);
    const state = c?.workflow_state;
    if (state) {
      stateCount[state] = (stateCount[state] || 0) + 1;
      if (!stateByShipment[doc.shipment_id]) stateByShipment[doc.shipment_id] = new Set();
      stateByShipment[doc.shipment_id].add(state);
    }
  }

  console.log('\n=== WORKFLOW STATES TRIGGERED ===\n');

  const phases: Record<string, string[]> = {
    'PRE-DEPARTURE': ['booking_confirmation_received', 'booking_confirmation_shared', 'commercial_invoice_received', 'si_draft_received', 'si_confirmed', 'hbl_draft_sent'],
    'DEPARTURE': ['sob_received'],
    'IN-TRANSIT': ['invoice_sent', 'hbl_released', 'fmc_filing_received'],
    'ARRIVAL': ['arrival_notice_received', 'arrival_notice_shared', 'customs_invoice_received', 'customs_cleared', 'cargo_released'],
    'DELIVERY': ['pod_received', 'dispatch_received']
  };

  for (const [phase, states] of Object.entries(phases)) {
    const phaseStates = states.filter(s => stateCount[s]);
    if (phaseStates.length > 0) {
      console.log(phase);
      for (const state of phaseStates) {
        console.log('  ' + state.padEnd(35) + (stateCount[state] || 0));
      }
      console.log('');
    }
  }

  console.log('=== SAMPLE SHIPMENT PROGRESSIONS ===\n');

  const shipmentMap = new Map(shipments.map(s => [s.id, s]));
  let shown = 0;

  for (const [shipmentId, states] of Object.entries(stateByShipment)) {
    if (shown >= 15) break;
    const shipment = shipmentMap.get(shipmentId);
    if (shipment && states.size >= 2) {
      console.log(`📦 ${shipment.booking_number} (${shipment.status}) - ${shipment.carrier_name || 'Unknown'}`);
      console.log('   ' + [...states].join(' → '));
      console.log('');
      shown++;
    }
  }

  // Summary stats
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                                 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const shipmentsWithStates = Object.keys(stateByShipment).length;
  const avgStates = shipmentsWithStates > 0
    ? (Object.values(stateByShipment).reduce((sum, s) => sum + s.size, 0) / shipmentsWithStates).toFixed(1)
    : 0;

  console.log(`Shipments with workflow states: ${shipmentsWithStates}/${shipments.length}`);
  console.log(`Average states per shipment: ${avgStates}`);
  console.log(`Total state events: ${Object.values(stateCount).reduce((a, b) => a + b, 0)}`);
}

main().catch(console.error);
