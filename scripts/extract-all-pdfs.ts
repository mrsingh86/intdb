/**
 * Extract All PDFs Script
 *
 * Downloads PDFs from Gmail and extracts text using DeepPdfExtractor
 * with OCR and table extraction support.
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { DeepPdfExtractor, DeepExtractionResult } from '../lib/services/deep-pdf-extractor';

// Environment
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Gmail OAuth setup
function getGmailClient() {
  const oauth2Client = new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

interface AttachmentToProcess {
  id: string;
  email_id: string;
  filename: string;
  gmail_attachment_id: string;  // Extracted from storage_path (gmail://[id])
  gmail_message_id: string;
}

async function getAttachmentsToProcess(limit: number, reprocessAll: boolean = false, offset: number = 0): Promise<AttachmentToProcess[]> {
  // Get PDFs that have storage_path (Gmail reference)
  // storage_path format: gmail://[attachment_id]
  // If reprocessAll=true, get all PDFs regardless of extraction status (with offset pagination)
  let query = supabase
    .from('raw_attachments')
    .select('id, email_id, filename, storage_path, raw_emails!inner(gmail_message_id)')
    .ilike('filename', '%.pdf')
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: true });

  if (!reprocessAll) {
    query = query.is('extracted_text', null);
  }

  const { data: attachments, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error('Error fetching attachments:', error);
    return [];
  }

  return (attachments || []).map(a => {
    // Extract Gmail attachment ID from storage_path (format: gmail://[id])
    const storagePath = a.storage_path || '';
    const gmailAttachmentId = storagePath.startsWith('gmail://')
      ? storagePath.slice(8)  // Remove 'gmail://' prefix
      : null;

    return {
      id: a.id,
      email_id: a.email_id,
      filename: a.filename,
      gmail_attachment_id: gmailAttachmentId,
      gmail_message_id: (a.raw_emails as any)?.gmail_message_id
    };
  }).filter(a => a.gmail_message_id && a.gmail_attachment_id);
}

async function downloadAttachment(
  gmail: any,
  messageId: string,
  filename: string
): Promise<Buffer | null> {
  try {
    // First, get the message to find the current attachment ID
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId
    });

    // Find the attachment by filename
    const attachmentId = findAttachmentId(message.data.payload?.parts || [], filename);

    if (!attachmentId) {
      console.error(`Attachment not found in message: ${filename}`);
      return null;
    }

    // Now download the attachment
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId
    });

    if (response.data && response.data.data) {
      // Gmail returns base64url encoded data
      const base64Data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64Data, 'base64');
    }
    return null;
  } catch (error: any) {
    console.error(`Failed to download attachment: ${error.message}`);
    return null;
  }
}

function findAttachmentId(parts: any[], filename: string): string | null {
  for (const part of parts) {
    if (part.filename === filename && part.body?.attachmentId) {
      return part.body.attachmentId;
    }
    if (part.parts) {
      const found = findAttachmentId(part.parts, filename);
      if (found) return found;
    }
  }
  return null;
}

async function updateAttachment(
  id: string,
  result: DeepExtractionResult
): Promise<void> {
  // Only use columns that exist in raw_attachments table
  const updateData: any = {
    extracted_text: result.text,
    extracted_at: new Date().toISOString(),
    extraction_status: result.success ? 'completed' : 'failed'
  };

  if (result.error) {
    updateData.extraction_error = result.error;
  }

  const { error } = await supabase
    .from('raw_attachments')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error(`Failed to update attachment ${id}:`, error);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('DEEP PDF EXTRACTION - ALL ATTACHMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const batchSize = parseInt(process.env.BATCH_SIZE || '50', 10);
  const maxTotal = parseInt(process.env.MAX_TOTAL || '2000', 10);
  const enableOcr = process.env.ENABLE_OCR !== 'false';
  const enableTables = process.env.ENABLE_TABLES !== 'false';
  const reprocessAll = process.env.REPROCESS_ALL === 'true';

  console.log(`Settings:`);
  console.log(`  Batch size: ${batchSize}`);
  console.log(`  Max total: ${maxTotal}`);
  console.log(`  OCR enabled: ${enableOcr}`);
  console.log(`  Table extraction: ${enableTables}`);
  console.log(`  Reprocess all: ${reprocessAll}`);
  console.log('');

  const gmail = getGmailClient();
  const extractor = new DeepPdfExtractor({
    enableOcr,
    enableTables,
    maxPages: 10
  });

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalOcr = 0;
  let totalTables = 0;
  let currentOffset = 0;  // For pagination when reprocessing all

  while (totalProcessed < maxTotal) {
    // Get batch of attachments (with offset for reprocess mode)
    const attachments = await getAttachmentsToProcess(batchSize, reprocessAll, reprocessAll ? currentOffset : 0);
    currentOffset += batchSize;  // Move to next page

    if (attachments.length === 0) {
      console.log('No more attachments to process');
      break;
    }

    console.log(`\nProcessing batch of ${attachments.length} PDFs...`);
    console.log('─'.repeat(70));

    for (const att of attachments) {
      try {
        process.stdout.write(`  ${att.filename.substring(0, 40).padEnd(40)}... `);

        // Download from Gmail by fetching message and finding attachment by filename
        const buffer = await downloadAttachment(gmail, att.gmail_message_id, att.filename);

        if (!buffer) {
          console.log('❌ Download failed');
          await updateAttachment(att.id, {
            success: false,
            text: '',
            tables: [],
            pageCount: 0,
            method: 'pdf-parse',
            ocrUsed: false,
            confidence: 0,
            error: 'Failed to download from Gmail',
            metadata: { hasImages: false, tableCount: 0, textLength: 0, extractionTimeMs: 0 }
          });
          totalFailed++;
          totalProcessed++;
          continue;
        }

        // Extract
        const result = await extractor.extract(buffer, att.filename);

        // Update database
        await updateAttachment(att.id, result);

        // Stats
        if (result.success) {
          totalSuccess++;
          if (result.ocrUsed) totalOcr++;
          if (result.tables.length > 0) totalTables++;
          const tableInfo = result.tables.length > 0 ? ` +${result.tables.length} tables` : '';
          const ocrInfo = result.ocrUsed ? '+OCR' : '';
          console.log(`✅ ${result.text.length} chars (${result.method}${ocrInfo}${tableInfo})`);
        } else {
          totalFailed++;
          console.log(`❌ ${result.error || 'Unknown error'}`);
        }

        totalProcessed++;

      } catch (error: any) {
        console.log(`❌ Error: ${error.message}`);
        totalFailed++;
        totalProcessed++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Progress summary
    console.log('');
    console.log(`Progress: ${totalProcessed}/${maxTotal} | Success: ${totalSuccess} | Failed: ${totalFailed} | OCR: ${totalOcr} | Tables: ${totalTables}`);
  }

  // Cleanup
  await extractor.terminate();

  // Final summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('EXTRACTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  const successRate = totalProcessed > 0 ? Math.round(totalSuccess / totalProcessed * 100) : 0;
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Successful:      ${totalSuccess} (${successRate}%)`);
  console.log(`  Failed:          ${totalFailed}`);
  console.log(`  Used OCR:        ${totalOcr}`);
  console.log(`  Had tables:      ${totalTables}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
