import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const bookings = ['CAD0850107', 'AMC2482410', 'CAD0850214', '263805268', 'CEI0329155'];

  console.log('═'.repeat(80));
  console.log('DEEP DIVE: HOW DID THESE BECOME SHIPMENTS?');
  console.log('═'.repeat(80));

  for (const bookingNumber of bookings) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`BOOKING: ${bookingNumber}`);
    console.log('─'.repeat(80));

    // Get shipment with all metadata
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      console.log('NOT FOUND');
      continue;
    }

    console.log(`\n1. SHIPMENT CREATION:`);
    console.log(`   Created at: ${shipment.created_at}`);
    console.log(`   Source email ID: ${shipment.created_from_email_id || 'NONE'}`);

    // Get source email
    if (shipment.created_from_email_id) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('*')
        .eq('id', shipment.created_from_email_id)
        .single();

      console.log(`\n2. SOURCE EMAIL:`);
      console.log(`   Gmail ID: ${email?.gmail_message_id}`);
      console.log(`   Received: ${email?.received_at}`);
      console.log(`   Processed at: ${email?.processed_at}`);
      console.log(`   Processing status: ${email?.processing_status}`);
      console.log(`   Subject: ${email?.subject}`);
      console.log(`   From: ${email?.true_sender_email || email?.sender_email}`);
      console.log(`   Body length: ${email?.body_text?.length || 0} chars`);

      // Get attachments with details
      const { data: attachments } = await supabase
        .from('raw_attachments')
        .select('*')
        .eq('email_id', shipment.created_from_email_id);

      console.log(`\n3. ATTACHMENTS (${attachments?.length || 0}):`);
      for (const att of attachments || []) {
        const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
        console.log(`   - ${att.filename}`);
        console.log(`     MIME: ${att.mime_type}`);
        console.log(`     Size: ${att.size_bytes || 'unknown'} bytes`);
        console.log(`     Is PDF: ${isPdf ? 'YES' : 'NO'}`);
        console.log(`     Extracted text: ${att.extracted_text ? `${att.extracted_text.length} chars` : 'NONE'}`);
        console.log(`     Storage path: ${att.storage_path || 'NONE'}`);
        console.log(`     Created at: ${att.created_at}`);
      }

      // Check document classifications
      const { data: classifications } = await supabase
        .from('document_classifications')
        .select('*')
        .eq('email_id', shipment.created_from_email_id);

      console.log(`\n4. DOCUMENT CLASSIFICATIONS (${classifications?.length || 0}):`);
      for (const cls of classifications || []) {
        console.log(`   - Type: ${cls.document_type}, Confidence: ${cls.confidence}%`);
        console.log(`     Carrier: ${cls.carrier_id}`);
      }
    }

    // Check if there's an extraction record
    const { data: extractions } = await supabase
      .from('entity_extractions')
      .select('*')
      .eq('email_id', shipment.created_from_email_id);

    if (extractions && extractions.length > 0) {
      console.log(`\n5. ENTITY EXTRACTIONS (${extractions.length}):`);
      for (const ext of extractions) {
        console.log(`   - Type: ${ext.entity_type}, Value: ${ext.entity_value}`);
      }
    }
  }

  // Check PDF extraction process
  console.log('\n' + '═'.repeat(80));
  console.log('ANALYSIS: WHY WERE PDFs NOT OCR\'d?');
  console.log('═'.repeat(80));

  // Get CMA CGM PDFs that have no text
  const { data: cmaPdfs } = await supabase
    .from('raw_attachments')
    .select('filename, mime_type, extracted_text, storage_path, created_at')
    .like('filename', '%CAD%')
    .limit(5);

  console.log('\nCMA CGM PDF attachments:');
  for (const pdf of cmaPdfs || []) {
    console.log(`  ${pdf.filename}: mime=${pdf.mime_type}, text=${pdf.extracted_text?.length || 0} chars`);
    console.log(`    storage_path: ${pdf.storage_path || 'NONE'}`);
  }
}

main().catch(console.error);
