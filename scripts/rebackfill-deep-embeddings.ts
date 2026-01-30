/**
 * Re-backfill ALL embeddings with DEEP content
 *
 * This regenerates embeddings to include:
 * - Containers, MBL, HBL
 * - Vessel, shipper, consignee
 * - Origin, destination
 * - Issue/action descriptions
 * - Attachment extracted text
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createEmbeddingService } from '../lib/chronicle/embedding-service';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BATCH_SIZE = 50;

async function rebackfillDeepEmbeddings() {
  console.log('═'.repeat(70));
  console.log('RE-BACKFILLING ALL EMBEDDINGS WITH DEEP CONTENT');
  console.log('═'.repeat(70));

  const embeddingService = createEmbeddingService(supabase);

  // Get total count
  const { count: totalCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📊 Total records to process: ${totalCount}\n`);

  // Process in batches
  let processed = 0;
  let errors = 0;
  let offset = 0;
  const startTime = Date.now();

  while (offset < (totalCount || 0)) {
    // Get batch of IDs
    const { data: batch, error } = await supabase
      .from('chronicle')
      .select('id')
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !batch || batch.length === 0) {
      console.log('No more records to process');
      break;
    }

    const ids = batch.map(r => r.id);

    // Generate embeddings for this batch
    const results = await embeddingService.generateEmbeddingsBatch(ids);

    const batchProcessed = results.filter(r => r.success).length;
    const batchErrors = results.filter(r => !r.success).length;

    processed += batchProcessed;
    errors += batchErrors;
    offset += batch.length;

    // Progress update
    const percent = Math.round((offset / (totalCount || 1)) * 100);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = processed / elapsed;
    const remaining = Math.round(((totalCount || 0) - offset) / rate);

    console.log(
      `[${percent}%] Processed: ${processed} | Errors: ${errors} | ` +
      `Elapsed: ${elapsed}s | ETA: ${remaining}s`
    );

    // Small delay between batches to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);

  console.log('\n' + '═'.repeat(70));
  console.log('RE-BACKFILL COMPLETE');
  console.log('═'.repeat(70));
  console.log(`  Total Processed: ${processed}`);
  console.log(`  Total Errors: ${errors}`);
  console.log(`  Total Time: ${totalTime} seconds`);
  console.log(`  Average Rate: ${(processed / totalTime).toFixed(1)} records/sec`);
  console.log('═'.repeat(70));
}

rebackfillDeepEmbeddings().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
