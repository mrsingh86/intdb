import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get CEI0329155 shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('created_from_email_id')
    .eq('booking_number', 'CEI0329155')
    .single();

  if (!shipment?.created_from_email_id) {
    console.log('No email found');
    return;
  }

  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, body_text')
    .eq('id', shipment.created_from_email_id)
    .single();

  console.log('Subject:', email?.subject);
  console.log('\n' + '═'.repeat(70));
  console.log('FULL EMAIL BODY:');
  console.log('═'.repeat(70));
  console.log(email?.body_text);
}

main().catch(console.error);
