/**
 * Workflow Journey - Shows how shipments progress through workflow states
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function workflowJourney() {
  // Workflow states in order (left to right progression)
  const workflowStates = [
    'BKG_CONF',   // booking_confirmation_received
    'INV_RCVD',   // invoice_received
    'PKG_RCVD',   // packing_received
    'SI_DRAFT',   // si_draft_received
    'SI_CONF',    // si_confirmed
    'VGM_CONF',   // vgm_confirmed
    'HBL_DRAFT',  // hbl_draft_sent
    'HBL_REL',    // hbl_released
    'ARR_RCVD',   // arrival_notice_received
    'CUS_RCVD',   // customs_received
    'DEL_ORD',    // delivery_ordered
    'POD_RCVD'    // pod_received
  ];

  const stateMap: Record<string, string> = {
    'booking_confirmation_received': 'BKG_CONF',
    'booking_confirmed': 'BKG_CONF',
    'invoice_received': 'INV_RCVD',
    'packing_received': 'PKG_RCVD',
    'si_draft_received': 'SI_DRAFT',
    'si_confirmed': 'SI_CONF',
    'vgm_confirmed': 'VGM_CONF',
    'hbl_draft_sent': 'HBL_DRAFT',
    'hbl_released': 'HBL_REL',
    'arrival_notice_received': 'ARR_RCVD',
    'customs_received': 'CUS_RCVD',
    'delivery_ordered': 'DEL_ORD',
    'pod_received': 'POD_RCVD'
  };

  const stateOrder: Record<string, number> = {
    'BKG_CONF': 1,
    'INV_RCVD': 2,
    'PKG_RCVD': 3,
    'SI_DRAFT': 4,
    'SI_CONF': 5,
    'VGM_CONF': 6,
    'HBL_DRAFT': 7,
    'HBL_REL': 8,
    'ARR_RCVD': 9,
    'CUS_RCVD': 10,
    'DEL_ORD': 11,
    'POD_RCVD': 12
  };

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('                              WORKFLOW STATE JOURNEY - ALL SHIPMENTS');
  console.log('                              Shows progression through workflow states');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Workflow States (in order):');
  console.log('  1.BKG_CONF → 2.INV_RCVD → 3.PKG_RCVD → 4.SI_DRAFT → 5.SI_CONF → 6.VGM_CONF');
  console.log('  → 7.HBL_DRAFT → 8.HBL_REL → 9.ARR_RCVD → 10.CUS_RCVD → 11.DEL_ORD → 12.POD_RCVD');
  console.log('');
  console.log('Legend: [██] = Current State | [░░] = Passed State | [  ] = Not Reached');
  console.log('');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase, created_at')
    .order('created_at', { ascending: false });

  // Header
  const stateHeaders = workflowStates.map(s => s.substring(0, 8).padEnd(9)).join('');
  console.log('BOOKING #'.padEnd(22) + '│ ' + stateHeaders + '│ PHASE');
  console.log('─'.repeat(22) + '┼' + '─'.repeat(workflowStates.length * 9) + '┼' + '─'.repeat(15));

  // Track state counts
  const stateCounts: Record<string, number> = {};
  for (const state of workflowStates) {
    stateCounts[state] = 0;
  }

  for (const ship of shipments || []) {
    const currentState = stateMap[ship.workflow_state] || 'BKG_CONF';
    const currentOrder = stateOrder[currentState] || 1;

    // Build the journey visualization
    const journey = workflowStates.map(state => {
      const order = stateOrder[state];
      if (state === currentState) {
        return '[██]     ';  // Current state
      } else if (order < currentOrder) {
        return '[░░]─────';  // Passed state (with arrow)
      } else {
        return '[  ]     ';  // Not reached
      }
    }).join('');

    // Count current states
    stateCounts[currentState] = (stateCounts[currentState] || 0) + 1;

    const bookingNum = (ship.booking_number || 'N/A').substring(0, 20).padEnd(22);
    const phase = (ship.workflow_phase || '').substring(0, 15);

    console.log(bookingNum + '│ ' + journey + '│ ' + phase);
  }

  console.log('─'.repeat(22) + '┴' + '─'.repeat(workflowStates.length * 9) + '┴' + '─'.repeat(15));

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('WORKFLOW STATE DISTRIBUTION');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const total = shipments?.length || 1;

  // Visual bar chart
  for (const state of workflowStates) {
    const count = stateCounts[state] || 0;
    const pct = Math.round((count / total) * 100);
    const barLength = Math.floor(pct / 2);
    const bar = '█'.repeat(barLength) + '░'.repeat(25 - barLength);
    console.log(`  ${state.padEnd(10)} │ ${bar} │ ${String(count).padStart(3)} (${String(pct).padStart(2)}%)`);
  }

  // Phase distribution
  console.log('');
  console.log('PHASE DISTRIBUTION:');
  console.log('─'.repeat(50));
  const phaseCounts: Record<string, number> = {};
  for (const ship of shipments || []) {
    const phase = ship.workflow_phase || 'unknown';
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
  }

  const phases = ['pre_shipment', 'pre_departure', 'in_transit', 'arrival', 'delivered'];
  for (const phase of phases) {
    const count = phaseCounts[phase] || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`  ${phase.padEnd(15)} │ ${String(count).padStart(3)} (${String(pct).padStart(2)}%) ${bar}`);
  }

  console.log('');
  console.log(`TOTAL SHIPMENTS: ${total}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
}

workflowJourney().catch(console.error);
