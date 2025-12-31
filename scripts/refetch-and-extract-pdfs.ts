#!/usr/bin/env npx tsx
/**
 * Re-fetch emails from Gmail and extract PDF text
 * This is needed when attachment tokens have expired
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import pdfParse from 'pdf-parse-fork';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const gmailClientId = process.env.GMAIL_CLIENT_ID;
const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET;
const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;

if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken) {
  console.error('Missing Gmail credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const oauth2Client = new OAuth2Client(gmailClientId, gmailClientSecret);
oauth2Client.setCredentials({ refresh_token: gmailRefreshToken });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

async function getMessageWithAttachments(messageId: string): Promise<AttachmentInfo[]> {
  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const attachments: AttachmentInfo[] = [];

    function extractAttachments(part: any) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0
        });
      }
      if (part.parts) {
        for (const subPart of part.parts) {
          extractAttachments(subPart);
        }
      }
    }

    if (response.data.payload) {
      extractAttachments(response.data.payload);
    }

    return attachments;
  } catch (error: any) {
    console.log(`  Error getting message: ${error.message?.substring(0, 50)}`);
    return [];
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

    const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(data, 'base64');

    const pdfData = await pdfParse(buffer);
    return pdfData.text || null;
  } catch (error: any) {
    console.log(`  Error: ${error.message?.substring(0, 50)}`);
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     RE-FETCH AND EXTRACT PDF TEXT FROM GMAIL                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Test Gmail connection
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('Gmail connected:', profile.data.emailAddress);
  } catch (error: any) {
    console.error('Gmail connection failed:', error.message);
    process.exit(1);
  }

  // Get attachments without extracted text that are PDFs
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, extracted_text')
    .is('extracted_text', null);

  // Filter to PDFs
  const pdfAttachments = (attachments || []).filter(a =>
    (a.mime_type && a.mime_type.toLowerCase().includes('pdf')) ||
    (a.filename && a.filename.toLowerCase().endsWith('.pdf'))
  );

  console.log('PDFs without extracted text:', pdfAttachments.length);

  if (pdfAttachments.length === 0) {
    console.log('No PDFs need processing!');
    return;
  }

  // Get unique email IDs
  const emailIds = [...new Set(pdfAttachments.map(a => a.email_id))];
  console.log('Unique emails to re-fetch:', emailIds.length);

  // Get email gmail_message_ids
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

  const stats = {
    processed: 0,
    refetched: 0,
    extracted: 0,
    failed: 0,
    notFound: 0,
  };

  // Group attachments by email
  const byEmail = new Map<string, typeof pdfAttachments>();
  for (const att of pdfAttachments) {
    const list = byEmail.get(att.email_id) || [];
    list.push(att);
    byEmail.set(att.email_id, list);
  }

  // Process each email
  for (const [emailId, atts] of byEmail) {
    const gmailId = emailToGmailId.get(emailId);
    if (!gmailId) {
      stats.notFound += atts.length;
      continue;
    }

    // Re-fetch message to get fresh attachment IDs
    const freshAttachments = await getMessageWithAttachments(gmailId);
    stats.refetched++;

    if (freshAttachments.length === 0) {
      stats.failed += atts.length;
      continue;
    }

    // Match by filename and extract
    for (const att of atts) {
      stats.processed++;

      if (stats.processed % 20 === 0) {
        console.log(`\nProgress: ${stats.processed}/${pdfAttachments.length} (extracted: ${stats.extracted})`);
      }

      // Find matching fresh attachment by filename
      const freshAtt = freshAttachments.find(f =>
        f.filename.toLowerCase() === att.filename.toLowerCase()
      );

      if (!freshAtt) {
        console.log(`  Not found: ${att.filename}`);
        stats.failed++;
        continue;
      }

      // Download and extract
      const text = await downloadAndExtractPdf(gmailId, freshAtt.attachmentId);

      if (!text || text.trim().length === 0) {
        await supabase
          .from('raw_attachments')
          .update({
            extraction_status: 'failed',
            extraction_error: 'No text extracted from PDF',
            extracted_at: new Date().toISOString()
          })
          .eq('id', att.id);
        stats.failed++;
        continue;
      }

      // Save text
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

      // Rate limit
      await new Promise(r => setTimeout(r, 150));
    }
  }

  console.log('\n\n════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('Processed:', stats.processed);
  console.log('Emails refetched:', stats.refetched);
  console.log('Text extracted:', stats.extracted);
  console.log('Failed:', stats.failed);
  console.log('Not found:', stats.notFound);

  // Final counts
  const { data: allPdfs } = await supabase
    .from('raw_attachments')
    .select('filename, mime_type, extracted_text');

  const pdfs = (allPdfs || []).filter(a =>
    (a.mime_type && a.mime_type.toLowerCase().includes('pdf')) ||
    (a.filename && a.filename.toLowerCase().endsWith('.pdf'))
  );
  const withText = pdfs.filter(p => p.extracted_text && p.extracted_text.length > 0);

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('PDF STATUS');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('Total PDFs:', pdfs.length);
  console.log('With extracted text:', withText.length);
  console.log('Still pending:', pdfs.length - withText.length);
}

main().catch(console.error);
