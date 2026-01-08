import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Map document types to workflow states for visualization
const DOC_TO_STATE: Record<string, string> = {
  booking_confirmation: 'booking_confirmed',
  booking_amendment: 'booking_amended',
  shipping_instruction: 'si_submitted',
  si_draft: 'si_draft_sent',
  vgm_confirmation: 'vgm_submitted',
  gate_in_confirmation: 'container_gated_in',
  hbl_draft: 'hbl_draft_sent',
  bill_of_lading: 'bl_received',
  house_bl: 'hbl_received',
  sob_confirmation: 'departed',
  shipment_notice: 'departed',
  isf_filing: 'isf_filed',
  arrival_notice: 'arrival_notice_received',
  entry_summary: 'customs_cleared',
  delivery_order: 'delivery_order_received',
  container_release: 'container_released',
  proof_of_delivery: 'delivered',
  invoice: 'invoice_sent',
};

async function showArrivalJourney(): Promise<void> {
  // Get shipments in arrival phase
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase')
    .eq('workflow_phase', 'arrival');

  console.log('='.repeat(70));
  console.log('SHIPMENTS IN ARRIVAL PHASE:', shipments?.length || 0);
  console.log('='.repeat(70));

  for (const s of (shipments || []).slice(0, 8)) {
    console.log('\n' + '-'.repeat(70));
    console.log('SHIPMENT:', s.booking_number);
    console.log('Current State:', s.workflow_state, '/', s.workflow_phase);
    console.log('-'.repeat(70));

    // Get all linked documents ordered by email received date
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type, email_id')
      .eq('shipment_id', s.id);

    // Get email dates for timeline
    const timeline: Array<{ date: string; docType: string; state: string }> = [];
    for (const d of docs || []) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('received_at')
        .eq('id', d.email_id)
        .single();

      timeline.push({
        date: email?.received_at?.split('T')[0] || 'N/A',
        docType: d.document_type,
        state: DOC_TO_STATE[d.document_type] || d.document_type,
      });
    }

    // Sort by date
    timeline.sort((a, b) => a.date.localeCompare(b.date));

    // Show unique workflow progression
    console.log('\nWorkflow Journey:');
    const seenStates = new Set<string>();
    for (const t of timeline) {
      if (!seenStates.has(t.state)) {
        seenStates.add(t.state);
        console.log('  ' + t.date + ' │ ' + t.state.padEnd(30) + ' ← ' + t.docType);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('WORKFLOW STATES IN ARRIVAL PHASE:');
  console.log('='.repeat(70));

  const stateCounts: Record<string, number> = {};
  for (const s of shipments || []) {
    stateCounts[s.workflow_state] = (stateCounts[s.workflow_state] || 0) + 1;
  }

  for (const [state, count] of Object.entries(stateCounts).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + state + ': ' + count);
  }
}

showArrivalJourney().catch(console.error);
