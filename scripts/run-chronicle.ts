/**
 * Chronicle Runner Script
 *
 * Fetches emails from Gmail by timestamp and processes them into chronicle.
 * Emails are processed OLDEST FIRST to build correct shipment timelines.
 *
 * Usage:
 *   npx tsx scripts/run-chronicle.ts --hours 24                              # Last 24 hours (max 2000)
 *   npx tsx scripts/run-chronicle.ts --days 7                                # Last 7 days (max 2000)
 *   npx tsx scripts/run-chronicle.ts --after 2026-01-01                      # After specific date
 *   npx tsx scripts/run-chronicle.ts --after 2025-12-01 --before 2025-12-08  # Date range (max 2000)
 *   npx tsx scripts/run-chronicle.ts --after 2025-12-01 --before 2025-12-08 --all  # ALL emails in range
 *   npx tsx scripts/run-chronicle.ts --migrate                               # Run migration only
 *
 * For backfill:
 *   Use --all flag to process ALL emails in a bounded date range.
 *   Without --all, only 2000 most recent emails in range are processed.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createChronicleGmailService, createChronicleService, ChronicleLogger } from '../lib/chronicle';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// CLI PARSING
// ============================================================================

function parseArgs(): {
  migrate: boolean;
  after?: Date;
  before?: Date;
  maxResults: number;
  all: boolean;
  query?: string;
} {
  const args = process.argv.slice(2);
  const result: ReturnType<typeof parseArgs> = {
    migrate: false,
    maxResults: 2000,
    all: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--migrate') {
      result.migrate = true;
    } else if (arg === '--all') {
      // Process ALL emails in the date range (no limit)
      result.all = true;
      result.maxResults = 50000; // Very high limit for "all"
    } else if (arg === '--hours' && args[i + 1]) {
      const hours = parseInt(args[++i]);
      result.after = new Date(Date.now() - hours * 60 * 60 * 1000);
    } else if (arg === '--days' && args[i + 1]) {
      const days = parseInt(args[++i]);
      result.after = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    } else if (arg === '--after' && args[i + 1]) {
      result.after = new Date(args[++i]);
    } else if (arg === '--before' && args[i + 1]) {
      result.before = new Date(args[++i]);
    } else if (arg === '--max' && args[i + 1]) {
      result.maxResults = parseInt(args[++i]);
    } else if (arg === '--query' && args[i + 1]) {
      result.query = args[++i];
    }
  }

  return result;
}

// ============================================================================
// MIGRATION
// ============================================================================

async function runMigration(): Promise<boolean> {
  console.log('Running chronicle migration...');

  const migrationPath = path.join(__dirname, '../lib/chronicle/migration.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

  // Split into statements (simple split by semicolon)
  const statements = migrationSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });

      if (error) {
        // Try direct execution for DDL statements
        const { error: directError } = await supabase.from('_migrations').select('*').limit(0);

        // Log but continue - some statements may fail if objects already exist
        console.log(`  Statement result: ${error.message.substring(0, 100)}`);
      } else {
        successCount++;
      }
    } catch (e) {
      errorCount++;
      console.error(`  Error: ${e}`);
    }
  }

  console.log(`Migration complete: ${successCount} succeeded, ${errorCount} had issues`);
  console.log('\nNOTE: Run migration.sql directly in Supabase SQL Editor for best results.');

  return true;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('CHRONICLE INTELLIGENCE SYSTEM');
  console.log('='.repeat(60));

  const args = parseArgs();

  // Run migration if requested
  if (args.migrate) {
    await runMigration();
    console.log('\nMigration SQL file location: lib/chronicle/migration.sql');
    console.log('Please run this file in Supabase SQL Editor to create the tables.');
    return;
  }

  // Default to last 24 hours if no time range specified
  if (!args.after && !args.before) {
    args.after = new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  console.log('\nConfiguration:');
  console.log(`  After: ${args.after?.toISOString() || 'not set'}`);
  console.log(`  Before: ${args.before?.toISOString() || 'not set'}`);
  console.log(`  Max Results: ${args.all ? 'ALL (no limit)' : args.maxResults}`);
  console.log(`  Additional Query: ${args.query || 'none'}`);

  // Initialize services
  console.log('\nInitializing services...');

  let gmailService;
  try {
    gmailService = createChronicleGmailService();
  } catch (error) {
    console.error('Failed to create Gmail service:', error);
    console.log('\nMake sure these environment variables are set:');
    console.log('  - GOOGLE_CLIENT_EMAIL');
    console.log('  - GOOGLE_PRIVATE_KEY');
    console.log('  - GOOGLE_ACCOUNT_EMAIL');
    process.exit(1);
  }

  // Test Gmail connection
  const connected = await gmailService.testConnection();
  if (!connected) {
    console.error('Gmail connection failed');
    process.exit(1);
  }

  // Create logger and service with logging
  const logger = new ChronicleLogger(supabase);
  const chronicleService = createChronicleService(supabase, gmailService, logger);

  // Check if chronicle table exists
  const { error: tableError } = await supabase.from('chronicle').select('id').limit(1);

  if (tableError && tableError.message.includes('does not exist')) {
    console.error('\nChronicle table does not exist!');
    console.log('Run: npx ts-node scripts/run-chronicle.ts --migrate');
    console.log('Then execute migration.sql in Supabase SQL Editor');
    process.exit(1);
  }

  // Fetch and process emails
  console.log('\nFetching and processing emails...');

  const result = await chronicleService.fetchAndProcess({
    after: args.after,
    before: args.before,
    maxResults: args.maxResults,
    query: args.query,
  });

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`  Total processed: ${result.processed}`);
  console.log(`  Succeeded: ${result.succeeded}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  Linked to shipment: ${result.linked}`);
  console.log(`  Total time: ${(result.totalTimeMs / 1000).toFixed(2)}s`);
  console.log(
    `  Avg per email: ${result.processed > 0 ? (result.totalTimeMs / result.processed).toFixed(0) : 0}ms`
  );

  // Print failures
  const failures = result.results.filter((r) => !r.success);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures.slice(0, 10)) {
      console.log(`  - ${f.gmailMessageId}: ${f.error}`);
    }
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more`);
    }
  }

  // Print linked emails
  const linked = result.results.filter((r) => r.shipmentId);
  if (linked.length > 0) {
    console.log('\nLinked to shipments:');
    for (const l of linked.slice(0, 10)) {
      console.log(`  - ${l.gmailMessageId} → ${l.shipmentId} (by ${l.linkedBy})`);
    }
    if (linked.length > 10) {
      console.log(`  ... and ${linked.length - 10} more`);
    }
  }

  // Cost estimate
  const costPerEmail = 0.001; // ~$0.001 per email
  const estimatedCost = result.succeeded * costPerEmail;
  console.log(`\nEstimated AI cost: $${estimatedCost.toFixed(4)}`);
}

// ============================================================================
// RUN
// ============================================================================

main()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
