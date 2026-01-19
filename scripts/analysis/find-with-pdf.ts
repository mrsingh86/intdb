import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Find emails that have PDF attachments with extracted text
  const { data: atts } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, extracted_text')
    .ilike('filename', '%.pdf')
    .not('extracted_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('=== EMAILS WITH PDF CONTENT ===');

  for (const a of atts || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', a.email_id)
      .single();

    const isBooking = email?.subject?.toLowerCase().includes('booking');

    console.log('---');
    console.log('Email ID:', a.email_id);
    console.log('Subject:', email?.subject?.substring(0, 60));
    console.log('PDF:', a.filename);
    console.log('Text length:', a.extracted_text?.length || 0);
    console.log('Is Booking:', isBooking);
  }
}

main().catch(console.error);
