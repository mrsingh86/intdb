import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get a new shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, etd, eta')
    .eq('booking_number', '263375454')
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('Shipment:', shipment.booking_number);
  console.log('ETD in DB:', shipment.etd);
  console.log('ETA in DB:', shipment.eta);
  console.log('Created from email:', shipment.created_from_email_id);

  // Get the source email
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, received_at, body_text')
    .eq('id', shipment.created_from_email_id)
    .single();

  if (email) {
    console.log('\n=== SOURCE EMAIL ===');
    console.log('Subject:', email.subject);
    console.log('Received:', email.received_at);
    console.log('\nBody (first 1000 chars):');
    console.log(email.body_text?.substring(0, 1000));
  }

  // Check PDF attachment
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text')
    .eq('email_id', shipment.created_from_email_id);

  if (attachments?.length) {
    console.log('\n=== PDF ATTACHMENTS ===');
    for (const att of attachments) {
      console.log('File:', att.filename);
      console.log('Extracted text (first 1500 chars):');
      console.log(att.extracted_text?.substring(0, 1500) || 'NO TEXT EXTRACTED');
    }
  }

  // Check entity extractions
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, confidence_score')
    .eq('email_id', shipment.created_from_email_id);

  if (entities?.length) {
    console.log('\n=== EXTRACTED ENTITIES ===');
    for (const e of entities) {
      console.log(e.entity_type + ':', e.entity_value, '(' + e.confidence_score + '%)');
    }
  }
}
main().catch(console.error);
