import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  // Get all booking_confirmation emails
  const { data: bcs } = await supabase
    .from('attachment_classifications')
    .select('email_id, confidence')
    .eq('document_type', 'booking_confirmation');

  console.log('=== BOOKING CONFIRMATIONS STATUS ===\n');
  console.log('Total booking_confirmations:', bcs?.length || 0);

  let withShipment = 0;
  let orphans = 0;

  for (const bc of bcs || []) {
    // Get email details
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', bc.email_id)
      .single();

    // Check if linked to shipment
    const { data: link } = await supabase
      .from('email_shipment_links')
      .select('shipment_id, status')
      .eq('email_id', bc.email_id)
      .single();

    // Get extraction
    const { data: extr } = await supabase
      .from('email_extractions')
      .select('entity_value')
      .eq('email_id', bc.email_id)
      .eq('entity_type', 'booking_number')
      .single();

    const hasShipment = link?.shipment_id && link.status !== 'orphan';

    if (hasShipment) {
      withShipment++;
    } else {
      orphans++;
      console.log('ORPHAN:', email?.subject?.substring(0, 60));
      console.log('  Booking#:', extr?.entity_value || 'NOT EXTRACTED');
      console.log('  Confidence:', Math.round((bc.confidence || 0) * 100) + '%');
      console.log('  Link status:', link?.status || 'NO LINK');
      console.log('');
    }
  }

  console.log('=== SUMMARY ===');
  console.log('With shipment:', withShipment);
  console.log('Orphans:', orphans);
}

check().catch(console.error);
