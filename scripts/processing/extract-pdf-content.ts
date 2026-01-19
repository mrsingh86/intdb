/**
 * Extract PDF Content from Email Attachments
 *
 * For emails with PDF attachments but no body text:
 * 1. Download PDF attachments from Gmail
 * 2. Extract text from PDFs
 * 3. Save attachments to raw_attachments table
 * 4. Update body_text with extracted PDF content
 */

import dotenv from 'dotenv';
import GmailClient from '../utils/gmail-client';
import Logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

dotenv.config();

const logger = new Logger('PDFExtractor');

// Use SERVICE ROLE key to bypass RLS
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function extractPdfContent() {
  logger.info('Starting PDF content extraction...');

  // Get Gmail client
  const gmailClient = new GmailClient({
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  });

  // Find emails with attachments but no body text
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, has_attachments')
    .or('body_text.is.null,body_text.eq.')
    .eq('has_attachments', true)
    .limit(50);

  if (error) {
    logger.error('Failed to query emails:', error);
    return;
  }

  logger.info(`Found ${emails?.length || 0} emails with attachments but no body text`);

  if (!emails || emails.length === 0) {
    logger.info('No PDF-only emails to process!');
    return;
  }

  let processed = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      logger.info(`Processing: ${email.subject?.substring(0, 50)}...`);
      logger.info(`  Email ID: ${email.id}`);

      // Re-fetch from Gmail to get attachment details
      const emailData = await gmailClient.getMessage(email.gmail_message_id);

      if (!emailData.attachments || emailData.attachments.length === 0) {
        logger.warn(`  No attachments found for email ${email.id}`);
        failed++;
        continue;
      }

      logger.info(`  Found ${emailData.attachments.length} attachments`);

      let combinedPdfText = '';
      let savedAttachments = 0;

      // Process each attachment
      for (const attachment of emailData.attachments) {
        logger.info(`    Processing: ${attachment.filename}`);

        // Save attachment record to database (BEFORE downloading)
        // Gmail attachment IDs are too long (380+ chars), so we'll use a simple counter
        const shortAttachmentId = `${email.id.substring(0, 8)}-${savedAttachments}`;
        const storagePath = `gmail://${attachment.attachmentId}`;

        const { error: attError } = await supabase
          .from('raw_attachments')
          .insert({
            email_id: email.id,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes,
            storage_path: storagePath.substring(0, 199), // Truncate if needed
            attachment_id: shortAttachmentId, // Use short ID instead
            extraction_status: 'pending'
          })
          .select();

        if (attError && attError.code !== '23505') {
          logger.warn(`    Failed to save attachment record: ${attError.message}`);
          logger.warn(`    Error details: ${JSON.stringify(attError)}`);
          // Continue anyway - we'll still try to extract text
        } else if (!attError) {
          savedAttachments++;
          logger.info(`    ✓ Saved attachment record`);
        }

        // Only extract from PDFs
        if (attachment.mimeType === 'application/pdf') {
          try {
            logger.info(`    Downloading PDF...`);

            // Download PDF from Gmail
            const pdfBuffer = await gmailClient.getAttachment(
              email.gmail_message_id,
              attachment.attachmentId
            );

            logger.info(`    Extracting text (${pdfBuffer.length} bytes)...`);

            // Extract text from PDF
            const pdfData = await pdfParse(pdfBuffer);
            const extractedText = pdfData.text.trim();

            if (extractedText) {
              logger.info(`    ✓ Extracted ${extractedText.length} chars from PDF`);
              combinedPdfText += `\n\n=== ${attachment.filename} ===\n\n${extractedText}`;

              // Update attachment extraction status
              await supabase
                .from('raw_attachments')
                .update({
                  extraction_status: 'completed',
                  extracted_text_length: extractedText.length
                })
                .eq('email_id', email.id)
                .eq('attachment_id', shortAttachmentId);
            } else {
              logger.warn(`    PDF is empty or could not extract text`);
              await supabase
                .from('raw_attachments')
                .update({ extraction_status: 'failed' })
                .eq('email_id', email.id)
                .eq('attachment_id', shortAttachmentId);
            }
          } catch (pdfError: any) {
            logger.error(`    PDF extraction failed: ${pdfError.message}`);
            await supabase
              .from('raw_attachments')
              .update({
                extraction_status: 'failed',
                extraction_error: pdfError.message
              })
              .eq('email_id', email.id)
              .eq('attachment_id', shortAttachmentId);
          }
        } else {
          logger.info(`    Skipping non-PDF: ${attachment.mimeType}`);
        }
      }

      // Update email with combined PDF text
      if (combinedPdfText.trim()) {
        const { error: updateError } = await supabase
          .from('raw_emails')
          .update({
            body_text: combinedPdfText.trim(),
            processing_status: 'processed',
            processed_at: new Date().toISOString(),
            attachment_count: savedAttachments
          })
          .eq('id', email.id);

        if (updateError) {
          logger.error(`  Failed to update email body: ${updateError.message}`);
          failed++;
        } else {
          processed++;
          logger.info(`  ✅ Updated email with ${combinedPdfText.length} chars from ${savedAttachments} PDFs`);
        }
      } else {
        logger.warn(`  No text extracted from any PDFs`);
        failed++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error: any) {
      failed++;
      logger.error(`❌ Failed: ${email.subject?.substring(0, 50)}`, error);
    }
  }

  logger.info(`\n=== SUMMARY ===`);
  logger.info(`Total emails processed: ${emails.length}`);
  logger.info(`Successfully extracted: ${processed}`);
  logger.info(`Failed: ${failed}`);
}

extractPdfContent().catch(console.error);
