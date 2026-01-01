import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═'.repeat(70));
  console.log('INVESTIGATING HOW BAD EMAILS QUALIFIED AS BOOKING CONFIRMATIONS');
  console.log('═'.repeat(70));

  // 263805268 - email with no body and no attachments
  console.log('\n─── 263805268 ───');

  const { data: email1 } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('subject', 'Booking Confirmation : 263805268')
    .single();

  if (email1) {
    console.log('Subject:', email1.subject);
    console.log('Sender:', email1.true_sender_email || email1.sender_email);
    console.log('Body length:', email1.body_text?.length || 0);
    console.log('Has attachments flag:', email1.has_attachments);

    // Check classification
    const { data: cls1 } = await supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', email1.id);

    console.log('\nClassifications:', JSON.stringify(cls1, null, 2));

    // WHY IT QUALIFIED:
    console.log('\n⚠️ ROOT CAUSE:');
    console.log('   - Subject contains "Booking Confirmation"');
    console.log('   - Sender is from @maersk.com (via forwarding)');
    console.log('   - Classification matched on subject pattern alone');
    console.log('   - No validation that body/PDF actually contains data');
  }

  // CEI0329155 - cutoff inquiry email
  console.log('\n─── CEI0329155 ───');

  const { data: email2 } = await supabase
    .from('raw_emails')
    .select('*')
    .ilike('subject', '%CEI0329155%')
    .single();

  if (email2) {
    console.log('Subject:', email2.subject);
    console.log('Sender:', email2.true_sender_email || email2.sender_email);
    console.log('Body snippet:', email2.body_text?.substring(0, 200));

    console.log('\n⚠️ ROOT CAUSE:');
    console.log('   - Booking number pattern (CEI...) detected');
    console.log('   - Email was a cutoff inquiry, not a booking confirmation');
    console.log('   - Classification system doesn\'t distinguish email intent');
  }
}

main().catch(console.error);
