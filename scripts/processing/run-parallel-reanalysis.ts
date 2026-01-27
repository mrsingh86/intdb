/**
 * Run Parallel Reanalysis
 *
 * Usage: npx ts-node scripts/processing/run-parallel-reanalysis.ts [workers] [threadsPerWorker]
 * Default: 5 workers x 30 threads = 150 threads
 */

import { createClient } from '@supabase/supabase-js';
import { ParallelReanalysisService } from '../../lib/chronicle/parallel-reanalysis-service';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const workers = parseInt(process.argv[2] || '5', 10);
  const threadsPerWorker = parseInt(process.argv[3] || '30', 10);

  const service = new ParallelReanalysisService(supabase);

  // Get status first
  const status = await service.getStatus();
  console.log('Current status:');
  console.log('  Remaining emails:', status.remaining);
  console.log('  Threads remaining:', status.threadsRemaining);
  console.log('  Completed:', status.completed);
  console.log('  With thread context:', status.withContext);
  console.log('');

  if (status.remaining === 0) {
    console.log('No emails need reanalysis!');
    return;
  }

  console.log(`Starting parallel reanalysis (${workers} workers x ${threadsPerWorker} threads)...`);
  const result = await service.runParallel({
    workers,
    threadsPerWorker,
    maxEmailsPerThread: 50
  });

  console.log('');
  console.log('=== RESULTS ===');
  console.log('Total threads:', result.totalThreads);
  console.log('Total emails:', result.totalEmails);
  console.log('Succeeded:', result.succeeded);
  console.log('Failed:', result.failed);
  console.log('Time:', (result.timeMs / 60000).toFixed(1), 'minutes');
  console.log('');
  console.log('Worker stats:');
  for (const w of result.workerStats) {
    console.log(`  Worker ${w.workerId}: ${w.succeeded}/${w.emails} in ${Math.round(w.timeMs / 1000)}s`);
  }

  // Get updated status
  const newStatus = await service.getStatus();
  console.log('');
  console.log('Remaining:', newStatus.remaining);
}

run().catch(console.error);
