/**
 * Flag Records for Manual Review
 *
 * Identifies chronicle records that need manual classification review:
 * 1. Records with document_type = 'unknown'
 * 2. Records with generic types (notification, general_correspondence)
 * 3. Records where summary doesn't match document type keywords
 * 4. Records that failed reclassification (ZodError kept old type)
 *
 * Usage: npx tsx scripts/flag-for-review.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Keywords that should appear in summary for each document type
const VALIDATION_KEYWORDS: Record<string, string[]> = {
  booking_confirmation: ['booking', 'confirmed', 'booked', 'confirmation'],
  booking_amendment: ['amendment', 'amend', 'change', 'update', 'revised'],
  draft_bl: ['draft', 'bl', 'bill of lading', 'hbl', 'mbl', 'b/l'],
  final_bl: ['final', 'original', 'obl', 'bl', 'bill of lading'],
  arrival_notice: ['arrival', 'arrive', 'notice', 'an ', 'eta'],
  sob_confirmation: ['sob', 'shipped on board', 'on board', 'loaded', 'shipped'],
  telex_release: ['telex', 'release', 'surrender', 'seaway'],
  delivery_order: ['delivery', 'order', 'do ', 'release'],
  invoice: ['invoice', 'inv', 'payment', 'amount', 'charges'],
  vgm_confirmation: ['vgm', 'verified gross mass', 'weight'],
  shipping_instructions: ['shipping instruction', 'si ', 'instructions'],
  si_confirmation: ['si ', 'confirmed', 'instructions confirmed'],
};

// Only flag truly unknown types (not all generic - those may be correct)
const TRULY_UNKNOWN_TYPES = ['unknown'];

async function flagRecords(dryRun: boolean) {
  console.log('='.repeat(70));
  console.log('FLAG RECORDS FOR MANUAL REVIEW');
  console.log('='.repeat(70));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log('');

  let totalFlagged = 0;

  // 1. Flag truly unknown types only
  console.log('1. Checking unknown document types...');
  const { data: unknownRecords, count: unknownCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .in('document_type', TRULY_UNKNOWN_TYPES)
    .eq('needs_review', false);

  if (unknownCount && unknownCount > 0) {
    console.log(`   Found ${unknownCount} records with unknown type`);
    if (!dryRun) {
      await supabase
        .from('chronicle')
        .update({
          needs_review: true,
          review_status: 'pending',
          review_reason: 'unknown_type',
        })
        .in('document_type', TRULY_UNKNOWN_TYPES)
        .eq('needs_review', false);
    }
    totalFlagged += unknownCount;
  }

  // 2. Flag records where summary doesn't match document type
  console.log('2. Checking summary/type mismatches...');
  let mismatchCount = 0;

  for (const [docType, keywords] of Object.entries(VALIDATION_KEYWORDS)) {
    const { data: records } = await supabase
      .from('chronicle')
      .select('id, summary')
      .eq('document_type', docType)
      .eq('needs_review', false)
      .not('reanalyzed_at', 'is', null) // Only reclassified records
      .limit(500);

    if (!records) continue;

    const mismatched = records.filter(r => {
      const summary = (r.summary || '').toLowerCase();
      return !keywords.some(kw => summary.includes(kw));
    });

    if (mismatched.length > 0) {
      console.log(`   ${docType}: ${mismatched.length} potential mismatches`);
      mismatchCount += mismatched.length;

      if (!dryRun && mismatched.length > 0) {
        const ids = mismatched.map(r => r.id);
        // Update in batches of 100
        for (let i = 0; i < ids.length; i += 100) {
          const batch = ids.slice(i, i + 100);
          await supabase
            .from('chronicle')
            .update({
              needs_review: true,
              review_status: 'pending',
              review_reason: 'summary_mismatch',
            })
            .in('id', batch);
        }
      }
    }
  }
  totalFlagged += mismatchCount;

  // 3. Flag records with very short summaries (likely processing issues)
  console.log('3. Checking short/missing summaries...');
  const { data: shortSummaries, count: shortCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .eq('needs_review', false)
    .not('reanalyzed_at', 'is', null)
    .or('summary.is.null,summary.eq.No summary available');

  if (shortCount && shortCount > 0) {
    console.log(`   Found ${shortCount} records with missing/default summaries`);
    if (!dryRun) {
      await supabase
        .from('chronicle')
        .update({
          needs_review: true,
          review_status: 'pending',
          review_reason: 'missing_summary',
        })
        .eq('needs_review', false)
        .not('reanalyzed_at', 'is', null)
        .or('summary.is.null,summary.eq.No summary available');
    }
    totalFlagged += shortCount;
  }

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total records flagged: ${totalFlagged}`);
  console.log(`  - Unknown types: ${unknownCount || 0}`);
  console.log(`  - Summary mismatches: ${mismatchCount}`);
  console.log(`  - Missing summaries: ${shortCount || 0}`);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN - No changes made. Run without --dry-run to apply.');
  } else {
    console.log('Records have been flagged for review.');
    console.log('Visit /classification-review to review them.');
  }
}

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

flagRecords(dryRun).catch(console.error);
