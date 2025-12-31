import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

(async () => {
  // Get an email with PDF extracted content
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, has_attachments, attachment_count')
    .like('body_text', '%===%')
    .eq('has_attachments', true)
    .limit(1)
    .single();

  if (email) {
    console.log('\n=== EMAIL WITH PDF CONTENT ===');
    console.log(`ID: ${email.id}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Has attachments: ${email.has_attachments}`);
    console.log(`Attachment count: ${email.attachment_count}`);
    console.log(`\nBody text preview (first 300 chars):`);
    console.log(email.body_text?.substring(0, 300));
    console.log('...');

    // Get attachments for this email
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, mime_type, size_bytes, extraction_status')
      .eq('email_id', email.id);

    console.log(`\n=== ATTACHMENTS FOR THIS EMAIL ===`);
    console.log(`Total: ${attachments?.length || 0}`);
    attachments?.forEach((att, i) => {
      console.log(`${i + 1}. ${att.filename}`);
      console.log(`   Type: ${att.mime_type}`);
      console.log(`   Size: ${(att.size_bytes / 1024).toFixed(1)} KB`);
      console.log(`   Status: ${att.extraction_status}`);
    });

    console.log(`\n✓ Open in browser: http://localhost:3000/emails/${email.id}`);
    console.log('\nWhat should be visible in the dashboard:');
    console.log('1. Email body showing PDF extracted text starting with "=== filename.pdf ==="');
    console.log('2. Attachments section showing all attachments with filename, type, size, and status');
  }
})();
