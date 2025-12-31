import dotenv from 'dotenv';
import GmailClient from './utils/gmail-client';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function debugGmailFetch() {
  const gmailClient = new GmailClient({
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  });

  // Get an email that has empty string body_text
  const { data: testEmail } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject')
    .eq('body_text', '')
    .limit(1)
    .single();

  if (!testEmail) {
    console.log('No emails with NULL body_text found');
    return;
  }

  console.log('Testing email:', testEmail.subject);
  console.log('Gmail message ID:', testEmail.gmail_message_id);

  // Fetch from Gmail
  const emailData = await gmailClient.getMessage(testEmail.gmail_message_id);

  console.log('\n=== Gmail API Response ===');
  console.log('Subject:', emailData.subject);
  console.log('Body Text:', emailData.bodyText ? `${emailData.bodyText.length} chars` : 'NULL/UNDEFINED');
  console.log('Body Text Preview:', emailData.bodyText?.substring(0, 200) || 'NONE');
  console.log('Body HTML:', emailData.bodyHtml ? `${emailData.bodyHtml.length} chars` : 'NULL/UNDEFINED');
  console.log('Has attachments:', emailData.hasAttachments);
  console.log('Attachment count:', emailData.attachmentCount);
  console.log('Attachments:', emailData.attachments?.map(a => a.filename));
}

debugGmailFetch().catch(console.error);
