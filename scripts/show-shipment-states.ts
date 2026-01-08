import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DOC_TO_STATE: Record<string, { state: string; phase: string }> = {
  booking_confirmation: { state: 'booking_confirmed', phase: 'booking' },
  booking_amendment: { state: 'booking_amended', phase: 'booking' },
  shipping_instruction: { state: 'si_submitted', phase: 'pre_departure' },
  si_draft: { state: 'si_draft_sent', phase: 'pre_departure' },
  vgm_confirmation: { state: 'vgm_submitted', phase: 'pre_departure' },
  gate_in_confirmation: { state: 'container_gated_in', phase: 'pre_departure' },
  bill_of_lading: { state: 'bl_received', phase: 'pre_departure' },
  sob_confirmation: { state: 'departed', phase: 'in_transit' },
  shipment_notice: { state: 'departed', phase: 'in_transit' },
  arrival_notice: { state: 'arrival_notice_received', phase: 'arrival' },
  delivery_order: { state: 'delivery_order_received', phase: 'arrival' },
  proof_of_delivery: { state: 'delivered', phase: 'delivery' },
};

async function main() {
  const bookingNumber = process.argv[2] || 'COSU6440918980';

  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase')
    .ilike('booking_number', `%${bookingNumber}%`)
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('SHIPMENT: ' + shipment.booking_number);
  console.log('Current State: ' + shipment.workflow_state + ' / ' + shipment.workflow_phase);
  console.log('='.repeat(70));

  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('document_type, email_id, raw_emails!shipment_documents_email_id_fkey(received_at, subject)')
    .eq('shipment_id', shipment.id);

  // Build state transitions
  const transitions: Array<{ date: string; time: string; state: string; phase: string; docType: string; subject: string }> = [];

  for (const d of docs || []) {
    const email = (d as any).raw_emails;
    const mapping = DOC_TO_STATE[d.document_type];

    if (email?.received_at && mapping) {
      const dt = new Date(email.received_at);
      transitions.push({
        date: dt.toISOString().split('T')[0],
        time: dt.toTimeString().substring(0, 5),
        state: mapping.state,
        phase: mapping.phase,
        docType: d.document_type,
        subject: (email.subject || '').substring(0, 40)
      });
    }
  }

  // Sort by date/time
  transitions.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // Show FIRST occurrence of each state only (ignore duplicates from RE:/FW: threads)
  console.log('');
  console.log('STATE JOURNEY (first occurrence only):');
  console.log('');

  const seenStates = new Set<string>();
  const skippedDuplicates: Array<{ state: string; date: string; docType: string }> = [];

  for (const t of transitions) {
    if (!seenStates.has(t.state)) {
      console.log(t.date + ' ' + t.time + ' | ' + t.phase.toUpperCase().padEnd(14) + ' | ' + t.state);
      console.log('                    ← ' + t.docType + ': ' + t.subject);
      console.log('');
      seenStates.add(t.state);
    } else {
      skippedDuplicates.push({ state: t.state, date: t.date, docType: t.docType });
    }
  }

  // Show skipped duplicates summary
  if (skippedDuplicates.length > 0) {
    console.log('-'.repeat(70));
    console.log(`Skipped ${skippedDuplicates.length} duplicate state(s) from RE:/FW: threads:`);
    for (const dup of skippedDuplicates) {
      console.log(`  - ${dup.date}: ${dup.state} (${dup.docType})`);
    }
    console.log('');
  }

  console.log('='.repeat(70));
  console.log('FINAL STATE: ' + shipment.workflow_state + ' / ' + shipment.workflow_phase);
}

main().catch(console.error);
