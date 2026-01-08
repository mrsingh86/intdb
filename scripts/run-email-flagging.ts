/**
 * Run Email Flagging
 *
 * Updates all derived flags on raw_emails using EmailFlaggingService.
 *
 * FLAGS UPDATED:
 * - is_response, clean_subject, email_direction, true_sender_email
 * - has_attachments, attachment_count, thread_position
 * - responds_to_email_id, response_time_hours
 * - is_duplicate, duplicate_of_email_id, revision_type, content_hash
 *
 * Usage:
 *   npx tsx scripts/run-email-flagging.ts --sample 20        # Test on 20 emails
 *   npx tsx scripts/run-email-flagging.ts --sample 20 --dry-run  # Dry run
 *   npx tsx scripts/run-email-flagging.ts --all              # Run on all emails
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { createEmailFlaggingService, EmailFlags } from '../lib/services/email-flagging-service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const flaggingService = createEmailFlaggingService(supabase);

async function main() {
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const allMode = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const sampleSize = sampleMode ? parseInt(args[args.indexOf('--sample') + 1] || '20') : 20;

  console.log('RUN EMAIL FLAGGING');
  console.log('='.repeat(70));
  console.log('Flags to update: is_response, clean_subject, email_direction,');
  console.log('  true_sender_email, has_attachments, attachment_count, thread_position,');
  console.log('  responds_to_email_id, response_time_hours, is_duplicate, revision_type');
  console.log('='.repeat(70));

  if (!sampleMode && !allMode) {
    console.log('\nUsage:');
    console.log('  npx tsx scripts/run-email-flagging.ts --sample 20        # Test on 20');
    console.log('  npx tsx scripts/run-email-flagging.ts --sample 20 --dry-run  # Dry run');
    console.log('  npx tsx scripts/run-email-flagging.ts --all              # All emails');
    return;
  }

  // Get total count first
  const { count: totalCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal emails in database: ${totalCount}`);

  if (sampleMode) {
    console.log(`Processing ${sampleSize} sample emails...`);
  } else {
    console.log('Processing ALL emails...');
  }

  if (dryRun) {
    console.log('DRY RUN - will show changes but not apply them');
  }

  console.log('');

  // Fetch emails in batches to handle pagination
  const BATCH_SIZE = 500;
  let emails: any[] = [];

  if (sampleMode) {
    const { data, error } = await supabase
      .from('raw_emails')
      .select('id, subject, is_response, email_direction, has_attachments')
      .order('received_at', { ascending: false })
      .limit(sampleSize);

    if (error) {
      console.error('Failed to fetch emails:', error.message);
      return;
    }
    emails = data || [];
  } else {
    // Fetch all emails in batches
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('raw_emails')
        .select('id, subject, is_response, email_direction, has_attachments')
        .order('received_at', { ascending: false })
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        console.error('Failed to fetch emails:', error.message);
        return;
      }

      if (data && data.length > 0) {
        emails = emails.concat(data);
        offset += BATCH_SIZE;
        console.log(`  Fetched ${emails.length} emails...`);
      }

      hasMore = data && data.length === BATCH_SIZE;
    }
  }

  console.log(`\nProcessing ${emails.length} emails\n`);

  // Stats tracking
  const stats = {
    processed: 0,
    success: 0,
    failed: 0,
    changes: {
      is_response: 0,
      email_direction: 0,
      has_attachments: 0,
      true_sender_email: 0,
      thread_position: 0,
      is_duplicate: 0,
      revision_type: 0,
    },
  };

  for (const email of emails || []) {
    stats.processed++;

    // Get current state for comparison
    const currentState = {
      is_response: email.is_response,
      email_direction: email.email_direction,
      has_attachments: email.has_attachments,
    };

    // Get email full data for flagging
    const { data: fullEmail } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id, thread_id, subject, sender_email, sender_name, body_text, headers, received_at, in_reply_to_message_id')
      .eq('id', email.id)
      .single();

    if (!fullEmail) {
      stats.failed++;
      continue;
    }

    // Compute flags
    const flags = await flaggingService.computeFlags(fullEmail);

    // Track changes
    if (flags.is_response !== currentState.is_response) stats.changes.is_response++;
    if (flags.email_direction !== currentState.email_direction) stats.changes.email_direction++;
    if (flags.has_attachments !== currentState.has_attachments) stats.changes.has_attachments++;
    if (flags.true_sender_email) stats.changes.true_sender_email++;
    if (flags.thread_position) stats.changes.thread_position++;
    if (flags.is_duplicate) stats.changes.is_duplicate++;
    if (flags.revision_type) stats.changes.revision_type++;

    // Show sample changes
    if (stats.processed <= 10) {
      const isRe = flags.is_response ? 'RE' : 'ORIG';
      const dir = flags.email_direction === 'inbound' ? '←' : '→';
      const att = flags.has_attachments ? '📎' : '  ';
      const pos = flags.thread_position ? `[${flags.thread_position}]` : '   ';

      console.log(`[${stats.processed}] ${isRe} ${dir} ${att} ${pos} ${email.subject?.substring(0, 45) || '-'}`);

      // Show what changed
      const changes: string[] = [];
      if (flags.is_response !== currentState.is_response) {
        changes.push(`is_response: ${currentState.is_response} → ${flags.is_response}`);
      }
      if (flags.email_direction !== currentState.email_direction) {
        changes.push(`direction: ${currentState.email_direction} → ${flags.email_direction}`);
      }
      if (flags.true_sender_email) {
        changes.push(`true_sender: ${flags.true_sender_email}`);
      }
      if (flags.revision_type) {
        changes.push(`revision: ${flags.revision_type}`);
      }

      if (changes.length > 0) {
        console.log(`     ↳ ${changes.join(', ')}`);
      }
    }

    // Apply changes if not dry run
    if (!dryRun) {
      const result = await flaggingService.updateEmailFlags(email.id);
      if (result.success) {
        stats.success++;
      } else {
        stats.failed++;
        if (stats.failed <= 5) {
          console.error(`  ✗ Error: ${result.error}`);
        }
      }
    } else {
      stats.success++;
    }

    // Progress indicator
    if (stats.processed % 100 === 0) {
      console.log(`  ... processed ${stats.processed}/${emails?.length}`);
    }

    // Rate limiting
    if (stats.processed % 50 === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nProcessed: ${stats.processed}`);
  console.log(`Success: ${stats.success}`);
  console.log(`Failed: ${stats.failed}`);

  console.log('\nChanges by flag:');
  console.log(`  is_response changed: ${stats.changes.is_response}`);
  console.log(`  email_direction changed: ${stats.changes.email_direction}`);
  console.log(`  has_attachments changed: ${stats.changes.has_attachments}`);
  console.log(`  true_sender_email found: ${stats.changes.true_sender_email}`);
  console.log(`  thread_position set: ${stats.changes.thread_position}`);
  console.log(`  is_duplicate found: ${stats.changes.is_duplicate}`);
  console.log(`  revision_type detected: ${stats.changes.revision_type}`);

  if (dryRun) {
    console.log('\nThis was a DRY RUN. Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
