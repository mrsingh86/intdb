/**
 * Check why incomplete shipments have no attachments
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  console.log('CHECKING ATTACHMENT STATUS FOR INCOMPLETE SHIPMENTS');
  console.log('═'.repeat(60));
  console.log('');

  const bookings = ['263042012', '263077531', '94295687', 'HLCUDE1251207123', '15902716'];

  for (const bkg of bookings) {
    console.log('─'.repeat(60));
    console.log('Booking:', bkg);

    const { data: ship } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bkg)
      .single();

    if (!ship) {
      console.log('  NOT FOUND');
      continue;
    }

    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', ship.id);

    const emailId = docs?.[0]?.email_id;
    if (!emailId) {
      console.log('  NO LINKED EMAIL');
      continue;
    }

    const { data: email } = await supabase
      .from('raw_emails')
      .select('gmail_message_id, has_attachments, body_text, snippet, subject')
      .eq('id', emailId)
      .single();

    console.log('  Email ID:', emailId.substring(0, 8) + '...');
    console.log('  Gmail ID:', email?.gmail_message_id);
    console.log('  Subject:', email?.subject?.substring(0, 50));
    console.log('  has_attachments flag:', email?.has_attachments);
    console.log('  body_text length:', email?.body_text?.length || 0);

    // Check attachments table
    const { data: atts, count } = await supabase
      .from('raw_attachments')
      .select('id, filename, mime_type, extracted_text', { count: 'exact' })
      .eq('email_id', emailId);

    console.log('  Attachments in DB:', count);

    if (atts && atts.length > 0) {
      for (const att of atts) {
        console.log('    -', att.filename, '|', att.mime_type, '| extracted:', att.extracted_text ? 'YES' : 'NO');
      }
    }
    console.log('');
  }

  // Check a COMPLETE shipment for comparison
  console.log('═'.repeat(60));
  console.log('COMPARISON: A COMPLETE SHIPMENT');
  console.log('═'.repeat(60));

  // Get a shipment with voyage data
  const { data: completeShip } = await supabase
    .from('shipments')
    .select('id, booking_number, vessel_name, etd')
    .not('vessel_name', 'is', null)
    .not('etd', 'is', null)
    .limit(1)
    .single();

  if (completeShip) {
    console.log('Booking:', completeShip.booking_number);
    console.log('Vessel:', completeShip.vessel_name);
    console.log('ETD:', completeShip.etd);

    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', completeShip.id)
      .limit(1);

    const emailId = docs?.[0]?.email_id;
    if (emailId) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('gmail_message_id, has_attachments, body_text, snippet')
        .eq('id', emailId)
        .single();

      console.log('  has_attachments flag:', email?.has_attachments);
      console.log('  body_text length:', email?.body_text?.length || 0);

      const { count } = await supabase
        .from('raw_attachments')
        .select('*', { count: 'exact', head: true })
        .eq('email_id', emailId);

      console.log('  Attachments in DB:', count);
    }
  }
}

check().catch(console.error);
