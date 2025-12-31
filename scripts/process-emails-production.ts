/**
 * PRODUCTION EMAIL PROCESSING SCRIPT
 *
 * This script consolidates all learnings about email/attachment extraction:
 * 1. Fetches emails from Gmail
 * 2. Saves email metadata to raw_emails
 * 3. Saves ALL attachments to raw_attachments
 * 4. Extracts text from PDF attachments
 * 5. Updates body_text with extracted content
 * 6. Idempotent - safe to run multiple times
 *
 * Run with: npx tsx scripts/process-emails-production.ts
 */

import dotenv from 'dotenv';
import GmailClient from '../utils/gmail-client';
import Logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

dotenv.config();

const logger = new Logger('EmailProcessor');

// CRITICAL: Use service role to bypass RLS
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface ProcessingStats {
  emailsProcessed: number;
  emailsSkipped: number;
  emailsFailed: number;
  attachmentsSaved: number;
  pdfsExtracted: number;
  errors: string[];
}

async function processEmails() {
  const stats: ProcessingStats = {
    emailsProcessed: 0,
    emailsSkipped: 0,
    emailsFailed: 0,
    attachmentsSaved: 0,
    pdfsExtracted: 0,
    errors: []
  };

  logger.info('=== STARTING EMAIL PROCESSING ===');

  try {
    // Initialize Gmail client
    const gmailClient = new GmailClient({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      redirect_uri: process.env.GMAIL_REDIRECT_URI!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!
    });

    // Get list of message IDs from Gmail
    logger.info('Fetching message IDs from Gmail...');
    const result = await gmailClient.listMessages('is:inbox', 100);
    const messageIds = result.messages;

    logger.info(`Found ${messageIds.length} messages in Gmail`);

    // Process each email
    for (let i = 0; i < messageIds.length; i++) {
      const messageId = messageIds[i];
      logger.info(`\n[${i + 1}/${messageIds.length}] Processing: ${messageId}`);

      try {
        await processEmail(gmailClient, messageId, stats);
      } catch (error: any) {
        logger.error(`Failed to process ${messageId}:`, error.message);
        stats.emailsFailed++;
        stats.errors.push(`${messageId}: ${error.message}`);
      }

      // Rate limiting delay
      if ((i + 1) % 10 === 0) {
        logger.info('Rate limit pause...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

  } catch (error: any) {
    logger.error('Fatal error:', error);
    throw error;
  } finally {
    printSummary(stats);
  }
}

async function processEmail(
  gmailClient: GmailClient,
  messageId: string,
  stats: ProcessingStats
): Promise<void> {

  // STEP 1: Check if email already exists (IDEMPOTENCY)
  const { data: existing } = await supabase
    .from('raw_emails')
    .select('id, has_attachments, attachment_count, body_text')
    .eq('gmail_message_id', messageId)
    .single();

  if (existing) {
    // Email exists - check if we need to process attachments or extract PDFs
    const needsAttachmentProcessing = existing.has_attachments &&
      (!existing.body_text || existing.body_text.trim() === '');

    if (!needsAttachmentProcessing) {
      logger.info('  ✓ Already processed - skipping');
      stats.emailsSkipped++;
      return;
    }

    logger.info('  → Needs attachment/PDF processing');
  }

  // STEP 2: Fetch full email from Gmail
  logger.info('  Fetching from Gmail...');
  const emailData = await gmailClient.getMessage(messageId);

  // STEP 3: Save or update email metadata
  const emailRecord = {
    gmail_message_id: messageId,
    thread_id: emailData.threadId || messageId,
    subject: emailData.subject || '(No Subject)',
    sender_email: emailData.from || 'unknown@unknown.com',
    sender_name: emailData.fromName || null,
    recipient_emails: emailData.to || '',
    body_text: emailData.bodyText || null,
    body_html: emailData.bodyHtml || null,
    snippet: emailData.snippet || null,
    received_at: emailData.receivedAt || new Date().toISOString(),
    has_attachments: emailData.hasAttachments || false,
    attachment_count: emailData.attachments?.length || 0,
    labels: Array.isArray(emailData.labels) ? emailData.labels : [],
    is_duplicate: false,
    thread_position: 1,
    processing_status: 'pending',
    headers: emailData.headers || {}
  };

  let emailId = existing?.id;

  if (!existing) {
    // Insert new email
    const { data: inserted, error: insertError } = await supabase
      .from('raw_emails')
      .insert(emailRecord)
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        logger.info('  ✓ Already exists (duplicate)');
        stats.emailsSkipped++;
        return;
      }
      throw insertError;
    }

    emailId = inserted.id;
    logger.info(`  ✓ Saved email: ${emailId}`);
  } else {
    logger.info(`  ✓ Using existing: ${emailId}`);
  }

  // STEP 4: Process attachments if present
  if (emailData.hasAttachments && emailData.attachments && emailData.attachments.length > 0) {
    logger.info(`  Processing ${emailData.attachments.length} attachments...`);

    // Check how many attachments already saved
    const { count: existingAttachments } = await supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', emailId);

    if (existingAttachments && existingAttachments >= emailData.attachments.length) {
      logger.info(`  ✓ All ${existingAttachments} attachments already saved`);
    } else {
      let savedCount = 0;
      let pdfTextParts: string[] = [];

      for (const attachment of emailData.attachments) {
        try {
          // Generate short attachment ID
          const shortAttachmentId = `${emailId.substring(0, 8)}-${savedCount}`;
          const storagePath = `gmail://${attachment.attachmentId}`;

          // Check if this specific attachment already exists
          const { count: exists } = await supabase
            .from('raw_attachments')
            .select('*', { count: 'exact', head: true })
            .eq('email_id', emailId)
            .eq('filename', attachment.filename);

          if (exists && exists > 0) {
            logger.info(`    ✓ ${attachment.filename} already saved`);
            continue;
          }

          // Save attachment record
          const { error: attError } = await supabase
            .from('raw_attachments')
            .insert({
              email_id: emailId,
              filename: attachment.filename,
              mime_type: attachment.mimeType,
              size_bytes: attachment.sizeBytes,
              storage_path: storagePath.substring(0, 199),
              attachment_id: shortAttachmentId,
              extraction_status: 'pending'
            });

          if (attError && attError.code !== '23505') {
            logger.error(`    ✗ Failed to save ${attachment.filename}:`, attError.message);
            continue;
          }

          savedCount++;
          stats.attachmentsSaved++;
          logger.info(`    ✓ Saved: ${attachment.filename}`);

          // STEP 5: Extract text from PDFs
          if (attachment.mimeType === 'application/pdf') {
            try {
              logger.info(`    → Extracting PDF: ${attachment.filename}`);

              const pdfBuffer = await gmailClient.getAttachment(messageId, attachment.attachmentId);
              const pdfData = await pdfParse(pdfBuffer);
              const extractedText = pdfData.text.trim();

              if (extractedText && extractedText.length > 0) {
                pdfTextParts.push(`=== ${attachment.filename} ===\n\n${extractedText}`);
                stats.pdfsExtracted++;

                // Update attachment extraction status
                await supabase
                  .from('raw_attachments')
                  .update({ extraction_status: 'completed' })
                  .eq('email_id', emailId)
                  .eq('filename', attachment.filename);

                logger.info(`    ✓ Extracted ${extractedText.length} chars from PDF`);
              } else {
                logger.warn(`    ⚠ PDF is empty or unreadable`);
                await supabase
                  .from('raw_attachments')
                  .update({ extraction_status: 'failed' })
                  .eq('email_id', emailId)
                  .eq('filename', attachment.filename);
              }

            } catch (pdfError: any) {
              logger.error(`    ✗ PDF extraction failed:`, pdfError.message);
              await supabase
                .from('raw_attachments')
                .update({ extraction_status: 'failed' })
                .eq('email_id', emailId)
                .eq('filename', attachment.filename);
            }
          }

        } catch (error: any) {
          logger.error(`    ✗ Error processing attachment:`, error.message);
        }
      }

      logger.info(`  ✓ Saved ${savedCount} new attachments`);

      // STEP 6: Update email body_text with PDF extracted content
      if (pdfTextParts.length > 0) {
        const combinedText = pdfTextParts.join('\n\n');
        const currentBodyText = emailRecord.body_text || '';
        const finalBodyText = currentBodyText
          ? `${currentBodyText}\n\n${combinedText}`
          : combinedText;

        await supabase
          .from('raw_emails')
          .update({
            body_text: finalBodyText,
            processing_status: 'processed',
            processed_at: new Date().toISOString()
          })
          .eq('id', emailId);

        logger.info(`  ✓ Updated body_text with ${pdfTextParts.length} PDF extractions`);
      }
    }
  }

  // Mark as successfully processed
  await supabase
    .from('raw_emails')
    .update({
      processing_status: 'processed',
      processed_at: new Date().toISOString()
    })
    .eq('id', emailId);

  stats.emailsProcessed++;
  logger.info(`  ✅ Completed processing`);
}

function printSummary(stats: ProcessingStats) {
  logger.info('\n=== PROCESSING SUMMARY ===');
  logger.info(`Emails processed:     ${stats.emailsProcessed}`);
  logger.info(`Emails skipped:       ${stats.emailsSkipped}`);
  logger.info(`Emails failed:        ${stats.emailsFailed}`);
  logger.info(`Attachments saved:    ${stats.attachmentsSaved}`);
  logger.info(`PDFs extracted:       ${stats.pdfsExtracted}`);

  if (stats.errors.length > 0) {
    logger.info(`\nErrors (${stats.errors.length}):`);
    stats.errors.forEach(err => logger.error(`  - ${err}`));
  }

  logger.info('\n✓ Processing complete!');
}

// Run the script
processEmails().catch((error) => {
  logger.error('Script failed:', error);
  process.exit(1);
});
