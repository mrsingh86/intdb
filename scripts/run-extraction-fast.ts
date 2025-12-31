/**
 * Fast Parallel Extraction Script
 *
 * Processes emails in parallel batches for much faster extraction.
 * - Processes 5 emails concurrently
 * - Skips already processed emails
 * - Resumes from where it left off
 */

import { createClient } from '@supabase/supabase-js';
import { EmailIngestionService } from '../lib/services/email-ingestion-service';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

const CONCURRENCY = 5; // Process 5 emails at a time
const BATCH_DELAY_MS = 100; // Small delay between batches

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const ingestionService = new EmailIngestionService(supabase);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FAST PARALLEL EXTRACTION');
  console.log(`Concurrency: ${CONCURRENCY} emails at a time`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Get ALL emails that need processing (paginated to overcome 1000 limit)
  let allEmailIds: string[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select('id')
      .or('processing_status.is.null,processing_status.neq.processed')
      .order('received_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Failed to fetch emails:', error);
      return;
    }

    if (!emails || emails.length === 0) break;

    allEmailIds = allEmailIds.concat(emails.map(e => e.id));
    offset += pageSize;

    if (emails.length < pageSize) break; // Last page
  }

  const emailIds = allEmailIds;
  console.log(`Emails to process: ${emailIds.length}`);
  console.log('');

  let processed = 0;
  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < emailIds.length; i += CONCURRENCY) {
    const batch = emailIds.slice(i, i + CONCURRENCY);

    // Process batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (emailId) => {
        try {
          await ingestionService.ingestEmail(emailId, { forceReprocess: false });
          return { success: true, emailId };
        } catch (err) {
          return { success: false, emailId, error: err };
        }
      })
    );

    // Count results
    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled' && result.value.success) {
        success++;
      } else {
        failed++;
      }
    }

    // Progress update
    const pct = Math.round((processed / emailIds.length) * 100);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = processed / elapsed || 0;
    const remaining = Math.round((emailIds.length - processed) / rate / 60) || 0;

    process.stdout.write(
      `\r[${pct}%] Processed: ${processed}/${emailIds.length} | ` +
      `Success: ${success} | Failed: ${failed} | ` +
      `Rate: ${rate.toFixed(1)}/sec | ETA: ${remaining} min`
    );

    // Small delay between batches to avoid overwhelming API
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total processed: ${processed}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${Math.round((Date.now() - startTime) / 1000)} seconds`);
}

main().catch(console.error);
