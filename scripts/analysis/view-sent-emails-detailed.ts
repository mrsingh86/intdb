/**
 * View Detailed Sent Emails
 * Shows complete raw email data from database
 */

import { supabase } from '../utils/supabase-client';

async function viewSentEmailsDetailed() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                   DETAILED SENT EMAIL DATA                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch the most recent emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No emails found in database');
    return;
  }

  emails.forEach((email, idx) => {
    console.log('═'.repeat(100));
    console.log(`EMAIL ${idx + 1} of ${emails.length}`);
    console.log('═'.repeat(100));
    console.log(`Subject:         ${email.subject}`);
    console.log(`From:            ${email.sender_email}${email.sender_name ? ' (' + email.sender_name + ')' : ''}`);
    console.log(`To:              ${email.recipient_emails?.join(', ') || 'N/A'}`);
    console.log(`Received:        ${new Date(email.received_at).toLocaleString()}`);
    console.log(`Message ID:      ${email.gmail_message_id}`);
    console.log(`Thread ID:       ${email.thread_id || 'N/A'}`);
    console.log(`Has Attachments: ${email.has_attachments ? 'Yes (' + email.attachment_count + ' files)' : 'No'}`);
    console.log(`Labels:          ${email.labels?.join(', ') || 'None'}`);
    console.log(`Processing:      ${email.processing_status || 'pending'}`);

    if (email.snippet) {
      console.log(`\nSnippet:         ${email.snippet}`);
    }

    console.log(`\nBody Length:     ${email.body_text?.length || 0} characters`);

    if (email.body_text && email.body_text.length > 0) {
      console.log(`\n📄 EMAIL BODY:`);
      console.log('─'.repeat(100));
      const preview = email.body_text.substring(0, 1000);
      console.log(preview);
      if (email.body_text.length > 1000) {
        console.log(`\n... (showing first 1,000 of ${email.body_text.length} characters)`);
      }
    } else {
      console.log(`\n📄 EMAIL BODY: (empty)`);
    }

    // Show headers if available
    if (email.headers && Object.keys(email.headers).length > 0) {
      console.log(`\n📋 KEY HEADERS:`);
      console.log('─'.repeat(100));
      const importantHeaders = ['From', 'To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References'];
      importantHeaders.forEach(headerName => {
        if (email.headers[headerName]) {
          console.log(`  ${headerName}: ${email.headers[headerName]}`);
        }
      });
    }

    console.log('\n');
  });

  console.log('═'.repeat(100));
  console.log(`Total emails shown: ${emails.length}`);
  console.log('═'.repeat(100));
}

viewSentEmailsDetailed().catch(console.error);
