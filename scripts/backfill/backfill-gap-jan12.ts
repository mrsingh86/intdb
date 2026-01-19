/**
 * One-time Backfill Script: Jan 12-13 Gap
 *
 * Fetches emails from the gap period (Jan 12 09:00 UTC → Jan 13 04:00 UTC)
 * and processes them through the Chronicle pipeline.
 *
 * Uses same services as production for full intelligence.
 *
 * Usage: npx tsx scripts/backfill-gap-jan12.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  ChronicleService,
  ChronicleLogger,
  createChronicleGmailService,
} from '../lib/chronicle';

// Gap period to backfill
const GAP_START = new Date('2026-01-12T09:00:00Z');
const GAP_END = new Date('2026-01-13T04:00:00Z');
const MAX_EMAILS = 500;
const CONCURRENCY = 5;

async function main() {
  console.log('='.repeat(60));
  console.log('CHRONICLE BACKFILL: Jan 12-13 Gap');
  console.log('='.repeat(60));
  console.log(`Period: ${GAP_START.toISOString()} → ${GAP_END.toISOString()}`);
  console.log(`Max emails: ${MAX_EMAILS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('='.repeat(60));

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing SUPABASE environment variables');
    process.exit(1);
  }

  // Initialize services (same as production)
  const supabase = createClient(supabaseUrl, supabaseKey);
  const gmailService = createChronicleGmailService();
  const logger = new ChronicleLogger(supabase);
  const chronicleService = new ChronicleService(supabase, gmailService, logger);

  console.log('\n[1/3] Fetching emails from Gmail for gap period...');

  try {
    // Fetch emails for the gap period
    const emails = await gmailService.fetchEmailsByTimestamp({
      after: GAP_START,
      before: GAP_END,
      maxResults: MAX_EMAILS,
    });

    console.log(`Found ${emails.length} emails in gap period`);

    if (emails.length === 0) {
      console.log('\nNo emails found in gap period. Exiting.');
      return;
    }

    console.log('\n[2/3] Processing emails through Chronicle pipeline...');
    console.log('(Using same AI analysis, thread context, and linking as production)\n');

    // Process through Chronicle (same as production)
    const result = await chronicleService.processBatch(
      emails,
      undefined,
      MAX_EMAILS,
      CONCURRENCY
    );

    console.log('\n[3/3] Backfill Complete!');
    console.log('='.repeat(60));
    console.log('RESULTS:');
    console.log(`  Total processed: ${result.processed}`);
    console.log(`  Succeeded: ${result.succeeded}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Already existed (skipped): ${result.processed - result.succeeded - result.failed}`);
    console.log(`  Linked to shipments: ${result.linked}`);
    console.log(`  Time taken: ${(result.totalTimeMs / 1000).toFixed(1)}s`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nFATAL ERROR:', error);
    process.exit(1);
  }
}

main();
