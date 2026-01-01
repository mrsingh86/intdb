import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('extracted_text, email_id')
    .ilike('filename', '%263375454%')
    .single();

  if (!att) {
    // Try by email
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id')
      .ilike('subject', '%Booking Confirmation%263375454%');

    console.log('Emails found:', emails?.length);

    if (emails?.[0]) {
      const { data: atts } = await supabase
        .from('raw_attachments')
        .select('filename, extracted_text')
        .eq('email_id', emails[0].id);

      console.log('Attachments:', atts?.length);
      
      if (atts?.[0]?.extracted_text) {
        console.log('\n=== PDF TEXT ===');
        console.log(atts[0].extracted_text);
      } else {
        console.log('No extracted text!');
        console.log('Attachment info:', atts?.[0]);
      }
    }
  }
}
main().catch(console.error);
