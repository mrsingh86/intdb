import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get CAD0850107 shipment and email
  const { data: shipment1 } = await supabase
    .from('shipments')
    .select('created_from_email_id')
    .eq('booking_number', 'CAD0850107')
    .single();

  if (shipment1?.created_from_email_id) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('body_text, body_html')
      .eq('id', shipment1.created_from_email_id)
      .single();

    console.log('═'.repeat(70));
    console.log('CAD0850107 - Email Body:');
    console.log('═'.repeat(70));
    console.log(email?.body_text?.substring(0, 3000) || 'No body text');
  }

  // Get 263805268 shipment and email
  const { data: shipment2 } = await supabase
    .from('shipments')
    .select('created_from_email_id')
    .eq('booking_number', '263805268')
    .single();

  if (shipment2?.created_from_email_id) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('body_text, body_html')
      .eq('id', shipment2.created_from_email_id)
      .single();

    console.log('\n' + '═'.repeat(70));
    console.log('263805268 - Email Body:');
    console.log('═'.repeat(70));
    console.log(email?.body_text?.substring(0, 3000) || 'No body text');
  }
}

main().catch(console.error);
