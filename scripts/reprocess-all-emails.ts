/**
 * Reprocess All Emails Script
 *
 * Full pipeline reprocessing with PDF context:
 * 1. Reclassify (email + PDF text)
 * 2. Re-extract entities (35+ fields)
 * 3. Link/create shipments
 * 4. Extract stakeholders
 * 5. Build document lifecycle
 */

import { createClient } from '@supabase/supabase-js';
import { EmailIngestionService } from '../lib/services/email-ingestion-service';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const MAX_TOTAL = parseInt(process.env.MAX_TOTAL || '5000', 10);
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '100', 10);
const START_OFFSET = parseInt(process.env.START_OFFSET || '0', 10);
const END_OFFSET = parseInt(process.env.END_OFFSET || '999999', 10);
const INSTANCE_ID = process.env.INSTANCE_ID || '1';

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`                 REPROCESSING PIPELINE - INSTANCE ${INSTANCE_ID}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Settings: Batch=${BATCH_SIZE}, Rate=${RATE_LIMIT_MS}ms, Range=${START_OFFSET}-${END_OFFSET}`);
  console.log('');

  // Initialize service
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }

  const ingestionService = new EmailIngestionService(supabase, anthropicKey, {
    useAdvancedModel: false // Use Haiku for speed
  });

  // Get all email IDs (paginate to get all)
  let allEmails: { id: string }[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: batch, error: fetchError } = await supabase
      .from('raw_emails')
      .select('id')
      .order('received_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (fetchError) {
      console.error('Failed to fetch emails:', fetchError);
      process.exit(1);
    }

    if (!batch || batch.length === 0) break;

    allEmails = allEmails.concat(batch);
    offset += pageSize;

    if (batch.length < pageSize) break;
    if (allEmails.length >= MAX_TOTAL) {
      allEmails = allEmails.slice(0, MAX_TOTAL);
      break;
    }
  }

  const error = null;

  if (error || !allEmails) {
    console.error('Failed to fetch emails:', error);
    process.exit(1);
  }

  // Apply range filter for parallel processing
  const slicedEmails = allEmails.slice(START_OFFSET, Math.min(END_OFFSET, allEmails.length));
  const emailIds = slicedEmails.map(e => e.id);
  console.log(`Total emails in DB: ${allEmails.length}`);
  console.log(`Processing range: ${START_OFFSET} to ${Math.min(END_OFFSET, allEmails.length)}`);
  console.log(`Emails to process: ${emailIds.length}`);
  console.log('');

  // Stats
  let processed = 0;
  let successful = 0;
  let failed = 0;
  let shipmentsCreated = 0;
  let shipmentsUpdated = 0;
  let shipmentsLinked = 0;
  let totalEntities = 0;

  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
    const batch = emailIds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(emailIds.length / BATCH_SIZE);

    console.log(`\n─── Batch ${batchNum}/${totalBatches} (${batch.length} emails) ───`);

    for (const emailId of batch) {
      try {
        const result = await ingestionService.ingestEmail(emailId, {
          forceReprocess: true
        });

        processed++;

        if (result.success) {
          successful++;
          totalEntities += result.fieldsExtracted;

          if (result.shipmentAction === 'created') shipmentsCreated++;
          else if (result.shipmentAction === 'updated') shipmentsUpdated++;
          else if (result.shipmentAction === 'linked') shipmentsLinked++;

          // Progress indicator
          const docType = result.classification?.document_type || 'unknown';
          const shortType = docType.substring(0, 15).padEnd(15);
          process.stdout.write(`  ✅ ${shortType} | ${result.fieldsExtracted} fields | ${result.shipmentAction}\n`);
        } else {
          failed++;
          process.stdout.write(`  ❌ ${result.error?.substring(0, 50) || 'Unknown error'}\n`);
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

      } catch (err: any) {
        failed++;
        processed++;
        console.error(`  ❌ Error: ${err.message?.substring(0, 50)}`);
      }
    }

    // Batch summary
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = Math.round(processed / elapsed * 60);
    const eta = Math.round((emailIds.length - processed) / rate);

    console.log(`\n  Progress: ${processed}/${emailIds.length} | Success: ${successful} | Failed: ${failed}`);
    console.log(`  Rate: ${rate}/min | ETA: ${eta} min`);
  }

  // Final summary
  const totalTime = Math.round((Date.now() - startTime) / 1000);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         REPROCESSING COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Total processed:     ${processed}`);
  console.log(`  Successful:          ${successful} (${Math.round(successful/processed*100)}%)`);
  console.log(`  Failed:              ${failed}`);
  console.log('');
  console.log('  SHIPMENTS:');
  console.log(`    Created:           ${shipmentsCreated}`);
  console.log(`    Updated:           ${shipmentsUpdated}`);
  console.log(`    Linked:            ${shipmentsLinked}`);
  console.log('');
  console.log(`  Total entities:      ${totalEntities}`);
  console.log(`  Time:                ${Math.floor(totalTime/60)}m ${totalTime%60}s`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
