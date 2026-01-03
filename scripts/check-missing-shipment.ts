import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  // Pick a shipment that only has outbound
  const bookingNumber = '263629283';
  
  const { data: ship } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .eq('booking_number', bookingNumber)
    .single();
  
  console.log('=== SHIPMENT:', bookingNumber, '===');
  
  // Get linked documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type')
    .eq('shipment_id', ship.id);
  
  console.log('\nLinked documents:', docs?.length);
  for (const doc of docs || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, email_direction')
      .eq('id', doc.email_id)
      .single();
    console.log(' ', doc.document_type, '|', email?.email_direction, '|', email?.sender_email?.substring(0, 50));
  }
  
  // Search for ANY email with this booking number
  console.log('\n=== SEARCHING FOR INBOUND EMAIL WITH THIS BOOKING NUMBER ===');
  
  const allEmails = await getAllRows<{id: string; subject: string; body_text: string; sender_email: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, subject, body_text, sender_email, email_direction'
  );
  
  const matchingEmails = allEmails.filter(e => {
    const text = (e.subject || '') + ' ' + (e.body_text || '');
    return text.includes(bookingNumber);
  });
  
  console.log('Emails mentioning', bookingNumber + ':', matchingEmails.length);
  matchingEmails.forEach(e => {
    console.log(' ', e.email_direction, '|', e.sender_email?.substring(0, 50));
    console.log('   Subject:', e.subject?.substring(0, 60));
  });
}

check();
