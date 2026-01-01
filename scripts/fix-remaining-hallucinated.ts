import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const bookings = ['CAD0850107', '263805268'];

  for (const bookingNumber of bookings) {
    console.log('═'.repeat(70));
    console.log(`INVESTIGATING: ${bookingNumber}`);
    console.log('═'.repeat(70));

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      console.log('Shipment not found');
      continue;
    }

    console.log('\nCurrent data:');
    console.log(`  Vessel: ${shipment.vessel_name} / ${shipment.voyage_number}`);
    console.log(`  ETD: ${shipment.etd} ← ${shipment.etd?.startsWith('2023') ? '❌ HALLUCINATED' : ''}`);
    console.log(`  ETA: ${shipment.eta} ← ${shipment.eta?.startsWith('2023') ? '❌ HALLUCINATED' : ''}`);
    console.log(`  SI Cutoff: ${shipment.si_cutoff}`);
    console.log(`  VGM Cutoff: ${shipment.vgm_cutoff}`);
    console.log(`  Cargo Cutoff: ${shipment.cargo_cutoff}`);
    console.log(`  Gate Cutoff: ${shipment.gate_cutoff}`);

    // Check source email
    const emailId = shipment.created_from_email_id;
    if (!emailId) {
      console.log('\n⚠️ No source email linked');
      continue;
    }

    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, received_at, true_sender_email, sender_email')
      .eq('id', emailId)
      .single();

    console.log('\nSource email:');
    console.log(`  Subject: ${email?.subject}`);
    console.log(`  From: ${email?.true_sender_email || email?.sender_email}`);
    console.log(`  Received: ${email?.received_at}`);

    // Check attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, mime_type, extracted_text')
      .eq('email_id', emailId);

    console.log('\nAttachments:');
    for (const att of attachments || []) {
      const hasText = att.extracted_text && att.extracted_text.length > 100;
      console.log(`  - ${att.filename} (${att.mime_type}) - Text: ${hasText ? att.extracted_text.length + ' chars' : 'NONE'}`);
    }

    // Check email body for dates
    console.log('\nSearching email body for dates...');
    const body = email?.body_text || '';

    // Look for 2025/2026 dates
    const datePattern = /20(?:25|26)-\d{2}-\d{2}/g;
    const dates = body.match(datePattern);
    if (dates && dates.length > 0) {
      console.log(`  Found dates in body: ${[...new Set(dates)].join(', ')}`);
    } else {
      console.log('  No 2025/2026 dates found in email body');
    }

    // Look for date patterns like "Jan 15, 2026" or "15-Jan-2026"
    const altDatePattern = /\b(\d{1,2}[-\/]\w{3}[-\/]20(?:25|26)|\w{3}\s+\d{1,2},?\s+20(?:25|26))\b/gi;
    const altDates = body.match(altDatePattern);
    if (altDates && altDates.length > 0) {
      console.log(`  Alt format dates: ${[...new Set(altDates)].join(', ')}`);
    }
  }
}

main().catch(console.error);
