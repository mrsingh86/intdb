/**
 * Run Parallel Reanalysis in a Loop Until Complete
 *
 * Processes all remaining emails needing reanalysis in batches.
 * Estimates remaining time based on processing rate.
 */

import { createClient } from '@supabase/supabase-js';
import { ParallelReanalysisService } from '../../lib/chronicle/parallel-reanalysis-service';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BatchStats {
  emails: number;
  timeMs: number;
}

async function run() {
  const service = new ParallelReanalysisService(supabase);
  const batchStats: BatchStats[] = [];
  let batchNumber = 0;

  console.log('='.repeat(60));
  console.log('REANALYSIS LOOP - Processing until complete');
  console.log('='.repeat(60));

  while (true) {
    batchNumber++;
    const status = await service.getStatus();

    if (status.remaining === 0) {
      console.log('\n' + '='.repeat(60));
      console.log('ALL DONE! No more emails need reanalysis.');
      console.log('='.repeat(60));
      break;
    }

    // Calculate estimated time remaining
    const avgRate = batchStats.length > 0
      ? batchStats.reduce((sum, b) => sum + b.emails, 0) /
        (batchStats.reduce((sum, b) => sum + b.timeMs, 0) / 60000)
      : 22; // Default estimate: 22 emails/min

    const estMinutesRemaining = Math.round(status.remaining / avgRate);

    console.log('\n' + '-'.repeat(60));
    console.log(`BATCH #${batchNumber}`);
    console.log(`  Remaining: ${status.remaining} emails`);
    console.log(`  Rate: ${avgRate.toFixed(1)} emails/min`);
    console.log(`  Est. time remaining: ${estMinutesRemaining} minutes (~${(estMinutesRemaining / 60).toFixed(1)} hours)`);
    console.log('-'.repeat(60));

    // Run batch with 5 workers x 40 threads
    const result = await service.runParallel({
      workers: 5,
      threadsPerWorker: 40,
      maxEmailsPerThread: 50
    });

    batchStats.push({
      emails: result.succeeded,
      timeMs: result.timeMs
    });

    const batchMinutes = (result.timeMs / 60000).toFixed(1);
    console.log(`\nBatch #${batchNumber} complete:`);
    console.log(`  Processed: ${result.succeeded} emails`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Time: ${batchMinutes} minutes`);
    console.log(`  Rate: ${(result.succeeded / (result.timeMs / 60000)).toFixed(1)} emails/min`);

    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Final summary
  const totalEmails = batchStats.reduce((sum, b) => sum + b.emails, 0);
  const totalTimeMs = batchStats.reduce((sum, b) => sum + b.timeMs, 0);
  const totalMinutes = (totalTimeMs / 60000).toFixed(1);
  const avgRate = totalEmails / (totalTimeMs / 60000);

  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total batches: ${batchNumber}`);
  console.log(`  Total emails processed: ${totalEmails}`);
  console.log(`  Total time: ${totalMinutes} minutes`);
  console.log(`  Average rate: ${avgRate.toFixed(1)} emails/min`);
  console.log('='.repeat(60));
}

run().catch(console.error);
