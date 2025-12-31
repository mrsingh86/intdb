import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function verify() {
  // Check emails with content
  const { data: withContent, error: errorWith } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, has_attachments')
    .not('body_text', 'is', null)
    .neq('body_text', '');

  console.log(`\n=== EMAILS WITH CONTENT ===`);
  console.log(`Total: ${withContent?.length || 0}`);

  // Check emails without content
  const { data: withoutContent, error: errorWithout } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .or('body_text.is.null,body_text.eq.');

  console.log(`\n=== EMAILS WITHOUT CONTENT ===`);
  console.log(`Total: ${withoutContent?.length || 0}`);

  // Check attachments
  const { count: attachmentCount } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });

  console.log(`\n=== ATTACHMENTS ===`);
  console.log(`Total attachments saved: ${attachmentCount}`);

  // Sample PDF-extracted email
  const { data: sample } = await supabase
    .from('raw_emails')
    .select('subject, body_text')
    .like('body_text', '%=== %')
    .limit(1)
    .single();

  if (sample) {
    console.log(`\n=== SAMPLE EXTRACTED CONTENT ===`);
    console.log(`Subject: ${sample.subject}`);
    console.log(`Body preview: ${sample.body_text?.substring(0, 200)}...`);
    console.log(`Body length: ${sample.body_text?.length} chars`);
  }
}

verify().catch(console.error);
