import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const emailId = 'ab4ef1ee-0635-4a6e-a868-e2bee99d034b';

  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, has_attachments, body_text')
    .eq('id', emailId)
    .single();

  console.log('=== EMAIL ===');
  console.log('Subject:', email?.subject);
  console.log('Has attachments:', email?.has_attachments);
  console.log('Body text length:', email?.body_text?.length || 0);

  const { data: atts } = await supabase
    .from('raw_attachments')
    .select('filename, mime_type, extracted_text')
    .eq('email_id', emailId);

  console.log('\n=== ATTACHMENTS ===');
  console.log('Count:', atts?.length || 0);

  for (const a of atts || []) {
    console.log('---');
    console.log('File:', a.filename);
    console.log('MIME:', a.mime_type);
    const hasText = a.extracted_text && a.extracted_text.length > 0;
    console.log('Has text:', hasText);
    console.log('Text length:', a.extracted_text?.length || 0);
    if (a.extracted_text) {
      console.log('Preview:', a.extracted_text.substring(0, 300));
    }
  }

  // Also show body preview
  if (email?.body_text) {
    console.log('\n=== BODY PREVIEW ===');
    console.log(email.body_text.substring(0, 500));
  }
}

main().catch(console.error);
