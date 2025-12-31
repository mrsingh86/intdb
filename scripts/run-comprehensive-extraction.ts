/**
 * Run Comprehensive Extraction
 *
 * Processes all emails through the enhanced extraction pipeline to achieve
 * 100% field coverage on shipment data.
 *
 * Features:
 * - Re-processes all emails with enhanced extraction
 * - Creates/updates shipments with full data
 * - Tracks progress and reports statistics
 * - Handles failures gracefully
 *
 * Usage:
 *   npx ts-node scripts/run-comprehensive-extraction.ts [options]
 *
 * Options:
 *   --limit N       Process only N emails (default: all)
 *   --reprocess     Force reprocess already processed emails
 *   --dry-run       Show what would be done without making changes
 *   --advanced      Use Claude Sonnet for better extraction
 */

import { supabase } from '../utils/supabase-client';
import { EmailIngestionService } from '../lib/services/email-ingestion-service';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// Types
// ============================================================================

interface ExtractionStats {
  totalEmails: number;
  processed: number;
  successful: number;
  failed: number;
  shipmentsCreated: number;
  shipmentsUpdated: number;
  shipmentsLinked: number;
  fieldsExtracted: number;
  cutoffsExtracted: {
    si: number;
    vgm: number;
    cargo: number;
    gate: number;
  };
  processingTimeMs: number;
  errors: Array<{ emailId: string; error: string }>;
}

interface CommandOptions {
  limit: number | null;
  reprocess: boolean;
  dryRun: boolean;
  useAdvanced: boolean;
}

// ============================================================================
// Progress Display
// ============================================================================

function printHeader(): void {
  console.log('\n' + '='.repeat(70));
  console.log('  COMPREHENSIVE SHIPMENT EXTRACTION');
  console.log('  100% Field Coverage Pipeline');
  console.log('='.repeat(70) + '\n');
}

function printProgress(current: number, total: number, stats: ExtractionStats): void {
  const percent = ((current / total) * 100).toFixed(1);
  const bar = '='.repeat(Math.floor(current / total * 40));
  const empty = ' '.repeat(40 - bar.length);

  process.stdout.write(
    `\r[${bar}${empty}] ${percent}% | ` +
    `Processed: ${stats.processed} | ` +
    `Success: ${stats.successful} | ` +
    `Shipments: +${stats.shipmentsCreated} ~${stats.shipmentsUpdated}`
  );
}

