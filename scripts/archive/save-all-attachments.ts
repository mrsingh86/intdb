/**
 * Save All Email Attachments
 *
 * Saves attachment records for ALL emails with attachments,
 * regardless of whether they have body text or not
 */

import dotenv from 'dotenv';
import GmailClient from '../utils/gmail-client';
import Logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const logger = new Logger('AttachmentSaver');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function saveAllAttachments() {
  logger.info('Starting to save all email attachments...');

  const gmailClient = new GmailClient({
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  });

  // Get ALL emails that have attachments (regardless of body_text)
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, has_attachments, attachment_count')
    .eq('has_attachments', true);

  if (error) {
    logger.error('Failed to query emails:', error);
    return;
  }

  logger.info(`Found ${emails?.length || 0} emails with attachments`);

  if (!emails || emails.length === 0) {
    logger.info('No emails with attachments found!');
    return;
  }

  let processed = 0;
  let skipped = 0;
  let saved = 0;

  for (const email of emails) {
    try {
      // Check if attachments already saved for this email
      const { count: existingCount } = await supabase
        .from('raw_attachments')
        .select('*', { count: 'exact', head: true })
        .eq('email_id', email.id);

      if (existingCount && existingCount >= (email.attachment_count || 0)) {
        logger.info(`Skipping ${email.subject?.substring(0, 50)} - attachments already saved (${existingCount})`);
        skipped++;
        continue;
      }

      logger.info(`Processing: ${email.subject?.substring(0, 50)}...`);
      logger.info(`  Email ID: ${email.id}`);
      logger.info(`  Expected attachments: ${email.attachment_count}`);
      logger.info(`  Already saved: ${existingCount || 0}`);

      // Re-fetch from Gmail to get attachment details
      const emailData = await gmailClient.getMessage(email.gmail_message_id);

      if (!emailData.attachments || emailData.attachments.length === 0) {
        logger.warn(`  No attachments found in Gmail for email ${email.id}`);
        continue;
      }

      logger.info(`  Found ${emailData.attachments.length} attachments in Gmail`);

      let savedForEmail = 0;

      // Save each attachment
      for (const attachment of emailData.attachments) {
        // Generate short attachment ID
        const shortAttachmentId = `${email.id.substring(0, 8)}-${savedForEmail}`;
        const storagePath = `gmail://${attachment.attachmentId}`;

        logger.info(`    Saving: ${attachment.filename} (${attachment.mimeType})`);

        const { error: attError } = await supabase
          .from('raw_attachments')
          .insert({
            email_id: email.id,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes,
            storage_path: storagePath.substring(0, 199),
            attachment_id: shortAttachmentId,
            extraction_status: 'pending'
          });

        if (attError) {
          if (attError.code === '23505') {
            logger.info(`    Already exists - skipping`);
          } else {
            logger.warn(`    Failed: ${attError.message}`);
          }
        } else {
          savedForEmail++;
          saved++;
          logger.info(`    ✓ Saved`);
        }
      }

      processed++;
      logger.info(`  ✅ Saved ${savedForEmail} attachments for this email (${processed}/${emails.length})`);

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 150));

    } catch (error: any) {
      logger.error(`❌ Failed: ${email.subject?.substring(0, 50)}`, error);
    }
  }

  logger.info(`\n=== SUMMARY ===`);
  logger.info(`Total emails with attachments: ${emails.length}`);
  logger.info(`Processed: ${processed}`);
  logger.info(`Skipped (already saved): ${skipped}`);
  logger.info(`New attachments saved: ${saved}`);
}

saveAllAttachments().catch(console.error);
