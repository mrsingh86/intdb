/**
 * Fix is_response Flag
 *
 * Updates is_response flag based on subject line patterns (RE:/FW:)
 * This ensures consistency between raw_emails and classification data.
 *
 * Usage:
 *   npx tsx scripts/fix-is-response-flag.ts --sample 20   # Test on 20 emails
 *   npx tsx scripts/fix-is-response-flag.ts --all         # Fix all emails
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Detect if subject indicates a reply or forward
function isReplyOrForward(subject: string | null): boolean {
  if (!subject) return false;
  const cleanSubject = subject.trim();
  // Match RE:, Re:, FW:, Fwd:, FWD: at the beginning
  return /^(RE|Re|FW|Fwd|FWD)\s*:/i.test(cleanSubject);
}

async function main() {
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const allMode = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const sampleSize = sampleMode ? parseInt(args[args.indexOf('--sample') + 1] || '20') : 20;

  console.log('FIX is_response FLAG');
  console.log('='.repeat(70));

  if (!sampleMode && !allMode) {
    console.log('\nUsage:');
    console.log('  npx tsx scripts/fix-is-response-flag.ts --sample 20        # Test on 20 emails');
    console.log('  npx tsx scripts/fix-is-response-flag.ts --sample 20 --dry-run  # Dry run');
    console.log('  npx tsx scripts/fix-is-response-flag.ts --all              # Fix all emails');
    return;
  }

  // Get emails
  let query = supabase
    .from('raw_emails')
    .select('id, subject, is_response')
    .order('received_at', { ascending: false });

  if (sampleMode) {
    query = query.limit(sampleSize);
    console.log(`\nAnalyzing ${sampleSize} sample emails...`);
  } else {
    console.log('\nAnalyzing ALL emails...');
  }

  if (dryRun) {
    console.log('DRY RUN - no changes will be made\n');
  }

  const { data: emails, error } = await query;

  if (error) {
    console.error('Failed to fetch emails:', error.message);
    return;
  }

  console.log(`Found ${emails?.length || 0} emails\n`);

  let analyzed = 0;
  let needsUpdate = 0;
  let updated = 0;
  let failed = 0;

  const mismatches: Array<{
    id: string;
    subject: string;
    currentFlag: boolean;
    shouldBe: boolean;
  }> = [];

  for (const email of emails || []) {
    analyzed++;

    const shouldBeResponse = isReplyOrForward(email.subject);
    const currentFlag = email.is_response || false;

    if (shouldBeResponse !== currentFlag) {
      needsUpdate++;
      mismatches.push({
        id: email.id,
        subject: email.subject || '',
        currentFlag,
        shouldBe: shouldBeResponse,
      });

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('raw_emails')
          .update({ is_response: shouldBeResponse })
          .eq('id', email.id);

        if (updateError) {
          failed++;
          console.error(`  ✗ Failed to update ${email.id}: ${updateError.message}`);
        } else {
          updated++;
        }
      }
    }
  }

  // Show sample mismatches
  console.log('SAMPLE MISMATCHES:');
  console.log('-'.repeat(70));

  for (const m of mismatches.slice(0, 10)) {
    const arrow = m.currentFlag ? 'true → false' : 'false → true';
    console.log(`  [${arrow}] ${m.subject.substring(0, 55)}`);
  }

  if (mismatches.length > 10) {
    console.log(`  ... and ${mismatches.length - 10} more`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nAnalyzed: ${analyzed}`);
  console.log(`Needs update: ${needsUpdate} (${((needsUpdate / analyzed) * 100).toFixed(1)}%)`);

  if (!dryRun) {
    console.log(`Updated: ${updated}`);
    console.log(`Failed: ${failed}`);
  } else {
    console.log('\nRun without --dry-run to apply changes');
  }

  // Breakdown
  const falseToTrue = mismatches.filter(m => !m.currentFlag && m.shouldBe).length;
  const trueToFalse = mismatches.filter(m => m.currentFlag && !m.shouldBe).length;

  console.log(`\nBreakdown:`);
  console.log(`  false → true (has RE:/FW: but flagged as original): ${falseToTrue}`);
  console.log(`  true → false (no RE:/FW: but flagged as response): ${trueToFalse}`);
}

main().catch(console.error);
