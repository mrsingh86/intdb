import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Check booking 263325925 - this was showing Mundra/QINGDAO but is a different booking
  const bookingNumber = '263325925';

  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, created_from_email_id')
    .eq('booking_number', bookingNumber)
    .single();

  if (!shipment?.created_from_email_id) {
    console.log('Shipment not found');
    return;
  }

  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject')
    .eq('id', shipment.created_from_email_id)
    .single();

  console.log('Email subject:', email?.subject);

  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text')
    .eq('email_id', shipment.created_from_email_id)
    .ilike('filename', '%.pdf%');

  for (const att of attachments || []) {
    console.log('\n=== PDF:', att.filename, '===\n');

    // Show first 2000 chars
    console.log(att.extracted_text?.substring(0, 2000));

    // Look for specific patterns
    const text = att.extracted_text || '';
    const bookingMatch = text.match(/Booking No\.:\s*(\d+)/);
    const fromMatch = text.match(/From:\s*([^,\n]+)/);
    const toMatch = text.match(/To:\s*([^,\n]+)/);
    const dateMatches = text.match(/20(?:2[4-9]|3\d)-\d{2}-\d{2}/g);

    console.log('\n--- Extracted patterns ---');
    console.log('Booking #:', bookingMatch?.[1]);
    console.log('From:', fromMatch?.[1]);
    console.log('To:', toMatch?.[1]);
    console.log('Dates found:', dateMatches);
  }
}
main().catch(console.error);
