import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

(async () => {
  // Find PDFs that failed extraction or are still pending
  const { data: failedPdfs } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extraction_status, mime_type')
    .eq('mime_type', 'application/pdf')
    .or('extraction_status.eq.failed,extraction_status.eq.pending')
    .limit(10);

  console.log('=== PDFs NOT EXTRACTED ===');
  console.log('Total:', failedPdfs?.length);

  failedPdfs?.forEach(pdf => {
    console.log(`\n${pdf.filename}`);
    console.log(`  Status: ${pdf.extraction_status}`);
    console.log(`  Email ID: ${pdf.email_id}`);
  });

  // Check a specific email to understand the issue
  if (failedPdfs && failedPdfs.length > 0) {
    const emailId = failedPdfs[0].email_id;
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, gmail_message_id')
      .eq('id', emailId)
      .single();

    console.log('\n=== Sample Email ===');
    console.log('Subject:', email?.subject);
    console.log('Has body_text:', email?.body_text ? 'YES' : 'NO');
    console.log('Body length:', email?.body_text?.length || 0);
    console.log('Gmail ID:', email?.gmail_message_id);
  }
})();
