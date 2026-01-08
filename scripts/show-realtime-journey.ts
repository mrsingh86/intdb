import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Map document types to workflow states
const DOC_TO_STATE: Record<string, { state: string; phase: string; order: number }> = {
  booking_confirmation: { state: 'booking_confirmed', phase: 'booking', order: 10 },
  booking_amendment: { state: 'booking_amended', phase: 'booking', order: 15 },
  shipping_instruction: { state: 'si_submitted', phase: 'pre_departure', order: 20 },
  si_draft: { state: 'si_draft_sent', phase: 'pre_departure', order: 22 },
  vgm_confirmation: { state: 'vgm_submitted', phase: 'pre_departure', order: 25 },
  gate_in_confirmation: { state: 'container_gated_in', phase: 'pre_departure', order: 30 },
  hbl_draft: { state: 'hbl_draft_sent', phase: 'pre_departure', order: 35 },
  bill_of_lading: { state: 'bl_received', phase: 'pre_departure', order: 40 },
  sob_confirmation: { state: 'departed', phase: 'in_transit', order: 50 },
  shipment_notice: { state: 'departed', phase: 'in_transit', order: 50 },
  isf_filing: { state: 'isf_filed', phase: 'in_transit', order: 55 },
  arrival_notice: { state: 'arrival_notice_received', phase: 'arrival', order: 60 },
  entry_summary: { state: 'customs_cleared', phase: 'arrival', order: 65 },
  delivery_order: { state: 'delivery_order_received', phase: 'arrival', order: 70 },
  container_release: { state: 'container_released', phase: 'delivery', order: 75 },
  proof_of_delivery: { state: 'delivered', phase: 'delivery', order: 80 },
};

async function showRealtimeJourney(): Promise<void> {
  // Get shipments in arrival phase
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase, created_at')
    .eq('workflow_phase', 'arrival')
    .limit(5);

  console.log('='.repeat(80));
  console.log('REAL-TIME WORKFLOW JOURNEY (based on email received_at)');
  console.log('='.repeat(80));

  for (const s of shipments || []) {
    console.log('\n' + '─'.repeat(80));
    console.log('SHIPMENT:', s.booking_number);
    console.log('Current:', s.workflow_state, '/', s.workflow_phase);
    console.log('─'.repeat(80));

    // Get all linked documents with email received_at
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select(`
        document_type,
        email_id,
        raw_emails!inner(received_at, subject, sender_email, true_sender_email)
      `)
      .eq('shipment_id', s.id);

    // Build timeline from email received_at
    const timeline: Array<{
      datetime: string;
      date: string;
      time: string;
      docType: string;
      state: string;
      phase: string;
      order: number;
      sender: string;
      subject: string;
    }> = [];

    for (const d of docs || []) {
      const email = (d as any).raw_emails;
      const mapping = DOC_TO_STATE[d.document_type];

      if (email?.received_at) {
        const dt = new Date(email.received_at);
        timeline.push({
          datetime: email.received_at,
          date: dt.toISOString().split('T')[0],
          time: dt.toTimeString().substring(0, 5),
          docType: d.document_type,
          state: mapping?.state || d.document_type,
          phase: mapping?.phase || 'unknown',
          order: mapping?.order || 99,
          sender: (email.true_sender_email || email.sender_email || '').split('@')[0],
          subject: (email.subject || '').substring(0, 40),
        });
      }
    }

    // Sort by actual received datetime
    timeline.sort((a, b) => a.datetime.localeCompare(b.datetime));

    // Show real-time progression with state changes
    console.log('\nReal-Time Document Flow:');
    console.log('');

    let currentState = '';
    let currentPhase = '';

    for (const t of timeline) {
      const stateChanged = t.state !== currentState;
      const phaseChanged = t.phase !== currentPhase && t.phase !== 'unknown';

      // Show phase change
      if (phaseChanged && DOC_TO_STATE[t.docType]) {
        console.log('');
        console.log('  ╔══════════════════════════════════════════════════════════════════════╗');
        console.log('  ║ PHASE: ' + t.phase.toUpperCase().padEnd(62) + '║');
        console.log('  ╚══════════════════════════════════════════════════════════════════════╝');
        currentPhase = t.phase;
      }

      // Show document with state
      const stateMarker = stateChanged && DOC_TO_STATE[t.docType] ? ' ★' : '';
      console.log(
        '  ' + t.date + ' ' + t.time +
        ' │ ' + t.docType.padEnd(25) +
        ' │ ' + t.sender.substring(0, 15).padEnd(15) +
        stateMarker
      );

      if (stateChanged && DOC_TO_STATE[t.docType]) {
        currentState = t.state;
      }
    }

    // Show final state summary
    console.log('\n  ─────────────────────────────────────────────────────────────────────────');
    console.log('  Final State: ' + s.workflow_state + ' / ' + s.workflow_phase);
    console.log('  Documents: ' + timeline.length);
  }
}

showRealtimeJourney().catch(console.error);
