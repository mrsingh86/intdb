import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get the 3 CMA CGM shipments with minimal data
  const bookings = ['CAD0850107', 'AMC2482410', 'CAD0850214'];

  console.log('═'.repeat(70));
  console.log('CHECKING CMA CGM PDFs FOR MINIMAL DATA SHIPMENTS');
  console.log('═'.repeat(70));

  for (const bn of bookings) {
    console.log(`\n─── ${bn} ───`);

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('created_from_email_id')
      .eq('booking_number', bn)
      .single();

    if (!shipment?.created_from_email_id) {
      console.log('  No source email');
      continue;
    }

    // Get attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('id, filename, mime_type, extracted_text')
      .eq('email_id', shipment.created_from_email_id);

    const pdfs = (attachments || []).filter(a =>
      a.filename?.toLowerCase().endsWith('.pdf')
    );

    console.log(`  PDFs found: ${pdfs.length}`);
    for (const pdf of pdfs) {
      const hasText = pdf.extracted_text && pdf.extracted_text.length > 100;
      console.log(`    - ${pdf.filename}: ${hasText ? `${pdf.extracted_text.length} chars` : 'NO TEXT'}`);
    }
  }
}

main().catch(console.error);
