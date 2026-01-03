import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function analyze() {
  // Get current workflow_state from shipments table
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, status');

  if (error) throw error;

  // Count by workflow_state
  const stateCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  let noWorkflowState = 0;

  shipments?.forEach(s => {
    // Count status
    statusCounts[s.status || 'null'] = (statusCounts[s.status || 'null'] || 0) + 1;

    // Count workflow_state
    if (s.workflow_state) {
      stateCounts[s.workflow_state] = (stateCounts[s.workflow_state] || 0) + 1;
    } else {
      noWorkflowState++;
    }
  });

  // Group states by phase
  const phases: Record<string, string[]> = {
    'PRE-DEPARTURE': [
      'booking_confirmation_received',
      'booking_confirmation_shared',
      'commercial_invoice_received',
      'si_draft_received',
      'si_confirmed',
      'si_draft_sent',
      'hbl_draft_sent'
    ],
    'IN-TRANSIT': [
      'invoice_sent',
      'hbl_released',
      'mbl_released'
    ],
    'ARRIVAL': [
      'arrival_notice_received',
      'arrival_notice_shared',
      'customs_invoice_received',
      'duty_summary_shared',
      'cargo_released'
    ],
    'DELIVERY': [
      'pod_received',
      'pod_shared'
    ]
  };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         CURRENT WORKFLOW STATE OF SHIPMENTS                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Total shipments: ${shipments?.length || 0}`);
  console.log('');
  console.log('BY STATUS (shipments.status):');
  console.log('─'.repeat(55));
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    console.log(`  ${status.padEnd(25)} ${count.toString().padStart(5)}`);
  });

  console.log('');
  console.log('BY WORKFLOW STATE (shipments.workflow_state):');
  console.log('═'.repeat(55));

  let totalWithState = 0;

  for (const [phase, states] of Object.entries(phases)) {
    const phaseStates = states.filter(s => stateCounts[s]);
    if (phaseStates.length === 0) continue;

    const phaseTotal = phaseStates.reduce((sum, s) => sum + (stateCounts[s] || 0), 0);
    console.log('');
    console.log(`${phase}: (${phaseTotal} shipments)`);
    console.log('─'.repeat(55));

    for (const state of states) {
      const count = stateCounts[state] || 0;
      if (count > 0) {
        totalWithState += count;
        console.log(`  ${state.padEnd(35)} ${count.toString().padStart(5)}`);
        delete stateCounts[state];
      }
    }
  }

  // Show any remaining states not in phases
  const remaining = Object.entries(stateCounts).filter(([_, count]) => count > 0);
  if (remaining.length > 0) {
    const otherTotal = remaining.reduce((sum, [_, count]) => sum + count, 0);
    console.log('');
    console.log(`OTHER: (${otherTotal} shipments)`);
    console.log('─'.repeat(55));
    for (const [state, count] of remaining.sort((a, b) => b[1] - a[1])) {
      totalWithState += count;
      console.log(`  ${state.padEnd(35)} ${count.toString().padStart(5)}`);
    }
  }

  console.log('');
  console.log('═'.repeat(55));
  console.log('SUMMARY:');
  console.log('─'.repeat(55));
  console.log(`  With workflow_state:     ${totalWithState.toString().padStart(5)}`);
  console.log(`  No workflow_state:       ${noWorkflowState.toString().padStart(5)}`);
}

analyze();
