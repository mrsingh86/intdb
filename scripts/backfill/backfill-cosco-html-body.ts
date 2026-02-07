/**
 * Backfill COSCO HTML-Only Emails
 *
 * Re-fetches COSCO emails that had empty body (HTML-only, no text/plain).
 * Now that gmail-service has HTML-to-text fallback, re-processing will
 * extract body content and allow AI to find ETD/ETA dates.
 *
 * Strategy:
 * 1. Query chronicle for COSCO empty-body records
 * 2. Delete them from chronicle (to bypass idempotency check)
 * 3. Re-fetch from Gmail (HTML fallback now active)
 * 4. Re-process through chronicle pipeline
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-cosco-html-body.ts --dry-run
 *   npx tsx scripts/backfill/backfill-cosco-html-body.ts --execute
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { createChronicleGmailService } from '../../lib/chronicle/gmail-service';
import { createChronicleService } from '../../lib/chronicle/chronicle-service';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const DRY_RUN = !process.argv.includes('--execute');
const BATCH_SIZE = 5;

// Only backfill doc types where dates matter
const HIGH_VALUE_DOC_TYPES = [
  'booking_confirmation',
  'schedule_update',
  'draft_bl',
  'shipping_instructions',
];

async function main() {
  console.log('='.repeat(70));
  console.log('BACKFILL: COSCO HTML-Only Empty Body Emails');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING'}`);
  console.log('');

  // Step 1: Find COSCO empty-body records
  const { data: records, error } = await supabase
    .from('chronicle')
    .select('id, gmail_message_id, document_type, subject, body_preview')
    .eq('carrier_name', 'COSCO')
    .in('document_type', HIGH_VALUE_DOC_TYPES)
    .is('etd', null)
    .is('eta', null)
    .or('body_preview.is.null,body_preview.eq.,body_preview.lt.20chars')
    .order('document_type');

  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }

  // Filter for truly empty bodies (supabase .lt doesn't work on text length)
  const emptyBodyRecords = (records || []).filter(
    r => !r.body_preview || r.body_preview.length < 20
  );

  console.log(`Found ${emptyBodyRecords.length} COSCO empty-body records to backfill:\n`);

  const byType: Record<string, number> = {};
  for (const r of emptyBodyRecords) {
    byType[r.document_type] = (byType[r.document_type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  if (emptyBodyRecords.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  if (DRY_RUN) {
    console.log('DRY RUN - showing records that would be reprocessed:\n');
    for (const r of emptyBodyRecords) {
      console.log(`  [${r.document_type}] ${r.subject?.substring(0, 80)}`);
      console.log(`    gmail_id: ${r.gmail_message_id}`);
      console.log(`    body_preview: "${r.body_preview?.substring(0, 50) || '(empty)'}"`);
      console.log('');
    }
    console.log(`\nRun with --execute to process these ${emptyBodyRecords.length} records.`);
    return;
  }

  // Step 2: Initialize services
  const gmailService = createChronicleGmailService();
  const chronicleService = createChronicleService(supabase, gmailService);

  let success = 0;
  let failed = 0;
  let withDates = 0;

  // Step 3: Process in batches
  for (let i = 0; i < emptyBodyRecords.length; i += BATCH_SIZE) {
    const batch = emptyBodyRecords.slice(i, i + BATCH_SIZE);
    const messageIds = batch.map(r => r.gmail_message_id);

    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: Processing ${batch.length} emails...`);

    // Delete existing records to bypass idempotency check
    const { error: deleteError } = await supabase
      .from('chronicle')
      .delete()
      .in('gmail_message_id', messageIds);

    if (deleteError) {
      console.error(`  Delete error: ${deleteError.message}`);
      failed += batch.length;
      continue;
    }

    // Also clear any error records so retry cap doesn't block
    await supabase
      .from('chronicle_errors')
      .delete()
      .in('gmail_message_id', messageIds);

    // Re-fetch from Gmail (now with HTML-to-text fallback)
    try {
      const emails = await gmailService.fetchEmailsByMessageIds(messageIds);
      console.log(`  Fetched ${emails.length}/${messageIds.length} from Gmail`);

      // Re-process through pipeline
      for (const email of emails) {
        try {
          const result = await chronicleService.processEmail(email);
          if (result.success) {
            success++;
            // Check if dates were extracted
            const { data: updated } = await supabase
              .from('chronicle')
              .select('etd, eta, body_preview')
              .eq('gmail_message_id', email.gmailMessageId)
              .single();

            const hasDate = updated?.etd || updated?.eta;
            if (hasDate) withDates++;
            const bodyLen = updated?.body_preview?.length || 0;
            console.log(`  OK: ${email.subject?.substring(0, 60)} | body=${bodyLen}chars | dates=${hasDate ? 'YES' : 'no'}`);
          } else {
            failed++;
            console.log(`  FAIL: ${email.subject?.substring(0, 60)} | ${result.error}`);
          }
        } catch (err: any) {
          failed++;
          console.error(`  ERROR: ${email.gmailMessageId} - ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`  Gmail fetch error: ${err.message}`);
      failed += batch.length;
    }

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < emptyBodyRecords.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS:');
  console.log(`  Total: ${emptyBodyRecords.length}`);
  console.log(`  Success: ${success}`);
  console.log(`  With dates extracted: ${withDates}`);
  console.log(`  Failed: ${failed}`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
