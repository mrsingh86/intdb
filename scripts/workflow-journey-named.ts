/**
 * Workflow Journey with Named States
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function workflowJourneyNamed() {
  const stateNames: Record<string, string> = {
    'booking_confirmation_received': 'BOOKING',
    'booking_confirmed': 'BOOKING',
    'invoice_received': 'INVOICE',
    'packing_received': 'PACKING',
    'si_draft_received': 'SI_DRAFT',
    'si_confirmed': 'SI_CONF',
    'vgm_confirmed': 'VGM',
    'hbl_draft_sent': 'HBL_DRAFT',
    'hbl_released': 'HBL_RELEASED',
    'arrival_notice_received': 'ARRIVAL',
    'customs_received': 'CUSTOMS',
    'delivery_ordered': 'DELIVERY',
    'pod_received': 'POD'
  };

  const stateOrder: Record<string, number> = {
    'booking_confirmation_received': 1,
    'booking_confirmed': 1,
    'invoice_received': 2,
    'packing_received': 3,
    'si_draft_received': 4,
    'si_confirmed': 5,
    'vgm_confirmed': 6,
    'hbl_draft_sent': 7,
    'hbl_released': 8,
    'arrival_notice_received': 9,
    'customs_received': 10,
    'delivery_ordered': 11,
    'pod_received': 12
  };

  const orderToState: Record<number, string> = {
    1: 'BOOKING',
    2: 'INVOICE',
    3: 'PACKING',
    4: 'SI_DRAFT',
    5: 'SI_CONF',
    6: 'VGM',
    7: 'HBL_DRAFT',
    8: 'HBL_REL',
    9: 'ARRIVAL',
    10: 'CUSTOMS',
    11: 'DELIVERY',
    12: 'POD'
  };

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('                    WORKFLOW JOURNEY WITH STATE NAMES');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .order('created_at', { ascending: false });

  console.log('BOOKING #'.padEnd(25) + '│ STATES PASSED → CURRENT STATE');
  console.log('─'.repeat(25) + '┼' + '─'.repeat(80));

  for (const ship of shipments || []) {
    const currentState = ship.workflow_state || 'booking_confirmation_received';
    const currentOrder = stateOrder[currentState] || 1;
    const currentName = stateNames[currentState] || currentState;

    // Build journey string with state names
    const passedStates: string[] = [];
    for (let i = 1; i < currentOrder; i++) {
      passedStates.push(orderToState[i]);
    }

    let journeyStr = '';
    if (passedStates.length > 0) {
      journeyStr = passedStates.join(' → ') + ' → ';
    }
    journeyStr += `[${currentName}]`;

    const bookingNum = (ship.booking_number || 'N/A').substring(0, 23).padEnd(25);
    console.log(bookingNum + '│ ' + journeyStr);
  }

  console.log('─'.repeat(25) + '┴' + '─'.repeat(80));

  // Summary by current state
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY BY CURRENT STATE');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');

  const stateCounts: Record<string, number> = {};
  for (const ship of shipments || []) {
    const state = stateNames[ship.workflow_state] || ship.workflow_state || 'UNKNOWN';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  }

  const total = shipments?.length || 1;
  const sortedStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);

  for (const [state, count] of sortedStates) {
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`  ${state.padEnd(15)} │ ${String(count).padStart(3)} (${String(pct).padStart(2)}%) ${bar}`);
  }

  console.log('');
  console.log(`TOTAL: ${total} shipments`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
}

workflowJourneyNamed().catch(console.error);
