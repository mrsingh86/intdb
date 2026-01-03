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

// Find attachment ID by filename from Gmail message
async function findAttachmentId(messageId: string, filename: string): Promise<string | null> {
  try {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const parts = message.data.payload?.parts || [];

    // Recursively search for attachment
    function searchParts(parts: any[]): string | null {
      for (const part of parts) {
        if (part.filename === filename && part.body?.attachmentId) {
          return part.body.attachmentId;
        }
        if (part.parts) {
          const found = searchParts(part.parts);
          if (found) return found;
        }
      }
      return null;
    }

    return searchParts(parts);
  } catch (error: any) {
    console.log(`    Error finding attachment: ${error.message?.substring(0, 60)}`);
    return null;
  }
}

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

  // Get PDF attachments without extracted text (server-side filtering)
  // Using OR filter for mime_type containing 'pdf' OR filename ending with '.pdf'
  const { data: pdfByMime } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, storage_path')
    .is('extracted_text', null)
    .ilike('mime_type', '%pdf%');

  const { data: pdfByFilename } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, storage_path')
    .is('extracted_text', null)
    .ilike('filename', '%.pdf');

  // Combine and deduplicate by id
  const allPdfs = [...(pdfByMime || []), ...(pdfByFilename || [])];
  const seenIds = new Set<string>();
  const pdfAttachments = allPdfs.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });

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

    // Find attachment ID by searching the Gmail message (stored IDs may be expired)
    const attachmentId = await findAttachmentId(email.gmail_message_id, att.filename);
    if (!attachmentId) {
      console.log('  ⚠️ Attachment not found in Gmail message');
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
      .update({
        extracted_text: text,
        extraction_status: 'completed',
        extracted_at: new Date().toISOString()
      })
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
