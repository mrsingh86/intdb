import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get the actual Booking Confirmation email (not price overview)
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('subject', 'Booking Confirmation : 263375454')
    .single();

  if (!email) {
    console.log('Email not found');
    return;
  }

  console.log('Email ID:', email.id);

  const { data: atts } = await supabase
    .from('raw_attachments')
    .select('id, filename, mime_type, content_type, extracted_text')
    .eq('email_id', email.id);

  console.log('\n=== ATTACHMENTS ===');
  for (const att of atts || []) {
    console.log('---');
    console.log('Filename:', att.filename);
    console.log('MIME Type:', att.mime_type);
    console.log('Content Type:', att.content_type);
    console.log('Has extracted_text:', !!att.extracted_text);
    console.log('extracted_text length:', att.extracted_text?.length || 0);
    console.log('mime_type?.includes("pdf"):', att.mime_type?.includes('pdf'));
  }
}
main().catch(console.error);
