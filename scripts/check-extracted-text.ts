/**
 * Check what's in the extracted PDF text for incomplete shipments
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  console.log('CHECKING EXTRACTED TEXT CONTENT');
  console.log('═'.repeat(60));

  // Get attachments with extracted_text for incomplete shipments
  const bookings = ['263042012', '263077531'];

  for (const bkg of bookings) {
    console.log('');
    console.log('─'.repeat(60));
    console.log('Booking:', bkg);

    const { data: ship } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bkg)
      .single();

    if (!ship) continue;

    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', ship.id);

    const emailId = docs?.[0]?.email_id;
    if (!emailId) continue;

    const { data: atts } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', emailId)
      .not('extracted_text', 'is', null);

    if (atts && atts.length > 0) {
      for (const att of atts) {
        console.log('');
        console.log('File:', att.filename);
        console.log('Extracted text preview:');
        console.log(att.extracted_text?.substring(0, 500));
        console.log('...');

        // Check for voyage keywords
        const text = att.extracted_text || '';
        const hasVessel = /vessel|v\/v|ship\s*name/i.test(text);
        const hasETD = /etd|departure|sailing/i.test(text);
        const hasETA = /eta|arrival/i.test(text);
        const hasPort = /port|loading|discharge|pol|pod/i.test(text);

        console.log('');
        console.log('Contains voyage keywords:');
        console.log('  Vessel:', hasVessel);
        console.log('  ETD:', hasETD);
        console.log('  ETA:', hasETA);
        console.log('  Port:', hasPort);
      }
    } else {
      console.log('No extracted text found');

      // Check PDFs without extraction
      const { data: pdfAtts } = await supabase
        .from('raw_attachments')
        .select('id, filename, mime_type, file_size')
        .eq('email_id', emailId)
        .ilike('filename', '%.pdf');

      console.log('PDFs without extraction:', pdfAtts?.length || 0);
      for (const pdf of pdfAtts || []) {
        console.log('  -', pdf.filename, '| size:', pdf.file_size);
      }
    }
  }

  // Check an incomplete Hapag shipment
  console.log('');
  console.log('═'.repeat(60));
  console.log('HAPAG-LLOYD INCOMPLETE (with PDF):');
  console.log('═'.repeat(60));

  const { data: hapagShip } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .eq('booking_number', '94295687')
    .single();

  if (hapagShip) {
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', hapagShip.id);

    const emailId = docs?.[0]?.email_id;
    if (emailId) {
      const { data: atts } = await supabase
        .from('raw_attachments')
        .select('id, filename, mime_type, file_size, extracted_text')
        .eq('email_id', emailId);

      for (const att of atts || []) {
        console.log('');
        console.log('File:', att.filename);
        console.log('MIME:', att.mime_type);
        console.log('Size:', att.file_size);
        console.log('Has extracted_text:', att.extracted_text ? 'YES' : 'NO');

        if (att.extracted_text) {
          console.log('Preview:', att.extracted_text.substring(0, 300));
        }
      }
    }
  }
}

check().catch(console.error);
