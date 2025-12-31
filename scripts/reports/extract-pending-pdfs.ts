import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import GmailClient from './utils/gmail-client';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

(async () => {
  // Find PDFs with pending status
  const { data: pendingPdfs } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, storage_path')
    .eq('mime_type', 'application/pdf')
    .eq('extraction_status', 'pending');

  console.log(`Found ${pendingPdfs?.length || 0} pending PDFs`);

  if (!pendingPdfs || pendingPdfs.length === 0) {
    console.log('No pending PDFs to extract');
    return;
  }

  // Initialize Gmail client
  const gmailClient = new GmailClient({
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  });

  for (const pdf of pendingPdfs) {
    try {
      console.log(`\nProcessing: ${pdf.filename}`);

      // Get email to find gmail_message_id
      const { data: email } = await supabase
        .from('raw_emails')
        .select('gmail_message_id, body_text')
        .eq('id', pdf.email_id)
        .single();

      if (!email) {
        console.log('  ✗ Email not found');
        continue;
      }

      // Extract Gmail attachment ID from storage_path (format: gmail://XXXXX)
      const attachmentId = pdf.storage_path.replace('gmail://', '');

      // Download PDF from Gmail
      console.log('  → Downloading PDF from Gmail...');
      const pdfBuffer = await gmailClient.getAttachment(email.gmail_message_id, attachmentId);

      // Extract text
      console.log('  → Extracting text from PDF...');
      const pdfData = await pdfParse(pdfBuffer);
      const extractedText = pdfData.text.trim();

      if (extractedText && extractedText.length > 0) {
        // Append to email body_text
        const pdfContent = `=== ${pdf.filename} ===\n\n${extractedText}`;
        const currentBodyText = email.body_text || '';
        const finalBodyText = currentBodyText
          ? `${currentBodyText}\n\n${pdfContent}`
          : pdfContent;

        await supabase
          .from('raw_emails')
          .update({ body_text: finalBodyText })
          .eq('id', pdf.email_id);

        // Update attachment status
        await supabase
          .from('raw_attachments')
          .update({ extraction_status: 'completed' })
          .eq('id', pdf.id);

        console.log(`  ✓ Extracted ${extractedText.length} chars`);
      } else {
        console.log('  ⚠ PDF is empty or unreadable');
        await supabase
          .from('raw_attachments')
          .update({ extraction_status: 'failed' })
          .eq('id', pdf.id);
      }

    } catch (error: any) {
      console.error(`  ✗ Failed: ${error.message}`);
      await supabase
        .from('raw_attachments')
        .update({ extraction_status: 'failed' })
        .eq('id', pdf.id);
    }
  }

  console.log('\n✓ PDF extraction complete!');
})();
