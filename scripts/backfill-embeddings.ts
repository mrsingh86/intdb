/**
 * Backfill embeddings for chronicle records that don't have them
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

async function main() {
  const embeddingService = createEmbeddingService(supabase);

  // Check how many need backfill
  const count = await embeddingService.getUnembeddedCount();
  console.log(`\n📊 Records without embeddings: ${count}\n`);

  if (count === 0) {
    console.log('✅ All records have embeddings!');
    return;
  }

  // Backfill in batches of 100
  const batchSize = 100;
  let totalProcessed = 0;
  let totalErrors = 0;

  while (totalProcessed + totalErrors < count) {
    console.log(`Processing batch ${Math.floor(totalProcessed / batchSize) + 1}...`);
    const result = await embeddingService.backfillEmbeddings(batchSize);

    totalProcessed += result.processed;
    totalErrors += result.errors;

    console.log(`  ✅ Processed: ${result.processed}, ❌ Errors: ${result.errors}`);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`BACKFILL COMPLETE`);
  console.log(`  Total Processed: ${totalProcessed}`);
  console.log(`  Total Errors: ${totalErrors}`);
  console.log(`════════════════════════════════════════\n`);
}

main().catch(e => console.error('Error:', e));
