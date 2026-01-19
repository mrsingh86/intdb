/**
 * Test Sent Emails Pipeline
 * Fetches and processes outgoing emails from Gmail
 */

import dotenv from 'dotenv';
import { supabase } from '../utils/supabase-client';
import GmailClient from '../utils/gmail-client';
import { GmailCredentials } from '../types/gmail.types';

dotenv.config();

async function fetchSentEmails() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          FETCHING SENT/OUTGOING EMAILS FROM GMAIL                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Initialize Gmail client
  const credentials: GmailCredentials = {
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  };

  const gmailClient = new GmailClient(credentials);

  // Test connection
  const connected = await gmailClient.testConnection();
  if (!connected) {
    console.error('❌ Failed to connect to Gmail');
    return;
  }

  console.log('✅ Connected to Gmail\n');

  // Query for sent emails related to shipping
  const queries = [
    'in:sent subject:(booking OR shipment OR container OR BL OR B/L) after:2025-12-17',
    'in:sent from:me to:(@maersk.com OR @hlag.com OR @msc.com OR @cma-cgm.com) after:2025-12-17',
    'in:sent subject:(SI OR "shipping instruction" OR VGM OR amendment) after:2025-12-17'
  ];

  let allMessageIds: string[] = [];

  for (const query of queries) {
    console.log(`\n📧 Searching: ${query}`);
    try {
      const { messages } = await gmailClient.listMessages(query, 20);
      console.log(`   Found: ${messages.length} emails`);
      allMessageIds.push(...messages);
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  // Remove duplicates
  const uniqueMessageIds = [...new Set(allMessageIds)];
  console.log(`\n📊 Total unique sent emails found: ${uniqueMessageIds.length}`);

  if (uniqueMessageIds.length === 0) {
    console.log('\n⚠️  No sent emails found. This could mean:');
    console.log('   1. No shipping-related emails were sent in the last 7 days');
    console.log('   2. Gmail search filters need adjustment');
    console.log('   3. Emails are in a different folder/label');
    return;
  }

  console.log('\n📥 Fetching and saving sent emails...\n');

  let saved = 0;
  let failed = 0;

  for (const messageId of uniqueMessageIds.slice(0, 20)) {
    try {
      // Fetch full email
      const emailData = await gmailClient.getMessage(messageId);

      // Check if already exists
      const { data: existing } = await supabase
        .from('raw_emails')
        .select('id')
        .eq('gmail_message_id', messageId)
        .single();

      if (existing) {
        console.log(`   ⏭️  Skipped (duplicate): ${emailData.subject.substring(0, 60)}`);
        continue;
      }

      // Save to database
      const { error } = await supabase
        .from('raw_emails')
        .insert({
          gmail_message_id: emailData.gmailMessageId,
          thread_id: emailData.threadId,
          sender_email: emailData.senderEmail,
          sender_name: emailData.senderName,
          true_sender_email: emailData.trueSenderEmail,
          recipient_emails: emailData.recipientEmails,
          subject: emailData.subject,
          body_text: emailData.bodyText,
          body_html: emailData.bodyHtml,
          snippet: emailData.snippet,
          headers: emailData.headers,
          has_attachments: emailData.hasAttachments,
          attachment_count: emailData.attachmentCount,
          labels: emailData.labels,
          received_at: emailData.receivedAt.toISOString(),
          processing_status: 'pending'
        });

      if (error) {
        console.log(`   ❌ Failed: ${emailData.subject.substring(0, 60)} - ${error.message}`);
        failed++;
      } else {
        console.log(`   ✅ Saved: ${emailData.subject.substring(0, 60)}`);
        saved++;
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error: any) {
      console.error(`   ❌ Error processing ${messageId}: ${error.message}`);
      failed++;
    }
  }

  console.log('\n');
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log(`Total found:     ${uniqueMessageIds.length}`);
  console.log(`Saved:           ${saved}`);
  console.log(`Failed:          ${failed}`);
  console.log(`Duplicates:      ${uniqueMessageIds.length - saved - failed}`);
  console.log('');
  console.log('✅ Sent emails fetched and saved to database!');
  console.log('');
  console.log('Next step: Run the classification & extraction pipeline:');
  console.log('  npm run test:pipeline 20');
  console.log('');
}

fetchSentEmails().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
