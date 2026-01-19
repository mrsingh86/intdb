/**
 * Reprocess emails that are missing classification or extraction
 *
 * Target: 437 unclassified emails + 498 without extractions
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Dynamically import the orchestrator
async function getOrchestrator() {
  const { EmailProcessingOrchestrator } = await import('../lib/services/email-processing-orchestrator');
  return new EmailProcessingOrchestrator(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    process.env.ANTHROPIC_API_KEY || ''
  );
}

async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; value: any }
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('REPROCESSING UNCLASSIFIED/UNEXTRACTED EMAILS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Find emails needing reprocessing
  console.log('\n1. Finding emails to reprocess...');

  const allEmails = await fetchAll<{ id: string; gmail_message_id: string; subject: string }>(
    'raw_emails',
    'id, gmail_message_id, subject'
  );
  const classifiedIds = await fetchAll<{ email_id: string }>('document_classifications', 'email_id');
  const classifiedSet = new Set(classifiedIds.map(c => c.email_id));

  // Find unclassified emails (excluding obvious non-shipping)
  const nonShippingPatterns = [
    /passcode/i,
    /newsletter/i,
    /substack/i,
    /unsubscribe/i,
    /password reset/i,
    /account verification/i,
    /culture fit/i,
    /media releases/i,
    /thank you for being/i,
    /transport topics/i,
  ];

  const toReprocess = allEmails.filter(e => {
    // Already classified? Skip
    if (classifiedSet.has(e.id)) return false;

    // Known non-shipping? Skip
    const subject = e.subject || '';
    for (const pattern of nonShippingPatterns) {
      if (pattern.test(subject)) return false;
    }

    return true;
  });

  console.log(`   Total unclassified: ${allEmails.length - classifiedSet.size}`);
  console.log(`   Filtered non-shipping: ${allEmails.length - classifiedSet.size - toReprocess.length}`);
  console.log(`   To reprocess: ${toReprocess.length}`);

  if (toReprocess.length === 0) {
    console.log('\n   ✅ No emails need reprocessing');
    return;
  }

  // 2. Sample what we're about to reprocess
  console.log('\n2. Sample emails to reprocess:');
  for (const e of toReprocess.slice(0, 10)) {
    console.log(`   - ${(e.subject || 'No subject').substring(0, 70)}`);
  }

  // 3. Ask for confirmation
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made');
    console.log('   Run with --execute to actually reprocess');
    console.log(`\n   Would reprocess ${toReprocess.length} emails`);
    return;
  }

  // 4. Initialize orchestrator
  console.log('\n3. Initializing orchestrator...');
  const orchestrator = await getOrchestrator();

  // 5. Process in batches
  console.log('\n4. Reprocessing emails...');
  let processed = 0;
  let classified = 0;
  let extracted = 0;
  let errors = 0;

  const batchSize = 10;
  for (let i = 0; i < toReprocess.length; i += batchSize) {
    const batch = toReprocess.slice(i, i + batchSize);

    for (const email of batch) {
      try {
        // Reset processing status
        await supabase
          .from('raw_emails')
          .update({ processing_status: 'pending' })
          .eq('id', email.id);

        // Reprocess via orchestrator
        const result = await orchestrator.processEmail(email.id);

        processed++;

        if (result.success) classified++;
        if (result.fieldsExtracted && result.fieldsExtracted > 0) extracted++;

        if (processed % 50 === 0) {
          console.log(`   Processed ${processed} / ${toReprocess.length} (${classified} classified, ${extracted} extracted)`);
        }
      } catch (error: any) {
        errors++;
        console.log(`   ❌ Error processing ${email.id}: ${error.message?.substring(0, 50)}`);
      }
    }
  }

  // 6. Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('REPROCESSING SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`\n   Total processed: ${processed}`);
  console.log(`   Newly classified: ${classified}`);
  console.log(`   Newly extracted: ${extracted}`);
  console.log(`   Errors: ${errors}`);

  // Verify final counts
  const { count: finalClassified } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  const { count: finalExtracted } = await supabase
    .from('entity_extractions')
    .select('email_id', { count: 'exact', head: true });

  console.log(`\n   Final classified count: ${finalClassified}`);
  console.log(`   Final extracted count: ${finalExtracted}`);
}

main().catch(console.error);
