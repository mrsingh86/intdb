#!/usr/bin/env npx tsx
/**
 * Investigate why Arrival Notice emails claim to have attachments but none found
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      ATTACHMENT INVESTIGATION: Arrival Notice Emails                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Find arrival notice emails
  const { data: arrivalEmails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, has_attachments, attachment_count, body_text, body_html')
    .or('subject.ilike.%Arrival notice%,subject.ilike.%Arrival Notice%')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%')
    .limit(10);

  console.log('SAMPLE ARRIVAL NOTICE EMAILS:');
  console.log('═'.repeat(80));

  for (const email of arrivalEmails || []) {
    console.log('\nSubject:', email.subject);
    console.log('has_attachments:', email.has_attachments);
    console.log('attachment_count:', email.attachment_count);

    // Check raw_attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, mime_type, size_bytes, extraction_status')
      .eq('email_id', email.id);

    if (attachments && attachments.length > 0) {
      console.log('Attachments in DB:');
      for (const att of attachments) {
        console.log(`  - ${att.filename} (${att.mime_type}, ${att.size_bytes} bytes)`);
      }
    } else {
      console.log('Attachments in DB: NONE');
    }

    // Check if body mentions "attached"
    const bodyText = email.body_text || '';
    const hasAttachedMention = bodyText.toLowerCase().includes('attached');
    console.log('Body mentions "attached":', hasAttachedMention);

    console.log('─'.repeat(80));
  }

  // Stats: Emails that say "attached" but have no attachments
  console.log('\n\n');
  console.log('MISMATCH ANALYSIS:');
  console.log('═'.repeat(80));

  // Get all emails with has_attachments data
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, has_attachments, attachment_count')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%');

  const withAttachFlag = (allEmails || []).filter(e => e.has_attachments === true);
  const withCount = (allEmails || []).filter(e => e.attachment_count && e.attachment_count > 0);

  console.log('Total Maersk emails:', allEmails?.length);
  console.log('Emails with has_attachments=true:', withAttachFlag.length);
  console.log('Emails with attachment_count > 0:', withCount.length);

  // Check how many have actual attachments in raw_attachments table
  let actualAttachmentCount = 0;
  for (const email of allEmails || []) {
    const { count } = await supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', email.id);
    if (count && count > 0) actualAttachmentCount++;
  }
  console.log('Emails with records in raw_attachments:', actualAttachmentCount);

  // Check the specific email mentioned
  console.log('\n\n');
  console.log('SPECIFIC EMAIL: Arrival notice 261736030');
  console.log('═'.repeat(80));

  const { data: specificEmail } = await supabase
    .from('raw_emails')
    .select('*')
    .ilike('subject', '%261736030%')
    .single();

  if (specificEmail) {
    console.log('Email ID:', specificEmail.id);
    console.log('Gmail Message ID:', specificEmail.gmail_message_id);
    console.log('has_attachments:', specificEmail.has_attachments);
    console.log('attachment_count:', specificEmail.attachment_count);
    console.log('headers:', JSON.stringify(specificEmail.headers, null, 2)?.substring(0, 500));

    // Check raw_attachments
    const { data: atts } = await supabase
      .from('raw_attachments')
      .select('*')
      .eq('email_id', specificEmail.id);

    console.log('\nAttachments in raw_attachments table:', atts?.length || 0);
    if (atts && atts.length > 0) {
      for (const att of atts) {
        console.log('  - ', att.filename, att.mime_type, att.size_bytes, 'bytes');
      }
    }
  } else {
    console.log('Email not found with subject containing 261736030');
  }
}

main().catch(console.error);
