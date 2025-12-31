#!/usr/bin/env npx tsx
/**
 * Backfill Missing Attachments
 *
 * ROOT CAUSE: backfill-one-month-emails.ts stored emails with has_attachments=true
 * but never saved the actual attachment records to raw_attachments table.
 *
 * This script:
 * 1. Finds emails with has_attachments=true but no raw_attachments record
 * 2. Fetches attachment metadata from Gmail API
 * 3. Saves to raw_attachments table
 */

import dotenv from 'dotenv';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Gmail setup
const oauth2Client = new OAuth2Client(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

interface Stats {
  emailsChecked: number;
  attachmentsSaved: number;
  emailsUpdated: number;
  errors: number;
}

const stats: Stats = {
  emailsChecked: 0,
  attachmentsSaved: 0,
  emailsUpdated: 0,
  errors: 0,
};

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      BACKFILL MISSING ATTACHMENTS                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Find emails missing attachments
  console.log('Step 1: Finding emails with missing attachments...');

  // Get all emails with has_attachments=true (with pagination)
  let emailsWithFlag: { id: string; gmail_message_id: string }[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id')
      .eq('has_attachments', true)
      .range(offset, offset + limit - 1);

    if (!data || data.length === 0) break;
    emailsWithFlag.push(...data);
    offset += limit;
    console.log(`  Fetched ${emailsWithFlag.length} emails with flag...`);
    if (data.length < limit) break;
  }

  // Get all emails that already have attachments
  const { data: existingAttachments } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const emailsWithAttachments = new Set((existingAttachments || []).map(a => a.email_id));

  // Find missing ones
  const missingEmails = emailsWithFlag.filter(
    e => !emailsWithAttachments.has(e.id)
  );

  console.log(`  Total emails with has_attachments=true: ${emailsWithFlag?.length || 0}`);
  console.log(`  Emails already have attachment records: ${emailsWithAttachments.size}`);
  console.log(`  Emails MISSING attachment records: ${missingEmails.length}`);
  console.log('');

  if (missingEmails.length === 0) {
    console.log('✅ No missing attachments to backfill!');
    return;
  }

  // Step 2: Process each missing email
  console.log('Step 2: Fetching and saving attachments from Gmail...\n');

  for (let i = 0; i < missingEmails.length; i++) {
    const email = missingEmails[i];
    stats.emailsChecked++;

    try {
      await processEmail(email.id, email.gmail_message_id);
      stats.emailsUpdated++;

      // Progress indicator
      if ((i + 1) % 10 === 0) {
        console.log(`  Progress: ${i + 1}/${missingEmails.length} emails processed`);
      }
    } catch (err: any) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.log(`  ⚠ Error for ${email.gmail_message_id}: ${err.message}`);
      }
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Emails checked: ${stats.emailsChecked}`);
  console.log(`Emails updated: ${stats.emailsUpdated}`);
  console.log(`Attachments saved: ${stats.attachmentsSaved}`);
  console.log(`Errors: ${stats.errors}`);
}

async function processEmail(emailId: string, gmailMessageId: string): Promise<void> {
  // Fetch email from Gmail to get attachment details
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: gmailMessageId,
    format: 'full',
  });

  const parts = response.data.payload?.parts || [];
  const attachments = extractAttachments(parts, []);

  if (attachments.length === 0) {
    // Update email to correct the flag
    const { error } = await supabase
      .from('raw_emails')
      .update({ has_attachments: false, attachment_count: 0 })
      .eq('id', emailId);

    if (error) {
      console.log(`Update error for ${emailId}: ${error.message}`);
    }
    return;
  }

  // Save each attachment
  for (const attachment of attachments) {
    const attachmentRecord = {
      email_id: emailId,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size_bytes: attachment.size,
      storage_path: `gmail://${gmailMessageId}/${attachment.attachmentId}`,
      attachment_id: attachment.attachmentId,
      extraction_status: 'pending',
    };

    const { error } = await supabase
      .from('raw_attachments')
      .insert(attachmentRecord);

    if (!error) {
      stats.attachmentsSaved++;
    }
  }
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

function extractAttachments(parts: any[], collected: AttachmentInfo[]): AttachmentInfo[] {
  for (const part of parts) {
    // Check for attachment
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      collected.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }

    // Recurse into nested parts
    if (part.parts) {
      extractAttachments(part.parts, collected);
    }
  }

  return collected;
}

main().catch(console.error);
