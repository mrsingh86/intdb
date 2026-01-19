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

interface AttachmentInfo {
  filename: string;
  attachmentId: string;
  mimeType: string;
}

function findAttachments(part: any): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (part.filename && part.body?.attachmentId) {
    attachments.push({
      filename: part.filename,
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType || 'application/octet-stream'
    });
  }
  if (part.parts) {
    for (const subPart of part.parts) {
      attachments.push(...findAttachments(subPart));
    }
  }
  return attachments;
}

async function refetchAndExtract(gmailMessageId: string, targetFilename: string): Promise<string | null> {
  try {
    // Re-fetch the full message to get fresh attachment tokens
    const msgResponse = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'full'
    });

    if (!msgResponse.data.payload) {
      console.log('    No payload in message');
      return null;
    }

    // Find the attachment by filename
    const allAttachments = findAttachments(msgResponse.data.payload);
    const target = allAttachments.find(a => a.filename === targetFilename);

    if (!target) {
      console.log(`    Attachment ${targetFilename} not found in message`);
      console.log(`    Available: ${allAttachments.map(a => a.filename).join(', ')}`);
      return null;
    }

    // Download the attachment with fresh token
    const attResponse = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: gmailMessageId,
      id: target.attachmentId
    });

    if (!attResponse.data.data) {
      console.log('    No data in attachment response');
      return null;
    }

    // Decode base64url to buffer
    const data = attResponse.data.data.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(data, 'base64');

    // Extract text from PDF
    const pdfData = await pdfParse(buffer);
    return pdfData.text || null;

  } catch (error: any) {
    console.log(`    Error: ${error.message?.substring(0, 100)}`);
    return null;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('RE-FETCH AND EXTRACT PDFs FROM GMAIL');
  console.log('═'.repeat(70));

  // Test Gmail
  const profile = await gmail.users.getProfile({ userId: 'me' });
  console.log('Gmail connected:', profile.data.emailAddress);

  // Get all PDF attachments without extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type')
    .is('extracted_text', null);

  const pdfAttachments = (attachments || []).filter(a =>
    a.mime_type?.toLowerCase().includes('pdf') ||
    a.filename?.toLowerCase().endsWith('.pdf')
  );

  console.log(`\nPDFs needing extraction: ${pdfAttachments.length}`);

  if (pdfAttachments.length === 0) {
    console.log('All PDFs already extracted!');
    return;
  }

  // Get email gmail_message_ids
  const emailIds = [...new Set(pdfAttachments.map(a => a.email_id))];
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  let success = 0, failed = 0;

  for (const att of pdfAttachments) {
    const email = emailMap.get(att.email_id);
    if (!email?.gmail_message_id) {
      console.log(`\n⚠️ ${att.filename}: No Gmail ID`);
      failed++;
      continue;
    }

    console.log(`\n─── ${att.filename} ───`);
    console.log(`  Subject: ${email.subject?.substring(0, 50)}...`);

    const text = await refetchAndExtract(email.gmail_message_id, att.filename);

    if (!text || text.length < 50) {
      console.log(`  ⚠️ Extracted ${text?.length || 0} chars (too short)`);
      failed++;
      continue;
    }

    // Update database
    const { error } = await supabase
      .from('raw_attachments')
      .update({ extracted_text: text })
      .eq('id', att.id);

    if (error) {
      console.log(`  ❌ DB error: ${error.message}`);
      failed++;
    } else {
      console.log(`  ✅ Extracted ${text.length} chars`);
      success++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`COMPLETE: ${success} success, ${failed} failed`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
