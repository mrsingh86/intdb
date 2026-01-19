/**
 * COMPREHENSIVE ATTACHMENT EXTRACTOR
 *
 * Extracts content from:
 * - PDFs (text extraction)
 * - Excel files (.xlsx → CSV text)
 * - Word docs (.docx → plain text)
 * - Text files (.txt → plain text)
 * - Images (OCR with tesseract - optional)
 */

import dotenv from 'dotenv';
import GmailClient from '../utils/gmail-client';
import Logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

dotenv.config();

const logger = new Logger('AttachmentExtractor');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface ExtractionStats {
  pdfsExtracted: number;
  excelsExtracted: number;
  wordsExtracted: number;
  textsExtracted: number;
  imagesExtracted: number;
  failed: number;
  errors: string[];
}

async function extractPDF(buffer: Buffer): Promise<string> {
  const pdfData = await pdfParse(buffer);
  return pdfData.text.trim();
}

async function extractExcel(buffer: Buffer): Promise<string> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: string[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    sheets.push(`=== Sheet: ${sheetName} ===\n${csv}`);
  });

  return sheets.join('\n\n');
}

async function extractWord(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractText(buffer: Buffer): Promise<string> {
  return buffer.toString('utf-8').trim();
}

async function extractImage(buffer: Buffer): Promise<string> {
  const result = await Tesseract.recognize(buffer, 'eng', {
    logger: () => {} // Suppress tesseract logs
  });
  return result.data.text.trim();
}

async function processAttachment(
  gmailClient: GmailClient,
  emailId: string,
  gmailMessageId: string,
  attachment: any,
  stats: ExtractionStats
): Promise<string | null> {
  try {
    logger.info(`    → Downloading: ${attachment.filename}`);
    const buffer = await gmailClient.getAttachment(gmailMessageId, attachment.attachmentId);

    let extractedText = '';
    const mimeType = attachment.mimeType;

    if (mimeType === 'application/pdf') {
      extractedText = await extractPDF(buffer);
      stats.pdfsExtracted++;
      logger.info(`      ✓ Extracted ${extractedText.length} chars from PDF`);
    }
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      extractedText = await extractExcel(buffer);
      stats.excelsExtracted++;
      logger.info(`      ✓ Extracted ${extractedText.length} chars from Excel`);
    }
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      extractedText = await extractWord(buffer);
      stats.wordsExtracted++;
      logger.info(`      ✓ Extracted ${extractedText.length} chars from Word`);
    }
    else if (mimeType === 'text/plain') {
      extractedText = await extractText(buffer);
      stats.textsExtracted++;
      logger.info(`      ✓ Extracted ${extractedText.length} chars from text file`);
    }
    else if (mimeType.startsWith('image/')) {
      extractedText = await extractImage(buffer);
      stats.imagesExtracted++;
      logger.info(`      ✓ Extracted ${extractedText.length} chars from image (OCR)`);
    }
    else {
      logger.info(`      ⊘ Skipping unsupported type: ${mimeType}`);
      return null;
    }

    if (!extractedText || extractedText.length === 0) {
      logger.warn(`      ⚠ No content extracted`);
      await supabase
        .from('raw_attachments')
        .update({ extraction_status: 'failed' })
        .eq('email_id', emailId)
        .eq('filename', attachment.filename);
      return null;
    }

    // Update attachment status
    await supabase
      .from('raw_attachments')
      .update({ extraction_status: 'completed' })
      .eq('email_id', emailId)
      .eq('filename', attachment.filename);

    return `=== ${attachment.filename} ===\n\n${extractedText}`;

  } catch (error: any) {
    logger.error(`      ✗ Extraction failed:`, error.message);
    stats.failed++;
    stats.errors.push(`${attachment.filename}: ${error.message}`);

    await supabase
      .from('raw_attachments')
      .update({ extraction_status: 'failed' })
      .eq('email_id', emailId)
      .eq('filename', attachment.filename);

    return null;
  }
}

