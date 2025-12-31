#!/usr/bin/env npx tsx
/**
 * Backfill Missing Attachments v2 - Actually saves attachments
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const oauth2Client = new OAuth2Client(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

interface Stats {
  emailsProcessed: number;
  attachmentsSaved: number;
  emailsWithNoAttachments: number;
  errors: number;
}

const stats: Stats = {
  emailsProcessed: 0,
  attachmentsSaved: 0,
  emailsWithNoAttachments: 0,
  errors: 0,
};

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      BACKFILL ATTACHMENTS v2                                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get emails with has_attachments=true but no raw_attachments record
  // Use pagination
  let allEmailsWithFlag: { id: string; gmail_message_id: string }[] = [];
  let offset = 0;
  const limit = 1000;

  console.log('Step 1: Finding emails with missing attachments...');

  while (true) {
    const { data } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id')
      .eq('has_attachments', true)
      .range(offset, offset + limit - 1);

    if (!data || data.length === 0) break;
    allEmailsWithFlag.push(...data);
    offset += limit;
    if (data.length < limit) break;
  }

  const { data: withRecord } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const recordSet = new Set((withRecord || []).map(r => r.email_id));
  const toProcess = allEmailsWithFlag.filter(e => recordSet.has(e.id) === false);

  console.log(`  Total with has_attachments=true: ${allEmailsWithFlag.length}`);
  console.log(`  Already have attachment records: ${recordSet.size}`);
  console.log(`  Need processing: ${toProcess.length}`);
  console.log('');

  if (toProcess.length === 0) {
    console.log('Nothing to process!');
    return;
  }

  console.log('Step 2: Processing emails...\n');

  for (let i = 0; i < toProcess.length; i++) {
    const email = toProcess[i];

    try {
      await processEmail(email.id, email.gmail_message_id);
      stats.emailsProcessed++;

      if ((i + 1) % 50 === 0) {
        console.log(`  Progress: ${i + 1}/${toProcess.length} | Attachments saved: ${stats.attachmentsSaved}`);
      }
    } catch (err: any) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.log(`  Error ${email.gmail_message_id}: ${err.message}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Emails processed: ${stats.emailsProcessed}`);
  console.log(`Attachments saved: ${stats.attachmentsSaved}`);
  console.log(`Emails with no attachments (flag corrected): ${stats.emailsWithNoAttachments}`);
  console.log(`Errors: ${stats.errors}`);
}

async function processEmail(emailId: string, gmailMessageId: string): Promise<void> {
  // Fetch email from Gmail
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: gmailMessageId,
    format: 'full',
  });

  const parts = response.data.payload?.parts || [];
  const attachments = extractAttachments(parts, []);

  if (attachments.length === 0) {
    // No attachments - update flag to false
    const { error } = await supabase
      .from('raw_emails')
      .update({ has_attachments: false, attachment_count: 0 })
      .eq('id', emailId);

    if (error) {
      throw new Error(`Update failed: ${error.message}`);
    }

    stats.emailsWithNoAttachments++;
    return;
  }

  // Save attachments
  for (const attachment of attachments) {
    // Truncate long fields to fit database constraints (varchar 200)
    const storagePath = `gmail://${gmailMessageId}/${attachment.attachmentId}`;
    const attachmentRecord = {
      email_id: emailId,
      filename: attachment.filename.substring(0, 200),
      mime_type: attachment.mimeType.substring(0, 100),
      size_bytes: attachment.size,
      storage_path: storagePath.substring(0, 200),
      attachment_id: attachment.attachmentId.substring(0, 200),
      extraction_status: 'pending',
    };

    const { error } = await supabase
      .from('raw_attachments')
      .insert(attachmentRecord);

    if (error) {
      // Check if it's a duplicate
      if (error.code === '23505') {
        // Duplicate - skip silently
      } else {
        console.log(`    Insert error: ${error.message}`);
      }
    } else {
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
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      collected.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      extractAttachments(part.parts, collected);
    }
  }
  return collected;
}

main().catch(console.error);
