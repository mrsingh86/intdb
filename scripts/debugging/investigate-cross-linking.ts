import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get a wrongly linked doc - the one with BKG 263736244
  const { data: wrongDoc } = await supabase
    .from('raw_emails')
    .select('id, subject, thread_id, body_text')
    .ilike('subject', '%263736244%')
    .single();

  if (!wrongDoc) {
    console.log('Doc not found');
    return;
  }

  console.log('WRONG DOC EMAIL:');
  console.log('Email ID:', wrongDoc.id);
  console.log('Subject:', wrongDoc.subject);
  console.log('Thread ID:', wrongDoc.thread_id);

  // Check shipment_link_candidates for this email
  const { data: candidates } = await supabase
    .from('shipment_link_candidates')
    .select('*')
    .eq('email_id', wrongDoc.id);

  console.log('');
  console.log('LINK CANDIDATES for this email:');
  if (!candidates || candidates.length === 0) {
    console.log('  (none found - document was linked directly, not via candidates)');
  }
  for (const c of candidates || []) {
    const { data: ship } = await supabase
      .from('shipments')
      .select('booking_number')
      .eq('id', c.shipment_id)
      .single();
    console.log('  Shipment:', ship?.booking_number, '| Match:', c.match_type, '| Confidence:', c.confidence_score);
  }

  // Check if thread has emails that DO contain 263814897
  console.log('');
  console.log('OTHER EMAILS IN SAME THREAD:');
  const { data: threadEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, received_at')
    .eq('thread_id', wrongDoc.thread_id)
    .order('received_at', { ascending: true })
    .limit(15);

  for (const e of threadEmails || []) {
    const has263814897 = e.subject?.includes('263814897') ? '  ✓ HAS 263814897' : '';
    console.log('  ', e.subject?.slice(0, 60), has263814897);
  }

  // Check shipment_documents to see HOW it was linked
  console.log('');
  console.log('HOW WAS IT LINKED?');
  const { data: shipDoc } = await supabase
    .from('shipment_documents')
    .select('id, shipment_id, document_type, created_at, shipments(booking_number)')
    .eq('email_id', wrongDoc.id);

  for (const sd of shipDoc || []) {
    const ship = (sd as any).shipments;
    console.log('  Linked to:', ship?.booking_number, '| Type:', sd.document_type, '| At:', sd.created_at);
  }

  // Check entity_extractions for this email
  console.log('');
  console.log('ENTITY EXTRACTIONS:');
  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, confidence_score')
    .eq('email_id', wrongDoc.id);

  for (const ext of extractions || []) {
    console.log('  ', ext.entity_type, ':', ext.entity_value, '(', ext.confidence_score, ')');
  }
}

main().catch(console.error);
