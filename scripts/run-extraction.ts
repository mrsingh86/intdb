/**
 * Run PDF Text Extraction
 *
 * Fetches PDFs from Gmail (re-fetches message to get fresh attachment IDs)
 * and extracts text for pending attachments.
 *
 * Run: npx tsx scripts/run-extraction.ts
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { createRequire } from 'module';
import * as dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

dotenv.config({ path: '.env' });

const MAX_PER_RUN = 100;

interface GmailPart {
  partId: string;
  mimeType: string;
  filename: string;
  body: {
    attachmentId?: string;
    size: number;
    data?: string;
  };
  parts?: GmailPart[];
}

function findAttachmentPart(parts: GmailPart[] | undefined, filename: string): GmailPart | null {
  if (!parts) return null;

  for (const part of parts) {
    if (part.filename === filename && part.body?.attachmentId) {
      return part;
    }
    if (part.parts) {
      const found = findAttachmentPart(part.parts, filename);
      if (found) return found;
    }
  }
  return null;
}

async function runExtraction() {
  const startTime = Date.now();
  const stats = {
    pending_found: 0,
    extracted: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  console.log('='.repeat(80));
  console.log('PDF TEXT EXTRACTION (Re-fetch mode)');
  console.log('='.repeat(80));

  // Initialize clients
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Get pending PDF attachments
  const { data: pending, error: fetchError } = await supabase
    .from('raw_attachments')
    .select(`
      id,
      email_id,
      filename,
      mime_type,
      storage_path,
      raw_emails!inner (
        gmail_message_id
      )
    `)
    .eq('extraction_status', 'pending')
    .or('mime_type.eq.application/pdf,filename.ilike.%.pdf')
    .limit(MAX_PER_RUN);

  if (fetchError) {
    console.error('Error fetching pending:', fetchError);
    return;
  }

  stats.pending_found = pending?.length || 0;
  console.log(`Found ${stats.pending_found} pending attachments\n`);

  if (!pending || pending.length === 0) {
    console.log('No pending attachments to process.');
    return;
  }

  // Group by gmail_message_id to minimize API calls
  const byMessageId = new Map<string, typeof pending>();
  for (const att of pending) {
    const rawEmail = Array.isArray(att.raw_emails) ? att.raw_emails[0] : att.raw_emails;
    const msgId = rawEmail?.gmail_message_id;
    if (!msgId) continue;

    if (!byMessageId.has(msgId)) byMessageId.set(msgId, []);
    byMessageId.get(msgId)!.push(att);
  }

  console.log(`Processing ${byMessageId.size} unique emails...\n`);

  // Process each message
  for (const [messageId, attachments] of byMessageId) {
    try {
      // Fetch fresh message to get current attachment IDs
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const parts = message.data.payload?.parts;

      for (const attachment of attachments) {
        try {
          process.stdout.write(`  ${attachment.filename}... `);

          // Find matching attachment part by filename
          const part = findAttachmentPart(parts, attachment.filename);
          if (!part || !part.body?.attachmentId) {
            console.log('NOT FOUND');
            stats.skipped++;
            await updateStatus(supabase, attachment.id, 'skipped', null, 'Attachment not found in message');
            continue;
          }

          // Fetch attachment with fresh ID
          const gmailResponse = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: part.body.attachmentId,
          });

          const base64Data = gmailResponse.data.data;
          if (!base64Data) {
            console.log('NO DATA');
            stats.failed++;
            await updateStatus(supabase, attachment.id, 'failed', null, 'No data from Gmail');
            continue;
          }

          // Convert and extract
          const pdfBuffer = Buffer.from(base64Data, 'base64url');

          let extractedText = '';
          try {
            const pdfData = await pdfParse(pdfBuffer);
            extractedText = pdfData.text?.trim() || '';
          } catch (pdfErr: any) {
            console.log(`PARSE ERROR: ${pdfErr.message}`);
            stats.failed++;
            await updateStatus(supabase, attachment.id, 'failed', null, `PDF parse error: ${pdfErr.message}`);
            continue;
          }

          if (extractedText.length === 0) {
            console.log('EMPTY');
            stats.failed++;
            await updateStatus(supabase, attachment.id, 'failed', null, 'PDF contains no extractable text');
            continue;
          }

          // Success
          await updateStatus(supabase, attachment.id, 'completed', extractedText, null);
          stats.extracted++;
          console.log(`OK (${extractedText.length} chars)`);

        } catch (err: any) {
          console.log(`ERROR: ${err.message}`);
          stats.failed++;
          stats.errors.push(`${attachment.filename}: ${err.message}`);
          await updateStatus(supabase, attachment.id, 'failed', null, err.message);
        }
      }
    } catch (msgErr: any) {
      console.log(`  Message ${messageId}: ${msgErr.message}`);
      // Mark all attachments for this message as failed
      for (const att of attachments) {
        stats.failed++;
        await updateStatus(supabase, att.id, 'failed', null, `Message fetch error: ${msgErr.message}`);
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n');
  console.log('='.repeat(80));
  console.log('EXTRACTION RESULTS');
  console.log('='.repeat(80));
  console.log(`Duration:          ${duration} seconds`);
  console.log(`Pending found:     ${stats.pending_found}`);
  console.log(`Extracted:         ${stats.extracted}`);
  console.log(`Failed:            ${stats.failed}`);
  console.log(`Skipped:           ${stats.skipped}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    stats.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  // Check remaining
  const { count } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'pending');

  console.log(`\nRemaining pending: ${count || 0}`);
  if ((count || 0) > 0) {
    console.log('Run again to process more.');
  }
}

async function updateStatus(
  supabase: any,
  attachmentId: string,
  status: string,
  extractedText: string | null,
  error: string | null
) {
  await supabase
    .from('raw_attachments')
    .update({
      extraction_status: status,
      extracted_text: extractedText,
      extraction_error: error,
      extracted_at: new Date().toISOString(),
    })
    .eq('id', attachmentId);
}

runExtraction().catch(console.error);
