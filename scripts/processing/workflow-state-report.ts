import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// State order - shipments at higher states have passed through lower states
const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 35,
  'si_confirmed': 40,
  'vgm_submitted': 50,
  'vgm_confirmed': 55,
  'container_gated_in': 58,
  'sob_received': 60,
  'vessel_departed': 65,
  'isf_filed': 70,
  'isf_confirmed': 75,
  'mbl_draft_received': 80,
  'hbl_draft_sent': 85,
  'hbl_released': 90,
  'invoice_sent': 95,
  'invoice_paid': 100,
  'arrival_notice_received': 110,
  'arrival_notice_shared': 115,
  'entry_draft_received': 120,
  'entry_filed': 125,
  'duty_invoice_received': 130,
  'duty_summary_shared': 135,
  'customs_cleared': 140,
  'delivery_order_received': 150,
  'cargo_released': 160,
  'out_for_delivery': 180,
  'delivered': 190,
  'pod_received': 200,
  'empty_returned': 210,
  'booking_cancelled': 999,
};

async function report() {
  console.log('========================================================================');
  console.log('                 WORKFLOW STATE DISTRIBUTION REPORT                     ');
  console.log('========================================================================\n');

  const shipments = await getAllRows<{id: string; booking_number: string; workflow_state: string}>(
    supabase, 'shipments', 'id, booking_number, workflow_state'
  );

  console.log('Total Shipments:', shipments.length, '\n');

  // Current state distribution
  const currentCounts: Record<string, number> = {};
  shipments.forEach(s => {
    const state = s.workflow_state || 'null';
    currentCounts[state] = (currentCounts[state] || 0) + 1;
  });

  // Calculate cumulative - for each state, count shipments AT or PAST that state
  const cumulativeCounts: Record<string, number> = {};

  for (const [state, order] of Object.entries(STATE_ORDER)) {
    let count = 0;
    for (const ship of shipments) {
      const shipOrder = STATE_ORDER[ship.workflow_state] || 0;
      if (ship.workflow_state === 'booking_cancelled') {
        if (order <= 15) count++;
      } else if (shipOrder >= order) {
        count++;
      }
    }
    cumulativeCounts[state] = count;
  }

  // Table header
  console.log('State                                Current   Cumulative   % Reached');
  console.log('------------------------------------------------------------------------');

  const sortedStates = Object.entries(STATE_ORDER).sort((a, b) => a[1] - b[1]);

  let lastPhase = '';
  for (const [state, order] of sortedStates) {
    const current = currentCounts[state] || 0;
    const cumulative = cumulativeCounts[state] || 0;
    const percent = ((cumulative / shipments.length) * 100).toFixed(1);

    if (cumulative === 0 && current === 0) continue;

    // Phase headers
    if (order === 10) {
      console.log('\n--- PRE-DEPARTURE ---');
    } else if (order === 80) {
      console.log('\n--- IN-TRANSIT ---');
    } else if (order === 110) {
      console.log('\n--- ARRIVAL ---');
    } else if (order === 200) {
      console.log('\n--- DELIVERY ---');
    }

    const stateStr = state.padEnd(36);
    const currentStr = current.toString().padStart(7);
    const cumulativeStr = cumulative.toString().padStart(12);
    const percentStr = (percent + '%').padStart(11);

    console.log(stateStr + currentStr + cumulativeStr + percentStr);
  }

  // Visual funnel
  console.log('\n========================================================================');
  console.log('                          SHIPMENT FUNNEL                               ');
  console.log('========================================================================\n');

  const keyStates = [
    ['booking_confirmation_received', 'Booking Received (from carrier)'],
    ['booking_confirmation_shared', 'Booking Shared (to client)'],
    ['si_confirmed', 'SI Confirmed'],
    ['sob_received', 'Shipped on Board'],
    ['hbl_released', 'HBL Released'],
    ['invoice_sent', 'Invoice Sent'],
    ['arrival_notice_shared', 'Arrival Notice Shared'],
    ['cargo_released', 'Cargo Released'],
    ['pod_received', 'POD Received'],
  ];

  for (const [state, label] of keyStates) {
    const cumulative = cumulativeCounts[state] || 0;
    const percent = (cumulative / shipments.length) * 100;
    const barLength = Math.round(percent / 2.5);
    const bar = '#'.repeat(barLength);
    const labelStr = label.padEnd(32);
    console.log(labelStr + ' ' + bar.padEnd(40) + ' ' + cumulative + ' (' + percent.toFixed(0) + '%)');
  }

  // Current state breakdown
  console.log('\n========================================================================');
  console.log('                     CURRENT STATE BREAKDOWN                            ');
  console.log('========================================================================\n');

  const statesByCount = Object.entries(currentCounts).sort((a, b) => b[1] - a[1]);

  for (const [state, count] of statesByCount) {
    console.log(state + ': ' + count + ' shipments');
    const shipmentsInState = shipments.filter(s => s.workflow_state === state);
    shipmentsInState.slice(0, 3).forEach(s => {
      console.log('  - ' + s.booking_number);
    });
    if (shipmentsInState.length > 3) {
      console.log('  ... and ' + (shipmentsInState.length - 3) + ' more');
    }
    console.log('');
  }
}

report();
