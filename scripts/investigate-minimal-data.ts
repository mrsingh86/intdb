import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const bookings = ['CAD0850107', 'AMC2482410', 'CAD0850214', '263805268', 'CEI0329155'];

  console.log('═'.repeat(70));
  console.log('INVESTIGATING 5 SHIPMENTS WITH MINIMAL DATA');
  console.log('═'.repeat(70));

  for (const bookingNumber of bookings) {
    console.log(`\n─── ${bookingNumber} ───`);

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      console.log('  NOT FOUND');
      continue;
    }

    // Count populated fields
    const keyFields = ['vessel_name', 'voyage_number', 'etd', 'eta', 'si_cutoff',
                       'port_of_loading_code', 'port_of_discharge_code'];
    const populated = keyFields.filter(f => (shipment as any)[f]).length;

    console.log(`  Key fields populated: ${populated}/${keyFields.length}`);
    console.log(`  Vessel: ${shipment.vessel_name || 'NULL'} / ${shipment.voyage_number || 'NULL'}`);
    console.log(`  POL: ${shipment.port_of_loading} (${shipment.port_of_loading_code || 'NULL'})`);
    console.log(`  POD: ${shipment.port_of_discharge} (${shipment.port_of_discharge_code || 'NULL'})`);
    console.log(`  ETD: ${shipment.etd || 'NULL'}, ETA: ${shipment.eta || 'NULL'}`);
    console.log(`  SI Cutoff: ${shipment.si_cutoff || 'NULL'}`);

    // Check source email
    if (!shipment.created_from_email_id) {
      console.log('  ⚠️ No source email linked');
      continue;
    }

    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, true_sender_email, sender_email, received_at')
      .eq('id', shipment.created_from_email_id)
      .single();

    console.log(`  Source: ${email?.true_sender_email || email?.sender_email}`);
    console.log(`  Subject: ${email?.subject?.substring(0, 50)}...`);
    console.log(`  Received: ${email?.received_at}`);

    // Check attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, mime_type, extracted_text')
      .eq('email_id', shipment.created_from_email_id);

    const pdfs = (attachments || []).filter(a =>
      a.mime_type?.includes('pdf') || a.filename?.toLowerCase().endsWith('.pdf')
    );
    const pdfsWithText = pdfs.filter(a => a.extracted_text && a.extracted_text.length > 100);

    console.log(`  Attachments: ${attachments?.length || 0} total, ${pdfs.length} PDFs, ${pdfsWithText.length} with text`);

    // Check email body length
    const bodyLen = email?.body_text?.length || 0;
    console.log(`  Email body: ${bodyLen} chars`);

    // If body has content, show snippet
    if (bodyLen > 100) {
      console.log(`  Body preview: ${email?.body_text?.substring(0, 200)}...`);
    }
  }
}

main().catch(console.error);
