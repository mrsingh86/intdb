/**
 * Debug: Check why attachments aren't being found
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debug() {
  const booking = '263042012';

  console.log('DEBUG: Attachment lookup chain');
  console.log('═'.repeat(60));
  console.log('');

  // Step 1: Get shipment
  const { data: ship } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .eq('booking_number', booking)
    .single();

  console.log('1. Shipment ID:', ship?.id);

  // Step 2: Get shipment_documents
  const { data: shipDocs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type')
    .eq('shipment_id', ship?.id);

  console.log('2. shipment_documents entries:', shipDocs?.length);
  for (const sd of shipDocs || []) {
    console.log('   email_id:', sd.email_id, '| type:', sd.document_type);
  }

  const emailId = shipDocs?.[0]?.email_id;
  console.log('');
  console.log('3. Using email_id:', emailId);

  // Step 3: Check raw_emails
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, has_attachments')
    .eq('id', emailId)
    .single();

  console.log('4. raw_emails record:');
  console.log('   id:', email?.id);
  console.log('   gmail_message_id:', email?.gmail_message_id);
  console.log('   has_attachments:', email?.has_attachments);

  // Step 4: Check raw_attachments
  const { data: atts } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename')
    .eq('email_id', emailId);

  console.log('');
  console.log('5. raw_attachments with email_id:', emailId);
  console.log('   Found:', atts?.length || 0);
  for (const a of atts || []) {
    console.log('   -', a.filename);
  }

  // Step 5: Check ALL attachments for this gmail_message_id
  if (email?.gmail_message_id) {
    // Maybe attachments are linked by gmail_message_id not email_id?
    const { data: allAtts } = await supabase
      .from('raw_attachments')
      .select('id, email_id, filename');

    // Find by looking for this email's related attachments
    console.log('');
    console.log('6. Checking if any attachments exist in DB:');

    const { count } = await supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true });

    console.log('   Total attachments in DB:', count);

    // Sample some
    const { data: sample } = await supabase
      .from('raw_attachments')
      .select('email_id, filename')
      .limit(5);

    console.log('   Sample email_ids in raw_attachments:');
    for (const s of sample || []) {
      console.log('   -', s.email_id?.substring(0, 8), '|', s.filename);
    }
  }

  // Step 7: Directly query with the ID we know works
  console.log('');
  console.log('7. Direct query with email_id from check-attachment-status:');

  // From earlier output: Email ID: 8dc9d55a...
  const { data: directAtts } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename')
    .ilike('email_id', '8dc9d55a%');

  console.log('   Found with 8dc9d55a%:', directAtts?.length || 0);
  for (const a of directAtts || []) {
    console.log('   email_id:', a.email_id);
    console.log('   filename:', a.filename);
  }
}

debug().catch(console.error);
