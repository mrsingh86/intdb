import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const oauth2Client = new OAuth2Client(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

async function downloadAndExtractPdf(messageId: string, attachmentId: string): Promise<string | null> {
  try {
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });

    if (!response.data.data) {
      return null;
    }

    // Gmail returns base64url encoded, convert to regular base64
    const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(data, 'base64');

    const pdfData = await pdfParse(buffer);
    return pdfData.text || null;
  } catch (error: any) {
    console.log(`    Error: ${error.message?.substring(0, 80)}`);
    return null;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('EXTRACTING TEXT FROM MISSING PDFs');
  console.log('═'.repeat(70));

  // Test Gmail connection
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('Gmail connected:', profile.data.emailAddress);
  } catch (error: any) {
    console.error('Gmail connection failed:', error.message);
    return;
  }

  // Get all attachments without extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, storage_path')
    .is('extracted_text', null);

  // Filter to PDFs (by mime type OR filename)
  const pdfAttachments = (attachments || []).filter(a =>
    a.mime_type?.toLowerCase().includes('pdf') ||
    a.filename?.toLowerCase().endsWith('.pdf')
  );

  console.log(`\nPDFs without extracted text: ${pdfAttachments.length}`);

  if (pdfAttachments.length === 0) {
    console.log('All PDFs already have text extracted!');
    return;
  }

  // Get unique email IDs
  const emailIds = [...new Set(pdfAttachments.map(a => a.email_id))];

  // Get email gmail_message_ids
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  let successCount = 0;
  let failCount = 0;

  for (const att of pdfAttachments) {
    const email = emailMap.get(att.email_id);
    if (!email?.gmail_message_id) {
      console.log(`\n⚠️ ${att.filename}: No Gmail ID found`);
      failCount++;
      continue;
    }

    console.log(`\n─── ${att.filename} ───`);
    console.log(`  Email: ${email.subject?.substring(0, 50)}...`);

    // Extract attachment ID from storage_path (format: gmail://ATTACHMENT_ID)
    const attachmentId = att.storage_path?.replace('gmail://', '');
    if (!attachmentId) {
      console.log('  ⚠️ No attachment ID in storage_path');
      failCount++;
      continue;
    }

    // Download and extract
    const text = await downloadAndExtractPdf(email.gmail_message_id, attachmentId);

    if (!text || text.length < 50) {
      console.log(`  ⚠️ No text extracted (${text?.length || 0} chars)`);
      failCount++;
      continue;
    }

    // Update database
    const { error } = await supabase
      .from('raw_attachments')
      .update({ extracted_text: text })
      .eq('id', att.id);

    if (error) {
      console.log(`  ❌ DB update failed: ${error.message}`);
      failCount++;
    } else {
      console.log(`  ✅ Extracted ${text.length} chars`);
      successCount++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('EXTRACTION COMPLETE');
  console.log('═'.repeat(70));
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
}

main().catch(console.error);
