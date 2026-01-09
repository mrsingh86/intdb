/**
 * Backfill Chronicle 4-Point Routing
 *
 * This script updates existing chronicle records with the new 4-point routing
 * and multi-cutoff fields by re-processing emails through the AI.
 *
 * Usage:
 *   npx ts-node scripts/backfill-chronicle-4point.ts --dry-run      # Preview changes
 *   npx ts-node scripts/backfill-chronicle-4point.ts --migrate      # Migrate from old fields
 *   npx ts-node scripts/backfill-chronicle-4point.ts --reprocess    # Full AI reprocessing
 *   npx ts-node scripts/backfill-chronicle-4point.ts --limit 10     # Process only 10 records
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

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

interface Args {
  dryRun: boolean;
  migrate: boolean;
  reprocess: boolean;
  limit: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    dryRun: false,
    migrate: false,
    reprocess: false,
    limit: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') result.dryRun = true;
    if (arg === '--migrate') result.migrate = true;
    if (arg === '--reprocess') result.reprocess = true;
    if (arg === '--limit' && args[i + 1]) result.limit = parseInt(args[++i]);
  }

  return result;
}

// ============================================================================
// MIGRATION LOGIC
// ============================================================================

interface MigrationResult {
  id: string;
  por_location: string | null;
  pol_location: string | null;
  pod_location: string | null;
  pofd_location: string | null;
  por_type: string | null;
  pol_type: string | null;
  pod_type: string | null;
  pofd_type: string | null;
}

/**
 * Migrate existing origin/destination to 4-point routing based on type
 */
function migrateToFourPoint(record: {
  id: string;
  transport_mode: string | null;
  origin_location: string | null;
  origin_type: string | null;
  destination_location: string | null;
  destination_type: string | null;
}): MigrationResult {
  const result: MigrationResult = {
    id: record.id,
    por_location: null,
    pol_location: null,
    pod_location: null,
    pofd_location: null,
    por_type: null,
    pol_type: null,
    pod_type: null,
    pofd_type: null,
  };

  // Map origin based on type
  if (record.origin_location) {
    if (record.origin_type === 'port' || record.origin_type === 'airport' || record.origin_type === 'rail_terminal') {
      // It's a POL (Port of Loading)
      result.pol_location = record.origin_location;
      result.pol_type = record.origin_type;
    } else if (record.origin_type === 'warehouse' || record.origin_type === 'address') {
      // It's a POR (Place of Receipt) for trucking
      if (record.transport_mode === 'road') {
        result.por_location = record.origin_location;
        result.por_type = record.origin_type === 'address' ? 'address' : 'warehouse';
      } else {
        // For ocean/air, addresses near port are often POL
        result.pol_location = record.origin_location;
        result.pol_type = 'unknown';
      }
    }
  }

  // Map destination based on type
  if (record.destination_location) {
    if (record.destination_type === 'port' || record.destination_type === 'airport' || record.destination_type === 'rail_terminal') {
      // It's a POD (Port of Discharge)
      result.pod_location = record.destination_location;
      result.pod_type = record.destination_type;
    } else if (record.destination_type === 'warehouse' || record.destination_type === 'address') {
      // It's a POFD (Place of Final Delivery)
      result.pofd_location = record.destination_location;
      result.pofd_type = record.destination_type === 'address' ? 'address' : 'warehouse';
    }
  }

  return result;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('CHRONICLE 4-POINT ROUTING BACKFILL');
  console.log('='.repeat(70));

  const args = parseArgs();

  console.log('\nConfiguration:');
  console.log(`  Dry Run: ${args.dryRun}`);
  console.log(`  Migrate from old fields: ${args.migrate}`);
  console.log(`  Reprocess with AI: ${args.reprocess}`);
  console.log(`  Limit: ${args.limit || 'all'}`);

  if (!args.migrate && !args.reprocess) {
    console.log('\nPlease specify --migrate or --reprocess');
    console.log('  --migrate: Map existing origin/destination to 4-point routing');
    console.log('  --reprocess: Re-run AI extraction (requires API calls)');
    return;
  }

  // =========================================================================
  // STEP 1: Get records to process
  // =========================================================================

  console.log('\nFetching records...');

  let query = supabase
    .from('chronicle')
    .select('id, transport_mode, origin_location, origin_type, destination_location, destination_type, ai_response')
    .order('created_at', { ascending: false });

  // Only get records that don't have 4-point routing yet
  query = query.is('pol_location', null);

  if (args.limit > 0) {
    query = query.limit(args.limit);
  }

  const { data: records, error } = await query;

  if (error) {
    console.error('Error fetching records:', error);
    return;
  }

  console.log(`Found ${records?.length || 0} records to process`);

  if (!records || records.length === 0) {
    console.log('No records need processing');
    return;
  }

  // =========================================================================
  // STEP 2: Process records
  // =========================================================================

  if (args.migrate) {
    console.log('\n--- MIGRATION MODE ---');
    console.log('Mapping origin/destination to 4-point routing...\n');

    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      const mapped = migrateToFourPoint(record);

      // Check if we have any mappings
      const hasMapping = mapped.por_location || mapped.pol_location ||
                        mapped.pod_location || mapped.pofd_location;

      if (!hasMapping) {
        skipped++;
        continue;
      }

      if (args.dryRun) {
        console.log(`[DRY RUN] ${record.id}:`);
        console.log(`  Origin: ${record.origin_location} (${record.origin_type})`);
        console.log(`  Dest:   ${record.destination_location} (${record.destination_type})`);
        console.log(`  →`);
        if (mapped.por_location) console.log(`  POR:  ${mapped.por_location} (${mapped.por_type})`);
        if (mapped.pol_location) console.log(`  POL:  ${mapped.pol_location} (${mapped.pol_type})`);
        if (mapped.pod_location) console.log(`  POD:  ${mapped.pod_location} (${mapped.pod_type})`);
        if (mapped.pofd_location) console.log(`  POFD: ${mapped.pofd_location} (${mapped.pofd_type})`);
        console.log('');
        updated++;
      } else {
        const { error: updateError } = await supabase
          .from('chronicle')
          .update({
            por_location: mapped.por_location,
            por_type: mapped.por_type,
            pol_location: mapped.pol_location,
            pol_type: mapped.pol_type,
            pod_location: mapped.pod_location,
            pod_type: mapped.pod_type,
            pofd_location: mapped.pofd_location,
            pofd_type: mapped.pofd_type,
          })
          .eq('id', record.id);

        if (updateError) {
          console.error(`Error updating ${record.id}:`, updateError);
        } else {
          updated++;
          if (updated % 10 === 0) {
            console.log(`Processed ${updated}/${records.length}...`);
          }
        }
      }
    }

    console.log('\n--- RESULTS ---');
    console.log(`Total records: ${records.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (no mapping): ${skipped}`);
  }

  if (args.reprocess) {
    console.log('\n--- REPROCESS MODE ---');
    console.log('This will re-run AI extraction for each email.');
    console.log('Note: This requires API calls and will incur costs.');
    console.log('\nNot implemented yet. Use --migrate for now.');
  }
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
