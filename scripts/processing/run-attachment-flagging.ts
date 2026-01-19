/**
 * Run Attachment Flagging
 *
 * Classifies all attachments as signature images vs business documents.
 * Updates business_attachment_count on raw_emails.
 *
 * FLAGS UPDATED:
 * - is_signature_image: true if inline image, logo, social icon
 * - is_business_document: true if PDF, Excel, Word
 * - business_attachment_count: count of business docs per email
 *
 * Usage:
 *   npx tsx scripts/run-attachment-flagging.ts --sample 100     # Test on 100
 *   npx tsx scripts/run-attachment-flagging.ts --all            # Run on all
 *   npx tsx scripts/run-attachment-flagging.ts --update-counts  # Only update email counts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  AttachmentFlaggingService,
  createAttachmentFlaggingService,
} from '../lib/services/attachment-flagging-service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const flaggingService = createAttachmentFlaggingService(supabase);

async function main() {
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const allMode = args.includes('--all');
  const updateCountsOnly = args.includes('--update-counts');
  const sampleSize = sampleMode
    ? parseInt(args[args.indexOf('--sample') + 1] || '100')
    : 100;

  console.log('RUN ATTACHMENT FLAGGING');
  console.log('='.repeat(70));
  console.log('Flags to update: is_signature_image, is_business_document');
  console.log('Email update: business_attachment_count');
  console.log('='.repeat(70));

  if (!sampleMode && !allMode && !updateCountsOnly) {
    console.log('\nUsage:');
    console.log('  npx tsx scripts/run-attachment-flagging.ts --sample 100');
    console.log('  npx tsx scripts/run-attachment-flagging.ts --all');
    console.log('  npx tsx scripts/run-attachment-flagging.ts --update-counts');
    return;
  }

  // Get total count
  const { count: totalCount } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal attachments in database: ${totalCount}`);

  // ===========================================================================
  // PHASE 1: Flag attachments
  // ===========================================================================

  if (!updateCountsOnly) {
    if (sampleMode) {
      console.log(`\nProcessing ${sampleSize} sample attachments...`);
    } else {
      console.log('\nProcessing ALL attachments...');
    }

    // Fetch attachments
    const BATCH_SIZE = 1000;
    let attachments: any[] = [];

    if (sampleMode) {
      const { data, error } = await supabase
        .from('raw_attachments')
        .select('id, email_id, filename, mime_type, size_bytes, storage_path')
        .limit(sampleSize);

      if (error) {
        console.error('Failed to fetch attachments:', error.message);
        return;
      }
      attachments = data || [];
    } else {
      // Fetch all in batches
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('raw_attachments')
          .select('id, email_id, filename, mime_type, size_bytes, storage_path')
          .range(offset, offset + BATCH_SIZE - 1);

        if (error) {
          console.error('Failed to fetch attachments:', error.message);
          return;
        }

        if (data && data.length > 0) {
          attachments = attachments.concat(data);
          offset += BATCH_SIZE;
          console.log(`  Fetched ${attachments.length} attachments...`);
        }

        hasMore = data && data.length === BATCH_SIZE;
      }
    }

    console.log(`\nClassifying ${attachments.length} attachments...\n`);

    // Stats tracking
    const stats = {
      processed: 0,
      signatureImages: 0,
      businessDocs: 0,
      other: 0,
      byMimeType: {} as Record<string, { sig: number; biz: number; other: number }>,
    };

    // Process in batches
    const PROCESS_BATCH = 500;
    for (let i = 0; i < attachments.length; i += PROCESS_BATCH) {
      const batch = attachments.slice(i, i + PROCESS_BATCH);

      for (const att of batch) {
        stats.processed++;

        // Classify
        const flags = flaggingService.classifyAttachment(att);

        // Track stats
        if (flags.is_signature_image) {
          stats.signatureImages++;
        } else if (flags.is_business_document) {
          stats.businessDocs++;
        } else {
          stats.other++;
        }

        // Track by mime type
        const mimeKey = att.mime_type || 'unknown';
        if (!stats.byMimeType[mimeKey]) {
          stats.byMimeType[mimeKey] = { sig: 0, biz: 0, other: 0 };
        }
        if (flags.is_signature_image) {
          stats.byMimeType[mimeKey].sig++;
        } else if (flags.is_business_document) {
          stats.byMimeType[mimeKey].biz++;
        } else {
          stats.byMimeType[mimeKey].other++;
        }

        // Show sample
        if (stats.processed <= 20) {
          const type = flags.is_signature_image
            ? 'SIG'
            : flags.is_business_document
            ? 'BIZ'
            : '???';
          const icon = flags.is_signature_image
            ? '🖼️'
            : flags.is_business_document
            ? '📄'
            : '❓';
          console.log(
            `[${stats.processed}] ${icon} ${type} ${att.filename?.substring(0, 40)} (${att.mime_type})`
          );
        }

        // Update database
        await supabase
          .from('raw_attachments')
          .update({
            is_signature_image: flags.is_signature_image,
            is_business_document: flags.is_business_document,
            flagged_at: new Date().toISOString(),
          })
          .eq('id', att.id);
      }

      console.log(`  ... processed ${Math.min(i + PROCESS_BATCH, attachments.length)}/${attachments.length}`);

      // Rate limiting
      await new Promise((r) => setTimeout(r, 100));
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('ATTACHMENT FLAGGING SUMMARY');
    console.log('='.repeat(70));
    console.log(`\nProcessed: ${stats.processed}`);
    console.log(`Signature Images: ${stats.signatureImages} (${((stats.signatureImages / stats.processed) * 100).toFixed(1)}%)`);
    console.log(`Business Documents: ${stats.businessDocs} (${((stats.businessDocs / stats.processed) * 100).toFixed(1)}%)`);
    console.log(`Other: ${stats.other} (${((stats.other / stats.processed) * 100).toFixed(1)}%)`);

    console.log('\nBreakdown by MIME type:');
    const sortedMimes = Object.entries(stats.byMimeType)
      .sort((a, b) => (b[1].sig + b[1].biz + b[1].other) - (a[1].sig + a[1].biz + a[1].other))
      .slice(0, 10);

    for (const [mime, counts] of sortedMimes) {
      const total = counts.sig + counts.biz + counts.other;
      console.log(`  ${mime}: ${total} (sig: ${counts.sig}, biz: ${counts.biz}, other: ${counts.other})`);
    }
  }

  // ===========================================================================
  // PHASE 2: Update email business counts
  // ===========================================================================

  console.log('\n' + '='.repeat(70));
  console.log('UPDATING EMAIL BUSINESS COUNTS');
  console.log('='.repeat(70));

  // Get unique email IDs that have attachments
  const { data: emailIds, error: emailError } = await supabase
    .from('raw_attachments')
    .select('email_id')
    .not('email_id', 'is', null);

  if (emailError) {
    console.error('Failed to get email IDs:', emailError.message);
    return;
  }

  // Dedupe email IDs
  const uniqueEmailIds = [...new Set((emailIds || []).map((e) => e.email_id))];
  console.log(`\nUpdating business_attachment_count for ${uniqueEmailIds.length} emails...`);

  let emailsUpdated = 0;
  const EMAIL_BATCH = 500;

  for (let i = 0; i < uniqueEmailIds.length; i += EMAIL_BATCH) {
    const batch = uniqueEmailIds.slice(i, i + EMAIL_BATCH);

    for (const emailId of batch) {
      // Count business documents for this email
      const { count } = await supabase
        .from('raw_attachments')
        .select('*', { count: 'exact', head: true })
        .eq('email_id', emailId)
        .eq('is_business_document', true);

      // Update email
      await supabase
        .from('raw_emails')
        .update({ business_attachment_count: count || 0 })
        .eq('id', emailId);

      emailsUpdated++;
    }

    console.log(`  ... updated ${Math.min(i + EMAIL_BATCH, uniqueEmailIds.length)}/${uniqueEmailIds.length} emails`);

    // Rate limiting
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`\nEmails updated: ${emailsUpdated}`);

  // Final verification
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION');
  console.log('='.repeat(70));

  const { data: verification } = await supabase
    .from('raw_attachments')
    .select('is_signature_image, is_business_document')
    .limit(1000);

  const sigCount = verification?.filter((a) => a.is_signature_image).length || 0;
  const bizCount = verification?.filter((a) => a.is_business_document).length || 0;
  const otherCount = verification?.filter((a) => !a.is_signature_image && !a.is_business_document).length || 0;

  console.log(`\nSample verification (first 1000):`);
  console.log(`  Signature images: ${sigCount}`);
  console.log(`  Business documents: ${bizCount}`);
  console.log(`  Other: ${otherCount}`);

  // Check emails with business docs
  const { data: emailsWithBiz } = await supabase
    .from('raw_emails')
    .select('id, business_attachment_count')
    .gt('business_attachment_count', 0)
    .limit(10);

  console.log(`\nSample emails with business attachments:`);
  for (const email of emailsWithBiz || []) {
    console.log(`  ${email.id}: ${email.business_attachment_count} business docs`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
