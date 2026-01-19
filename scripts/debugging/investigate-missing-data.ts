import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkMissingData() {
  // Get bookings with minimal entities
  const missingBookings = ['263522475', '263522431', '263522385', '263522096'];

  console.log('='.repeat(70));
  console.log('INVESTIGATING BOOKINGS WITH MISSING DATA');
  console.log('='.repeat(70));

  for (const bn of missingBookings) {
    // Get the shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('created_from_email_id')
      .eq('booking_number', bn)
      .single();

    if (!shipment) continue;

    // Get the raw email
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email, true_sender_email, body_text, received_at')
      .eq('id', shipment.created_from_email_id)
      .single();

    console.log(`\nBooking: ${bn}`);
    console.log(`Subject: ${email?.subject}`);
    console.log(`Sender: ${email?.true_sender_email || email?.sender_email}`);
    console.log(`Date: ${email?.received_at}`);
    console.log(`Body length: ${email?.body_text?.length || 0} chars`);
    console.log(`Body preview (first 800 chars):`);
    console.log(email?.body_text?.substring(0, 800) || 'NO BODY');
    console.log('\n---');
  }

  // Also check the document classification
  console.log('\n' + '='.repeat(70));
  console.log('CHECKING DOCUMENT CLASSIFICATIONS');
  console.log('='.repeat(70));

  for (const bn of missingBookings) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('created_from_email_id')
      .eq('booking_number', bn)
      .single();

    if (!shipment) continue;

    const { data: classification } = await supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', shipment.created_from_email_id)
      .single();

    console.log(`\n${bn}: ${classification?.document_type} (confidence: ${classification?.confidence_score})`);
  }
}

checkMissingData().catch(console.error);
