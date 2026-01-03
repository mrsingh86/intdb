import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function getAllRows<T>(table: string, select: string): Promise<T[]> {
  const allData: T[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allData.push(...(data as T[]));
    offset += limit;

    if (data.length < limit) break;
  }

  return allData;
}

async function analyze() {
  console.log('Fetching all data (with pagination)...\n');

  // Get all linked documents with their classifications
  const linkedDocs = await getAllRows<{ email_id: string; shipment_id: string; document_type: string }>(
    'shipment_documents',
    'email_id, shipment_id, document_type'
  );

  // Get classifications with workflow_state
  const classifications = await getAllRows<{ email_id: string; workflow_state: string | null; document_direction: string | null }>(
    'document_classifications',
    'email_id, workflow_state, document_direction'
  );

  // Build classification lookup
  const classMap = new Map<string, { workflow_state: string | null; direction: string | null }>();
  classifications?.forEach(c => {
    classMap.set(c.email_id, {
      workflow_state: c.workflow_state,
      direction: c.document_direction
    });
  });

  // Count by workflow state
  const stateCounts: Record<string, number> = {};
  const directionCounts = { inbound: 0, outbound: 0, unknown: 0 };
  let noClassification = 0;
  let noWorkflowState = 0;

  linkedDocs?.forEach(doc => {
    const classification = classMap.get(doc.email_id);

    if (!classification) {
      noClassification++;
      return;
    }

    // Count direction
    if (classification.direction === 'inbound') directionCounts.inbound++;
    else if (classification.direction === 'outbound') directionCounts.outbound++;
    else directionCounts.unknown++;

    // Count workflow state
    if (classification.workflow_state) {
      stateCounts[classification.workflow_state] = (stateCounts[classification.workflow_state] || 0) + 1;
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
  console.log('║      CUMULATIVE WORKFLOW STATE DISTRIBUTION (SHIPMENTS)          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Total linked documents: ${linkedDocs?.length || 0}`);
  console.log('');
  console.log('BY DIRECTION:');
  console.log('─'.repeat(55));
  console.log(`  Inbound:             ${directionCounts.inbound.toString().padStart(5)}  (${((directionCounts.inbound / (linkedDocs?.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  Outbound:            ${directionCounts.outbound.toString().padStart(5)}  (${((directionCounts.outbound / (linkedDocs?.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  Unknown:             ${directionCounts.unknown.toString().padStart(5)}`);
  console.log(`  No classification:   ${noClassification.toString().padStart(5)}`);
  console.log('');
  console.log('BY WORKFLOW STATE (grouped by phase):');
  console.log('═'.repeat(55));

  let totalWithState = 0;

  for (const [phase, states] of Object.entries(phases)) {
    const phaseStates = states.filter(s => stateCounts[s]);
    if (phaseStates.length === 0) continue;

    console.log('');
    console.log(`${phase}:`);
    console.log('─'.repeat(55));

    for (const state of states) {
      const count = stateCounts[state] || 0;
      if (count > 0) {
        totalWithState += count;
        console.log(`  ${state.padEnd(35)} ${count.toString().padStart(5)}`);
        delete stateCounts[state]; // Remove from remaining
      }
    }
  }

  // Show any remaining states not in phases
  const remaining = Object.entries(stateCounts).filter(([_, count]) => count > 0);
  if (remaining.length > 0) {
    console.log('');
    console.log('OTHER:');
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
  console.log(`  No classification:       ${noClassification.toString().padStart(5)}`);
}

analyze();