function printStats(stats: ExtractionStats): void {
  const avgTime = stats.processed > 0 ? (stats.processingTimeMs / stats.processed).toFixed(0) : 0;

  console.log('\n\n' + '='.repeat(70));
  console.log('  EXTRACTION SUMMARY');
  console.log('='.repeat(70) + '\n');

  console.log('PROCESSING:');
  console.log(`  Total Emails:        ${stats.totalEmails}`);
  console.log(`  Processed:           ${stats.processed}`);
  console.log(`  Successful:          ${stats.successful} (${((stats.successful / stats.processed) * 100).toFixed(1)}%)`);
  console.log(`  Failed:              ${stats.failed}`);
  console.log(`  Avg Time per Email:  ${avgTime}ms`);
  console.log();

  console.log('SHIPMENTS:');
  console.log(`  Created:             ${stats.shipmentsCreated}`);
  console.log(`  Updated:             ${stats.shipmentsUpdated}`);
  console.log(`  Linked:              ${stats.shipmentsLinked}`);
  console.log(`  Fields Extracted:    ${stats.fieldsExtracted}`);
  console.log();

  console.log('CUTOFFS EXTRACTED:');
  console.log(`  SI Cutoffs:          ${stats.cutoffsExtracted.si}`);
  console.log(`  VGM Cutoffs:         ${stats.cutoffsExtracted.vgm}`);
  console.log(`  Cargo Cutoffs:       ${stats.cutoffsExtracted.cargo}`);
  console.log(`  Gate Cutoffs:        ${stats.cutoffsExtracted.gate}`);
  console.log();

  if (stats.errors.length > 0) {
    console.log('ERRORS (showing first 10):');
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`  [${err.emailId.substring(0, 8)}...] ${err.error}`);
    }
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more errors`);
    }
    console.log();
  }

  console.log('='.repeat(70) + '\n');
}

// ============================================================================
// Main Processing
// ============================================================================

async function getEmailsToProcess(options: CommandOptions): Promise<string[]> {
  const allIds: string[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from('raw_emails')
      .select('id');

    if (!options.reprocess) {
      // Only get unprocessed or failed emails
      query = query.or('processing_status.is.null,processing_status.eq.pending,processing_status.eq.failed');
    }

    // Process oldest first, so newer emails overwrite with "latest wins" logic
    query = query.order('received_at', { ascending: true });

    // Pagination
    query = query.range(offset, offset + pageSize - 1);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch emails: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    allIds.push(...data.map(e => e.id));

    // If user specified limit, stop when reached
    if (options.limit && allIds.length >= options.limit) {
      return allIds.slice(0, options.limit);
    }

    // If we got less than pageSize, we've reached the end
    if (data.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allIds;
}

async function runExtraction(options: CommandOptions): Promise<ExtractionStats> {
  const stats: ExtractionStats = {
    totalEmails: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    shipmentsCreated: 0,
    shipmentsUpdated: 0,
    shipmentsLinked: 0,
    fieldsExtracted: 0,
    cutoffsExtracted: { si: 0, vgm: 0, cargo: 0, gate: 0 },
    processingTimeMs: 0,
    errors: []
  };

  // Initialize service
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY not found in environment');
  }

  const ingestionService = new EmailIngestionService(
    supabase,
    anthropicKey,
    { useAdvancedModel: options.useAdvanced }
  );

  // Get emails to process
  console.log('Fetching emails to process...');
  const emailIds = await getEmailsToProcess(options);
  stats.totalEmails = emailIds.length;

  console.log(`Found ${emailIds.length} emails to process\n`);

  if (options.dryRun) {
    console.log('DRY RUN - No changes will be made\n');
    return stats;
  }

  if (emailIds.length === 0) {
    console.log('No emails to process.\n');
    return stats;
  }

  // Process emails
  const startTime = Date.now();

  for (let i = 0; i < emailIds.length; i++) {
    const emailId = emailIds[i];

    try {
      const result = await ingestionService.ingestEmail(emailId, {
        forceReprocess: options.reprocess,
        useAdvancedModel: options.useAdvanced
      });

      stats.processed++;

      if (result.success) {
        stats.successful++;
        stats.fieldsExtracted += result.fieldsExtracted;

        switch (result.shipmentAction) {
          case 'created':
            stats.shipmentsCreated++;
            break;
          case 'updated':
            stats.shipmentsUpdated++;
            break;
          case 'linked':
            stats.shipmentsLinked++;
            break;
        }

        // Track cutoff extraction
        for (const entity of result.entities) {
          if (entity.type === 'si_cutoff' && entity.value) stats.cutoffsExtracted.si++;
          if (entity.type === 'vgm_cutoff' && entity.value) stats.cutoffsExtracted.vgm++;
          if (entity.type === 'cargo_cutoff' && entity.value) stats.cutoffsExtracted.cargo++;
          if (entity.type === 'gate_cutoff' && entity.value) stats.cutoffsExtracted.gate++;
        }
      } else {
        stats.failed++;
        if (result.error && result.error !== 'Already processed') {
          stats.errors.push({ emailId, error: result.error });
        }
      }

      stats.processingTimeMs = Date.now() - startTime;

    } catch (error: any) {
      stats.processed++;
      stats.failed++;
      stats.errors.push({ emailId, error: error.message });
    }

    // Print progress
    printProgress(i + 1, emailIds.length, stats);

    // Rate limiting - 200ms between requests
    await new Promise(r => setTimeout(r, 200));
  }

  return stats;
}

async function verifyDataQuality(): Promise<void> {
  console.log('\nVerifying data quality...\n');

  // Get shipment counts
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  // Get shipments with cutoffs
  const { count: withSiCutoff } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('si_cutoff', 'is', null);

  const { count: withVgmCutoff } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('vgm_cutoff', 'is', null);

  const { count: withCargoCutoff } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('cargo_cutoff', 'is', null);

  const { count: withEtd } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('etd', 'is', null);

  const { count: withEta } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('eta', 'is', null);

  const { count: withVessel } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('vessel_name', 'is', null);

  const total = shipmentCount || 1;

  console.log('SHIPMENT DATA COVERAGE:');
  console.log(`  Total Shipments:     ${shipmentCount}`);
  console.log(`  With SI Cutoff:      ${withSiCutoff} (${((withSiCutoff || 0) / total * 100).toFixed(1)}%)`);
  console.log(`  With VGM Cutoff:     ${withVgmCutoff} (${((withVgmCutoff || 0) / total * 100).toFixed(1)}%)`);
  console.log(`  With Cargo Cutoff:   ${withCargoCutoff} (${((withCargoCutoff || 0) / total * 100).toFixed(1)}%)`);
  console.log(`  With ETD:            ${withEtd} (${((withEtd || 0) / total * 100).toFixed(1)}%)`);
  console.log(`  With ETA:            ${withEta} (${((withEta || 0) / total * 100).toFixed(1)}%)`);
  console.log(`  With Vessel:         ${withVessel} (${((withVessel || 0) / total * 100).toFixed(1)}%)`);
  console.log();
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(): CommandOptions {
  const args = process.argv.slice(2);
  const options: CommandOptions = {
    limit: null,
    reprocess: false,
    dryRun: false,
    useAdvanced: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        options.limit = parseInt(args[++i]);
        break;
      case '--reprocess':
        options.reprocess = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--advanced':
        options.useAdvanced = true;
        break;
      case '--help':
        console.log(`
Usage: npx ts-node scripts/run-comprehensive-extraction.ts [options]

Options:
  --limit N       Process only N emails (default: all)
  --reprocess     Force reprocess already processed emails
  --dry-run       Show what would be done without making changes
  --advanced      Use Claude Sonnet for better extraction (slower, more accurate)
  --help          Show this help message
`);
        process.exit(0);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs();

  printHeader();

  console.log('Configuration:');
  console.log(`  Limit:       ${options.limit || 'All emails'}`);
  console.log(`  Reprocess:   ${options.reprocess}`);
  console.log(`  Dry Run:     ${options.dryRun}`);
  console.log(`  Model:       ${options.useAdvanced ? 'Claude Sonnet (advanced)' : 'Claude Haiku (fast)'}`);
  console.log();

  try {
    const stats = await runExtraction(options);
    printStats(stats);

    if (!options.dryRun) {
      await verifyDataQuality();
    }

    console.log('Done!\n');

  } catch (error: any) {
    console.error('\nFATAL ERROR:', error.message);
    process.exit(1);
  }
}

main();
