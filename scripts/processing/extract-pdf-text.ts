#!/usr/bin/env npx tsx
/**
 * Extract Text from PDF Attachments
 *
 * Downloads PDFs from Gmail and extracts text using pdf-parse
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import pdfParse from 'pdf-parse-fork';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
  console.error('Missing Gmail credentials in .env');
  console.error('Required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Gmail client
const oauth2Client = new OAuth2Client(
  gmailClientId,
  gmailClientSecret,
  process.env.GMAIL_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: gmailRefreshToken
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

async function downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
  try {
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });

    if (!response.data.data) {
      return null;
    }

    // Decode base64url to Buffer
    const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(data, 'base64');
  } catch (error: any) {
    if (error.code === 404) {
      console.error(`  Attachment not found: ${attachmentId}`);
    } else {
      console.error(`  Download error: ${error.message}`);
    }
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
  console.log('=== PDF TEXT EXTRACTION ===\n');

  // Test Gmail connection
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('Gmail connected:', profile.data.emailAddress);
  } catch (error: any) {
    console.error('Gmail connection failed:', error.message);
    process.exit(1);
  }

  // Get PDF attachments that need text extraction
  const { data: attachments, error } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, storage_path, attachment_id')
    .ilike('mime_type', '%pdf%')
    .is('extracted_text', null)
    .order('created_at', { ascending: false })
    .limit(200); // Process in batches

  if (error) {
    console.error('Database error:', error.message);
    process.exit(1);
  }

  console.log('PDFs to process:', attachments?.length || 0);

  if (!attachments || attachments.length === 0) {
    console.log('No PDFs need processing');
    return;
  }

  // Get email gmail_message_ids for lookup
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

  // Stats
  const stats = {
    processed: 0,
    downloaded: 0,
    extracted: 0,
    failed: 0,
    noGmailId: 0,
  };

  // Process each attachment
  for (const att of attachments) {
    stats.processed++;

    if (stats.processed % 20 === 0) {
      console.log(`\nProgress: ${stats.processed}/${attachments.length} (extracted: ${stats.extracted})`);
    }

    // Get Gmail message ID
    const gmailMessageId = emailToGmailId.get(att.email_id);
    if (!gmailMessageId) {
      stats.noGmailId++;
      continue;
    }

    // Parse attachment ID from storage_path (format: gmail://ATTACHMENT_ID)
    // The Gmail attachment ID is stored in storage_path, NOT attachment_id
    let attachmentId: string | null = null;
    if (att.storage_path) {
      const match = att.storage_path.match(/gmail:\/\/(.+)/);
      if (match) {
        attachmentId = match[1];
      }
    }

    if (!attachmentId) {
      console.log(`  No attachment ID for: ${att.filename}`);
      stats.failed++;
      continue;
    }

    // Download attachment
    const pdfBuffer = await downloadAttachment(gmailMessageId, attachmentId);
    if (!pdfBuffer) {
      stats.failed++;
      continue;
    }
    stats.downloaded++;

    // Extract text
    const text = await extractTextFromPdf(pdfBuffer);
    if (!text || text.trim().length === 0) {
      // Update as failed extraction
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

    // Save extracted text
    const { error: updateError } = await supabase
      .from('raw_attachments')
      .update({
        extracted_text: text,
        extraction_status: 'completed',
        extracted_at: new Date().toISOString()
      })
      .eq('id', att.id);

    if (!updateError) {
      stats.extracted++;
      if (text.length > 500) {
        console.log(`  ✓ ${att.filename}: ${text.length} chars`);
      }
    } else {
      console.error(`  Update error: ${updateError.message}`);
      stats.failed++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Downloaded:', stats.downloaded);
  console.log('Text extracted:', stats.extracted);
  console.log('Failed:', stats.failed);
  console.log('No Gmail ID:', stats.noGmailId);

  // Show updated counts
  const { count: totalPdfs } = await supabase
    .from('raw_attachments')
    .select('id', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%');

  const { count: withText } = await supabase
    .from('raw_attachments')
    .select('id', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null);

  console.log('\n=== PDF STATUS ===');
  console.log('Total PDFs:', totalPdfs);
  console.log('With extracted text:', withText);
  console.log('Still pending:', (totalPdfs || 0) - (withText || 0));
}

main().catch(console.error);
