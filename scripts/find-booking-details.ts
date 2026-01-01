import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // First check what email the shipment points to
  const { data: shipment } = await supabase
    .from('shipments')
    .select('created_from_email_id')
    .eq('booking_number', '263375454')
    .single();

  console.log('Shipment created_from_email_id:', shipment?.created_from_email_id);

  // Find ALL emails for booking 263375454
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, received_at, has_attachments')
    .ilike('subject', '%263375454%')
    .order('received_at', { ascending: true });

  console.log('\nAll emails for booking 263375454:\n');

  for (const e of emails || []) {
    const isSource = e.id === shipment?.created_from_email_id;
    console.log('---');
    console.log('ID:', e.id, isSource ? '<<< SOURCE EMAIL' : '');
    console.log('Subject:', e.subject);
    console.log('Received:', e.received_at);
    console.log('Has attachments:', e.has_attachments);

    // Check attachments
    const { data: atts } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', e.id);

    for (const a of atts || []) {
      const hasEtd = a.extracted_text?.includes('ETD') || a.extracted_text?.includes('Estimated Departure');
      const hasVessel = a.extracted_text?.includes('Vessel') || a.extracted_text?.includes('VESSEL');
      console.log('  Attachment:', a.filename);
      console.log('    Has ETD:', hasEtd);
      console.log('    Has Vessel:', hasVessel);
      
      if (hasEtd || hasVessel) {
        // Show relevant section
        const text = a.extracted_text || '';
        const etdMatch = text.match(/.{0,50}ETD.{0,100}/i);
        const vesselMatch = text.match(/.{0,50}Vessel.{0,100}/i);
        if (etdMatch) console.log('    ETD context:', etdMatch[0]);
        if (vesselMatch) console.log('    Vessel context:', vesselMatch[0]);
      }
    }
  }
}
main().catch(console.error);
