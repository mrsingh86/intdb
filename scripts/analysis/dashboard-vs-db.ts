import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function analyze() {
  // Get actual workflow states from DB
  const { data: shipments } = await supabase
    .from('shipments')
    .select('workflow_state, workflow_phase');

  // Count actual states
  const actualStates: Record<string, number> = {};
  const actualPhases: Record<string, number> = {};

  shipments?.forEach(s => {
    if (s.workflow_state) {
      actualStates[s.workflow_state] = (actualStates[s.workflow_state] || 0) + 1;
    }
    if (s.workflow_phase) {
      actualPhases[s.workflow_phase] = (actualPhases[s.workflow_phase] || 0) + 1;
    }
  });

  // States the dashboard looks for (UPDATED to match page.tsx)
  const dashboardStates = {
    // Pre-departure
    'booking_confirmation_received': 'Booking Rcvd',
    'booking_confirmation_shared': 'Booking Shared',
    'si_draft_received': 'SI Draft Rcvd',
    'si_draft_sent': 'SI Draft Sent',
    'si_confirmed': 'SI Confirmed',
    'mbl_draft_received': 'MBL Draft Rcvd',
    'sob_received': 'SOB Received',
    // In-transit
    'invoice_sent': 'Invoice Sent',
    'hbl_released': 'HBL Released',
    // Arrival
    'arrival_notice_received': 'Arrival Rcvd',
    'arrival_notice_shared': 'Arrival Shared',
    'duty_summary_shared': 'Duty Summary',
    'duty_invoice_received': 'Duty Invoice',
    'cargo_released': 'Cargo Released',
    // Other
    'booking_cancelled': 'Cancelled',
  };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          DASHBOARD vs DATABASE WORKFLOW STATE COMPARISON          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('STATES DASHBOARD EXPECTS vs ACTUAL IN DB:');
  console.log('═'.repeat(70));
  console.log('');
  console.log('State in Dashboard'.padEnd(35) + 'DB Count'.padStart(10) + '  Status');
  console.log('─'.repeat(70));

  let matched = 0;
  let missing = 0;

  for (const [dbState, dashLabel] of Object.entries(dashboardStates)) {
    const count = actualStates[dbState] || 0;
    const status = count > 0 ? '✓ Found' : '✗ Not in DB';
    console.log(`${dbState.padEnd(35)}${count.toString().padStart(10)}  ${status}`);
    if (count > 0) matched++;
    else missing++;
    delete actualStates[dbState];
  }

  console.log('');
  console.log('STATES IN DB BUT NOT IN DASHBOARD:');
  console.log('═'.repeat(70));
  console.log('');

  const notInDashboard = Object.entries(actualStates).sort((a, b) => b[1] - a[1]);
  if (notInDashboard.length === 0) {
    console.log('  (none)');
  } else {
    for (const [state, count] of notInDashboard) {
      console.log(`  ${state.padEnd(35)}${count.toString().padStart(10)}  ← NOT SHOWN`);
    }
  }

  console.log('');
  console.log('PHASE COUNTS (from shipments.workflow_phase):');
  console.log('═'.repeat(70));
  console.log('');
  for (const [phase, count] of Object.entries(actualPhases).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${phase.padEnd(35)}${count.toString().padStart(10)}`);
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('SUMMARY:');
  console.log(`  Dashboard states found in DB:     ${matched}`);
  console.log(`  Dashboard states missing in DB:   ${missing}`);
  console.log(`  DB states not shown in dashboard: ${notInDashboard.length}`);
  console.log('');

  if (notInDashboard.length > 0) {
    console.log('⚠️  WARNING: Some workflow states are NOT visible in the dashboard!');
    console.log('   These shipments have states that the dashboard does not display.');
  }
}

analyze();
