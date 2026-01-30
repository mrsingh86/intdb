/**
 * Backfill All Embeddings (Parallel)
 *
 * Generates embeddings for all chronicle records using parallel processing.
 * Uses Supabase's built-in gte-small model (384 dimensions).
 *
 * Run: npx tsx scripts/backfill-all-embeddings.ts
 *
 * Cost: $0 (Supabase built-in AI)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const CONCURRENCY = 10;  // Parallel requests
const BATCH_SIZE = 100;  // Records to fetch per DB query
const DELAY_BETWEEN_BATCHES = 500;  // ms delay between batches

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Generate embedding via Edge Function
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/generate-embedding`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }
  );

  if (!response.ok) {
    throw new Error(`Edge function error: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding;
}

// Process a single record
async function processRecord(record: any): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    const text = [
      record.document_type ? `[${record.document_type}]` : '',
      record.subject || '',
      record.summary || '',
      (record.body_preview || '').substring(0, 500),
    ].filter(Boolean).join(' | ');

    const embedding = await generateEmbedding(text);

    await supabase
      .from('chronicle')
      .update({
        embedding,
        embedding_generated_at: new Date().toISOString(),
      })
      .eq('id', record.id);

    return { id: record.id, success: true };
  } catch (error) {
    return { id: record.id, success: false, error: error instanceof Error ? error.message : 'Unknown' };
  }
}

// Process with concurrency limit
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const p = executing[i];
        if (await Promise.race([p.then(() => true), Promise.resolve(false)])) {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

async function main() {
  console.log('='.repeat(60));
  console.log('EMBEDDING BACKFILL - Parallel Mode');
  console.log('Model: Supabase gte-small (384 dimensions)');
  console.log(`Concurrency: ${CONCURRENCY} parallel requests`);
  console.log('Cost: $0');
  console.log('='.repeat(60));

  let totalProcessed = 0;
  let totalErrors = 0;
  let batchNumber = 0;
  const startTime = Date.now();

  // Get initial count
  const { count: initialCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null);

  const totalToProcess = initialCount || 0;

  console.log(`\nRecords to process: ${totalToProcess}`);
  console.log(`Batch size: ${BATCH_SIZE}, Concurrency: ${CONCURRENCY}`);
  console.log('\nStarting...\n');

  while (true) {
    // Fetch batch of records without embeddings
    const { data: records, error } = await supabase
      .from('chronicle')
      .select('id, subject, summary, body_preview, document_type')
      .is('embedding', null)
      .limit(BATCH_SIZE);

    if (error || !records || records.length === 0) {
      break;
    }

    batchNumber++;
    const batchStart = Date.now();

    // Process in parallel
    const results = await processWithConcurrency(records, processRecord, CONCURRENCY);

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    totalProcessed += succeeded;
    totalErrors += failed;

    const { count: remaining } = await supabase
      .from('chronicle')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
    const progress = ((totalProcessed / totalToProcess) * 100).toFixed(1);
    const rate = (totalProcessed / parseFloat(elapsed)).toFixed(1);
    const eta = remaining && parseFloat(rate) > 0
      ? ((remaining / parseFloat(rate)) / 60).toFixed(1)
      : '?';

    console.log(
      `Batch ${batchNumber}: +${succeeded} (${batchTime}s) | ` +
      `Total: ${totalProcessed}/${totalToProcess} (${progress}%) | ` +
      `Rate: ${rate}/s | ETA: ${eta}min`
    );

    if (failed > 0) {
      console.log(`  Errors: ${failed}`);
    }

    if (remaining === 0) break;

    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total time: ${totalTime} minutes`);
  console.log(`Avg rate: ${(totalProcessed / parseFloat(totalTime)).toFixed(1)} records/min`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
