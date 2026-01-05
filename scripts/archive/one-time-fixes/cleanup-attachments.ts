import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Logger from '../utils/logger';

dotenv.config();

const logger = new Logger('AttachmentCleanup');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function cleanupAttachments() {
  logger.info('Starting attachment cleanup...');

  // Step 1: Find and remove duplicate attachments
  logger.info('\n=== STEP 1: Finding Duplicates ===');

  const { data: allAttachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, extraction_status, created_at')
    .order('email_id')
    .order('filename')
    .order('created_at');

  if (!allAttachments) {
    logger.error('Failed to fetch attachments');
    return;
  }

  logger.info(`Total attachments: ${allAttachments.length}`);

  // Group by email_id + filename to find duplicates
  const groupedByEmailAndFile = new Map<string, any[]>();

  for (const att of allAttachments) {
    const key = `${att.email_id}|${att.filename}`;
    if (!groupedByEmailAndFile.has(key)) {
      groupedByEmailAndFile.set(key, []);
    }
    groupedByEmailAndFile.get(key)!.push(att);
  }

  // Find duplicates
  const duplicateGroups = Array.from(groupedByEmailAndFile.values())
    .filter(group => group.length > 1);

  logger.info(`Found ${duplicateGroups.length} sets of duplicate attachments`);

  let deletedCount = 0;

  for (const group of duplicateGroups) {
    logger.info(`\nDuplicate: ${group[0].filename} (${group.length} copies)`);

    // Keep the best one based on priority:
    // 1. Status "completed" > "pending" > "failed"
    // 2. Latest created_at if status is the same

    const statusPriority = { completed: 3, pending: 2, failed: 1 };

    group.sort((a, b) => {
      const statusDiff = statusPriority[b.extraction_status as keyof typeof statusPriority] -
                        statusPriority[a.extraction_status as keyof typeof statusPriority];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const toKeep = group[0];
    const toDelete = group.slice(1);

    logger.info(`  Keeping: ${toKeep.id} (${toKeep.extraction_status})`);
    logger.info(`  Deleting: ${toDelete.length} duplicates`);

    for (const att of toDelete) {
      const { error } = await supabase
        .from('raw_attachments')
        .delete()
        .eq('id', att.id);

      if (error) {
        logger.error(`    Failed to delete ${att.id}: ${error.message}`);
      } else {
        logger.info(`    ✓ Deleted ${att.id}`);
        deletedCount++;
      }
    }
  }

  logger.info(`\n✓ Deleted ${deletedCount} duplicate attachments`);

  // Step 2: Fix extraction statuses for successfully extracted PDFs
  logger.info('\n=== STEP 2: Fixing Extraction Statuses ===');

  // Find emails where body_text contains PDF extracted content (starts with ===)
  const { data: emailsWithPdfContent } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .like('body_text', '%===%');

  logger.info(`Found ${emailsWithPdfContent?.length || 0} emails with PDF-extracted content`);

  let statusUpdates = 0;

  for (const email of emailsWithPdfContent || []) {
    // Extract PDF filename from body_text (format: === filename.pdf ===)
    const pdfMatches = email.body_text.match(/===\s*(.+?\.pdf)\s*===/gi);

    if (!pdfMatches) continue;

    const extractedPdfNames = pdfMatches.map((match: string) =>
      match.replace(/===/g, '').trim()
    );

    logger.info(`\nEmail: ${email.subject?.substring(0, 50)}`);
    logger.info(`  Extracted PDFs in body: ${extractedPdfNames.join(', ')}`);

    // Find attachments for this email that match the extracted PDF names
    for (const pdfName of extractedPdfNames) {
      const { data: attachments } = await supabase
        .from('raw_attachments')
        .select('id, filename, extraction_status')
        .eq('email_id', email.id)
        .eq('filename', pdfName)
        .eq('mime_type', 'application/pdf');

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.extraction_status !== 'completed') {
            logger.info(`  Updating ${att.filename}: ${att.extraction_status} → completed`);

            const { error } = await supabase
              .from('raw_attachments')
              .update({ extraction_status: 'completed' })
              .eq('id', att.id);

            if (error) {
              logger.error(`    Failed: ${error.message}`);
            } else {
              statusUpdates++;
              logger.info(`    ✓ Updated`);
            }
          }
        }
      }
    }
  }

  logger.info(`\n✓ Updated ${statusUpdates} extraction statuses to "completed"`);

  // Step 3: Summary
  logger.info('\n=== CLEANUP SUMMARY ===');

  const { count: finalCount } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });

  const { count: completedCount } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'completed');

  const { count: pendingCount } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'pending');

  const { count: failedCount } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'failed');

  logger.info(`Total attachments: ${finalCount}`);
  logger.info(`  Completed: ${completedCount}`);
  logger.info(`  Pending: ${pendingCount}`);
  logger.info(`  Failed: ${failedCount}`);
  logger.info(`\nDuplicates removed: ${deletedCount}`);
  logger.info(`Statuses fixed: ${statusUpdates}`);
}

cleanupAttachments().catch(console.error);
