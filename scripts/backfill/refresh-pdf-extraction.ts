#!/usr/bin/env npx tsx
/**
 * Re-fetch PDFs from Gmail with Fresh Attachment IDs
 *
 * The stored attachment tokens have expired.
 * This script re-fetches the email from Gmail to get fresh attachment IDs.
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import pdfParse from 'pdf-parse-fork';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const gmailClientId = process.env.GMAIL_CLIENT_ID;
const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET;
const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;

if (!supabaseUrl || !supabaseKey || !gmailClientId || !gmailClientSecret || !gmailRefreshToken) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const oauth2Client = new OAuth2Client(gmailClientId, gmailClientSecret);
oauth2Client.setCredentials({ refresh_token: gmailRefreshToken });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

interface AttachmentInfo {
  filename: string;
  attachmentId: string;
  mimeType: string;
}

function findPdfAttachments(parts: any[], attachments: AttachmentInfo[] = []): AttachmentInfo[] {
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      const mimeType = part.mimeType || '';
      if (mimeType.includes('pdf') || part.filename.toLowerCase().endsWith('.pdf')) {
        attachments.push({
          filename: part.filename,
          attachmentId: part.body.attachmentId,
          mimeType: mimeType
        });
      }
    }
    if (part.parts) {
      findPdfAttachments(part.parts, attachments);
    }
  }
  return attachments;
}

async function downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
  try {
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });

    if (!response.data.data) return null;

    const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(data, 'base64');
  } catch (error: any) {
    console.error(`  Download error: ${error.message}`);
    return null;
  }
}

async function extractTextFromPdf(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.text || null;
  } catch (error: any) {
    console.error(`  PDF parse error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('=== REFRESH PDF EXTRACTION FROM GMAIL ===\n');

  // Test Gmail connection
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('Gmail connected:', profile.data.emailAddress);
  } catch (error: any) {
    console.error('Gmail connection failed:', error.message);
    process.exit(1);
  }

  // Get attachments that need text extraction
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename')
    .ilike('mime_type', '%pdf%')
    .is('extracted_text', null)
    .limit(100);

  console.log('PDFs needing extraction:', attachments?.length || 0);

  if (!attachments || attachments.length === 0) {
    console.log('No PDFs need processing');
    return;
  }

  // Get email gmail_message_ids
  const emailIds = [...new Set(attachments.map(a => a.email_id))];
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id')
    .in('id', emailIds);

  const emailToGmailId = new Map<string, string>();
  emails?.forEach(e => {
    if (e.gmail_message_id) {
      emailToGmailId.set(e.id, e.gmail_message_id);
    }
  });

  console.log('Emails with Gmail ID:', emailToGmailId.size);

  const stats = {
    processed: 0,
    fetched: 0,
    extracted: 0,
    failed: 0,
  };

  // Process each attachment
  for (const att of attachments) {
    stats.processed++;

    if (stats.processed % 10 === 0) {
      console.log(`Progress: ${stats.processed}/${attachments.length} (extracted: ${stats.extracted})`);
    }

    const gmailMessageId = emailToGmailId.get(att.email_id);
    if (!gmailMessageId) {
      stats.failed++;
      continue;
    }

    try {
      // Fetch fresh message from Gmail
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: gmailMessageId,
        format: 'full'
      });

      // Find PDF attachments
      const pdfAttachments = findPdfAttachments(message.data.payload?.parts || []);

      // Also check top-level
      if (message.data.payload?.body?.attachmentId && message.data.payload?.filename) {
        const mimeType = message.data.payload.mimeType || '';
        if (mimeType.includes('pdf') || message.data.payload.filename.toLowerCase().endsWith('.pdf')) {
          pdfAttachments.push({
            filename: message.data.payload.filename,
            attachmentId: message.data.payload.body.attachmentId,
            mimeType
          });
        }
      }

      // Find matching attachment
      const attFilename = att.filename.toLowerCase();
      const matchingPdf = pdfAttachments.find(p =>
        p.filename.toLowerCase() === attFilename ||
        p.filename.toLowerCase().includes(attFilename.split('.')[0])
      );

      if (!matchingPdf) {
        console.log(`  No matching PDF for: ${att.filename}`);
        stats.failed++;
        continue;
      }

      stats.fetched++;

      // Download with fresh attachment ID
      const pdfBuffer = await downloadAttachment(gmailMessageId, matchingPdf.attachmentId);
      if (!pdfBuffer) {
        stats.failed++;
        continue;
      }

      // Extract text
      const text = await extractTextFromPdf(pdfBuffer);
      if (!text || text.trim().length === 0) {
        await supabase
          .from('raw_attachments')
          .update({
            extraction_status: 'failed',
            extraction_error: 'No text extracted',
            extracted_at: new Date().toISOString()
          })
          .eq('id', att.id);
        stats.failed++;
        continue;
      }

      // Save extracted text
      const { error } = await supabase
        .from('raw_attachments')
        .update({
          extracted_text: text,
          extraction_status: 'completed',
          extracted_at: new Date().toISOString()
        })
        .eq('id', att.id);

      if (!error) {
        stats.extracted++;
        console.log(`  ✓ ${att.filename}: ${text.length} chars`);
      } else {
        stats.failed++;
      }

    } catch (error: any) {
      console.error(`  Error: ${error.message}`);
      stats.failed++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Fetched from Gmail:', stats.fetched);
  console.log('Text extracted:', stats.extracted);
  console.log('Failed:', stats.failed);

  // Final counts
  const { count: totalPdfs } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%');

  const { count: withText } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null);

  console.log('\n=== PDF STATUS ===');
  console.log('Total PDFs:', totalPdfs);
  console.log('With extracted text:', withText);
  console.log('Still pending:', (totalPdfs || 0) - (withText || 0));
}

main().catch(console.error);
