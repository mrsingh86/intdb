import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function checkWorkflowPhase() {
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase, status');

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  // Count by workflow_phase
  const phaseCounts: Record<string, number> = {};
  const stateToPhaseMap: Record<string, Set<string>> = {};

  shipments?.forEach(s => {
    const phase = s.workflow_phase || 'NULL';
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;

    // Track which states map to which phases
    if (s.workflow_state) {
      if (!stateToPhaseMap[s.workflow_state]) {
        stateToPhaseMap[s.workflow_state] = new Set();
      }
      stateToPhaseMap[s.workflow_state].add(phase);
    }
  });

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          WORKFLOW_PHASE COLUMN VALUES                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Counts by workflow_phase:');
  console.log('─'.repeat(55));
  Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]).forEach(([phase, count]) => {
    console.log(`  ${phase.padEnd(25)} ${count.toString().padStart(5)}`);
  });

  console.log('');
  console.log('State → Phase mapping:');
  console.log('─'.repeat(55));
  Object.entries(stateToPhaseMap).forEach(([state, phases]) => {
    console.log(`  ${state.padEnd(35)} → ${[...phases].join(', ')}`);
  });

  // Show some examples with arrival phase
  const arrivalShipments = shipments?.filter(s => s.workflow_phase === 'arrival') || [];
  console.log('');
  console.log(`Arrival phase shipments: ${arrivalShipments.length}`);
  if (arrivalShipments.length > 0) {
    console.log('First 5:');
    arrivalShipments.slice(0, 5).forEach(s => {
      console.log(`  ${s.booking_number}: state=${s.workflow_state}`);
    });
  }
}

checkWorkflowPhase();
