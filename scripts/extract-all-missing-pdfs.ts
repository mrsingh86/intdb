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
}

function findAttachments(part: any): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (part.filename && part.body?.attachmentId) {
    attachments.push({
      filename: part.filename,
      attachmentId: part.body.attachmentId
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
    const msgResponse = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'full'
    });

    if (!msgResponse.data.payload) return null;

    const allAttachments = findAttachments(msgResponse.data.payload);
    const target = allAttachments.find(a => a.filename === targetFilename);

    if (!target) {
      console.log(`    Not found: ${targetFilename}`);
      return null;
    }

    const attResponse = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: gmailMessageId,
      id: target.attachmentId
    });

    if (!attResponse.data.data) return null;

    const data = attResponse.data.data.replace(/-/g, '+').replace(/_/g, '/');
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
  console.log('EXTRACT ALL MISSING PDFs');
  console.log('═'.repeat(70));

  const profile = await gmail.users.getProfile({ userId: 'me' });
  console.log('Gmail:', profile.data.emailAddress);

  // Get PDFs with NULL or very short extracted_text
  const { data: allPdfs } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, extracted_text')
    .or('filename.ilike.%.pdf,mime_type.ilike.%pdf%');

  // Filter to those needing extraction
  const needsExtraction = (allPdfs || []).filter(a =>
    a.extracted_text === null || a.extracted_text.length < 100
  );

  console.log(`PDFs needing extraction: ${needsExtraction.length}\n`);

  // Focus on our 3 CMA CGM bookings first
  const priorityFiles = ['BKGCONF_CAD0850107.pdf', 'BKGCONF_AMC2482410.pdf', 'BKGCONF_CAD0850214.pdf'];
  const priority = needsExtraction.filter(a => priorityFiles.includes(a.filename));
  const others = needsExtraction.filter(a => !priorityFiles.includes(a.filename));

  const toProcess = [...priority, ...others.slice(0, 10)]; // Process priority + first 10 others

  // Get email gmail_message_ids
  const emailIds = [...new Set(toProcess.map(a => a.email_id))];
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  let success = 0, failed = 0;

  for (const att of toProcess) {
    const email = emailMap.get(att.email_id);
    if (!email?.gmail_message_id) {
      console.log(`⚠️ ${att.filename}: No Gmail ID`);
      failed++;
      continue;
    }

    console.log(`─── ${att.filename} ───`);

    const text = await refetchAndExtract(email.gmail_message_id, att.filename);

    if (!text || text.length < 50) {
      console.log(`  ⚠️ Only ${text?.length || 0} chars`);
      failed++;
      continue;
    }

    const { error } = await supabase
      .from('raw_attachments')
      .update({ extracted_text: text })
      .eq('id', att.id);

    if (error) {
      console.log(`  ❌ ${error.message}`);
      failed++;
    } else {
      console.log(`  ✅ ${text.length} chars`);
      success++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`DONE: ${success} extracted, ${failed} failed`);
}

main().catch(console.error);
