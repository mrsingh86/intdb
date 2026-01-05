/**
 * Fix Missing Email Content
 *
 * Re-fetches emails from Gmail that have NULL body_text
 * and updates the database with full email content and attachments
 */

import dotenv from 'dotenv';
import GmailClient from '../utils/gmail-client';
import Logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const logger = new Logger('FixMissingContent');

// Use SERVICE ROLE key to bypass RLS
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function fixMissingContent() {
  logger.info('Starting to fix missing email content...');

  // Get Gmail client
  const gmailClient = new GmailClient({
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  });

  // Find emails with NULL or empty body_text
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject')
    .or('body_text.is.null,body_text.eq.')
    .limit(50); // Process 50 at a time

  if (error) {
    logger.error('Failed to query emails:', error);
    return;
  }

  logger.info(`Found ${emails?.length || 0} emails with missing content`);

  if (!emails || emails.length === 0) {
    logger.info('No emails need fixing!');
    return;
  }

  let fixed = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      logger.info(`Fetching: ${email.subject?.substring(0, 50)}...`);
      logger.info(`  Email ID: ${email.id}`);
      logger.info(`  Gmail Message ID: ${email.gmail_message_id}`);

      // Re-fetch from Gmail
      const emailData = await gmailClient.getMessage(email.gmail_message_id);

      // LOG WHAT WE GOT FROM GMAIL
      logger.info(`  Gmail returned:`);
      logger.info(`    Body Text: ${emailData.bodyText ? `${emailData.bodyText.length} chars` : 'NULL/UNDEFINED'}`);
      logger.info(`    Body HTML: ${emailData.bodyHtml ? `${emailData.bodyHtml.length} chars` : 'NULL/UNDEFINED'}`);
      logger.info(`    Has Attachments: ${emailData.hasAttachments}`);
      logger.info(`    Attachment Count: ${emailData.attachmentCount}`);

      // CRITICAL: Check if we actually got content
      if (!emailData.bodyText && !emailData.bodyHtml) {
        logger.warn(`  ⚠️  Gmail returned NO CONTENT for this email - skipping update`);
        failed++;
        continue;
      }

      // Update database
      const { data: updateResult, error: updateError } = await supabase
        .from('raw_emails')
        .update({
          body_text: emailData.bodyText,
          body_html: emailData.bodyHtml,
          has_attachments: emailData.hasAttachments,
          attachment_count: emailData.attachmentCount,
          processing_status: 'processed',
          processed_at: new Date().toISOString()
        })
        .eq('id', email.id)
        .select(); // ADDED: Return updated row to verify

      if (updateError) {
        logger.error(`Failed to update email ${email.id}:`, updateError);
        failed++;
        continue;
      }

      // VERIFY UPDATE WORKED
      logger.info(`  Update result: ${updateResult ? updateResult.length + ' rows updated' : 'NO ROWS RETURNED'}`);

      // Save attachments if any
      if (emailData.attachments && emailData.attachments.length > 0) {
        for (const attachment of emailData.attachments) {
          const { error: attError } = await supabase
            .from('raw_attachments')
            .insert({
              email_id: email.id,
              filename: attachment.filename,
              mime_type: attachment.mimeType,
              size_bytes: attachment.sizeBytes,
              storage_path: `gmail://${email.gmail_message_id}/${attachment.attachmentId}`,
              attachment_id: attachment.attachmentId,
              extraction_status: 'pending'
            });

          if (attError && attError.code !== '23505') { // Ignore duplicate errors
            logger.warn(`Failed to save attachment: ${attachment.filename}`, attError);
          }
        }
      }

      fixed++;
      logger.info(`✅ Fixed: ${email.subject?.substring(0, 50)} (${fixed}/${emails.length})`);

    } catch (error: any) {
      failed++;
      logger.error(`❌ Failed: ${email.subject?.substring(0, 50)}`, error);
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info(`\n=== SUMMARY ===`);
  logger.info(`Total processed: ${emails.length}`);
  logger.info(`Fixed: ${fixed}`);
  logger.info(`Failed: ${failed}`);
}

fixMissingContent().catch(console.error);