async function extractAllAttachments() {
  const stats: ExtractionStats = {
    pdfsExtracted: 0,
    excelsExtracted: 0,
    wordsExtracted: 0,
    textsExtracted: 0,
    imagesExtracted: 0,
    failed: 0,
    errors: []
  };

  logger.info('=== STARTING ATTACHMENT EXTRACTION ===');

  try {
    // Find emails with pending attachments
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id, subject')
      .eq('has_attachments', true);

    logger.info(`Found ${emails?.length || 0} emails with attachments`);

    if (!emails || emails.length === 0) {
      logger.info('No emails with attachments found');
      return;
    }

    // Initialize Gmail client
    const gmailClient = new GmailClient({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      redirect_uri: process.env.GMAIL_REDIRECT_URI!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!
    });

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      logger.info(`\n[${i + 1}/${emails.length}] Processing: ${email.subject}`);

      try {
        // Check if this email has pending OR failed attachments
        const { data: pendingAttachments } = await supabase
          .from('raw_attachments')
          .select('*')
          .eq('email_id', email.id)
          .in('extraction_status', ['pending', 'failed'])
          .or('mime_type.eq.application/pdf,mime_type.eq.application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,mime_type.eq.application/vnd.openxmlformats-officedocument.wordprocessingml.document,mime_type.eq.text/plain,mime_type.like.image/%');

        if (!pendingAttachments || pendingAttachments.length === 0) {
          logger.info('  ✓ No pending attachments');
          continue;
        }

        logger.info(`  → Found ${pendingAttachments.length} pending attachments`);

        // Fetch email from Gmail to get fresh attachment IDs
        const emailData = await gmailClient.getMessage(email.gmail_message_id);

        if (!emailData.attachments || emailData.attachments.length === 0) {
          logger.warn('  ⚠ No attachments found in Gmail');
          continue;
        }

        const extractedParts: string[] = [];

        // Process each pending attachment
        for (const pendingAtt of pendingAttachments) {
          // Find matching attachment from Gmail by filename
          const gmailAtt = emailData.attachments.find(
            (a: any) => a.filename === pendingAtt.filename
          );

          if (!gmailAtt) {
            logger.warn(`    ⚠ Attachment not found in Gmail: ${pendingAtt.filename}`);
            continue;
          }

          const extractedContent = await processAttachment(
            gmailClient,
            email.id,
            email.gmail_message_id,
            gmailAtt,
            stats
          );

          if (extractedContent) {
            extractedParts.push(extractedContent);
          }
        }

        // Update email body_text with all extracted content
        if (extractedParts.length > 0) {
          const { data: currentEmail } = await supabase
            .from('raw_emails')
            .select('body_text')
            .eq('id', email.id)
            .single();

          const combinedExtraction = extractedParts.join('\n\n');
          const currentBodyText = currentEmail?.body_text || '';

          const finalBodyText = currentBodyText
            ? `${currentBodyText}\n\n${combinedExtraction}`
            : combinedExtraction;

          await supabase
            .from('raw_emails')
            .update({
              body_text: finalBodyText,
              processing_status: 'processed',
              processed_at: new Date().toISOString()
            })
            .eq('id', email.id);

          logger.info(`  ✓ Updated body_text with ${extractedParts.length} extractions`);
        }

      } catch (error: any) {
        logger.error(`  ✗ Failed to process email:`, error.message);
        stats.errors.push(`Email ${email.subject}: ${error.message}`);
      }

      // Rate limiting
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

function printSummary(stats: ExtractionStats) {
  logger.info('\n=== EXTRACTION SUMMARY ===');
  logger.info(`PDFs extracted:    ${stats.pdfsExtracted}`);
  logger.info(`Excel extracted:   ${stats.excelsExtracted}`);
  logger.info(`Word extracted:    ${stats.wordsExtracted}`);
  logger.info(`Text extracted:    ${stats.textsExtracted}`);
  logger.info(`Images extracted:  ${stats.imagesExtracted}`);
  logger.info(`Failed:            ${stats.failed}`);

  if (stats.errors.length > 0) {
    logger.info(`\nErrors (${stats.errors.length}):  `);
    stats.errors.slice(0, 10).forEach(err => logger.error(`  - ${err}`));
    if (stats.errors.length > 10) {
      logger.info(`  ... and ${stats.errors.length - 10} more`);
    }
  }

  logger.info('\n✓ Extraction complete!');
}

// Run the script
extractAllAttachments().catch((error) => {
  logger.error('Script failed:', error);
  process.exit(1);
});
