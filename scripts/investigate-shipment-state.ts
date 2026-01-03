import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function investigate() {
  // Get the shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase')
    .eq('booking_number', 'COSU6440918980')
    .single();

  console.log('='.repeat(80));
  console.log('INVESTIGATING: COSU6440918980');
  console.log('='.repeat(80));
  console.log('');
  console.log('Current Workflow State:', shipment?.workflow_state);
  console.log('Current Workflow Phase:', shipment?.workflow_phase);
  console.log('');

  // Get ALL documents for this shipment
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type, created_at')
    .eq('shipment_id', shipment?.id)
    .order('created_at', { ascending: true });

  console.log('=== ALL LINKED DOCUMENTS (' + (docs?.length || 0) + ') ===');

  for (const doc of docs || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email, subject, email_direction, received_at')
      .eq('id', doc.email_id)
      .single();

    console.log('');
    console.log('-'.repeat(60));
    console.log('Doc Type:', doc.document_type);
    console.log('Direction:', email?.email_direction);
    console.log('Sender:', email?.sender_email);
    if (email?.true_sender_email) console.log('True Sender:', email?.true_sender_email);
    console.log('Subject:', (email?.subject || '').substring(0, 100));
    console.log('Received:', email?.received_at);
  }

  // Check shipment events
  const { data: events } = await supabase
    .from('shipment_events')
    .select('event_type, event_data, created_at')
    .eq('shipment_id', shipment?.id)
    .order('created_at', { ascending: true });

  console.log('');
  console.log('=== SHIPMENT EVENTS (' + (events?.length || 0) + ') ===');
  for (const evt of events || []) {
    const data = typeof evt.event_data === 'object' ? JSON.stringify(evt.event_data) : evt.event_data;
    console.log(evt.created_at?.substring(0, 19), '-', evt.event_type, data ? `(${data.substring(0, 50)})` : '');
  }

  // Check if there's an OUTBOUND email that caused the "shared" state
  console.log('');
  console.log('=== CHECKING FOR OUTBOUND EMAILS ===');

  const outboundDocs = [];
  for (const doc of docs || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('email_direction, sender_email, subject')
      .eq('id', doc.email_id)
      .single();

    if (email?.email_direction === 'outbound') {
      outboundDocs.push({ doc, email });
    }
  }

  if (outboundDocs.length > 0) {
    console.log('Found', outboundDocs.length, 'OUTBOUND documents:');
    for (const { doc, email } of outboundDocs) {
      console.log('  -', doc.document_type, ':', email.subject?.substring(0, 60));
    }
    console.log('');
    console.log('CONCLUSION: State is "shared" because there IS an outbound email.');
  } else {
    console.log('NO outbound documents found!');
    console.log('');
    console.log('BUG: State should be "booking_confirmation_received", not "shared"');
  }
}

investigate();
