/**
 * Complete AI Summary Backfill
 *
 * Regenerates ALL AI summaries using the production HaikuSummaryService.
 * This incorporates all fixes from cross-validation:
 * - Correct action rules (auto_resolve_on with payment_receipt, pod_proof_of_delivery)
 * - Fixed action completion statuses
 * - Proper stage-based validation
 *
 * Run: caffeinate -i npx tsx scripts/backfill/backfill-all-ai-summaries.ts
 *
 * Options:
 *   --dry-run    : Count shipments without processing
 *   --limit=N    : Process only N shipments
 *   --parallel=N : Process N shipments concurrently (default: 3)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { HaikuSummaryService } from '@/lib/chronicle-v2';

// Configuration
const PARALLEL_CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--parallel='))?.split('=')[1] || '3');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const MIN_CHRONICLES = 3; // Minimum chronicles for meaningful summary

// Initialize clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ShipmentInfo {
  shipment_id: string;
  booking_number: string | null;
  stage: string | null;
  chronicle_count: number;
}

interface ProcessResult {
  shipmentId: string;
  bookingNumber: string | null;
  stage: string | null;
  success: boolean;
  cost: number;
  error?: string;
}

/**
 * Get all shipments eligible for AI summary generation
 */
async function getEligibleShipments(): Promise<ShipmentInfo[]> {
  // Use RPC function to get shipments with chronicle counts
  const { data, error } = await supabase.rpc('get_shipments_for_ai_summary', {
    limit_count: 2000  // Get all eligible shipments
  });

  if (error) {
    console.error('Error fetching shipments:', error.message);
    throw error;
  }

  // Filter to those with minimum chronicles
  const eligible = (data || []).filter((s: any) => s.chronicle_count >= MIN_CHRONICLES);

  return eligible.map((s: any) => ({
    shipment_id: s.shipment_id,
    booking_number: s.booking_number,
    stage: s.stage,
    chronicle_count: s.chronicle_count,
  }));
}

/**
 * Process a single shipment
 */
async function processShipment(
  summaryService: HaikuSummaryService,
  shipment: ShipmentInfo
): Promise<ProcessResult> {
  try {
    const result = await summaryService.processShipment(shipment.shipment_id);

    if (!result) {
      return {
        shipmentId: shipment.shipment_id,
        bookingNumber: shipment.booking_number,
        stage: shipment.stage,
        success: false,
        cost: 0,
        error: 'processShipment returned null',
      };
    }

    return {
      shipmentId: shipment.shipment_id,
      bookingNumber: shipment.booking_number,
      stage: shipment.stage,
      success: true,
      cost: result.cost,
    };
  } catch (error) {
    return {
      shipmentId: shipment.shipment_id,
      bookingNumber: shipment.booking_number,
      stage: shipment.stage,
      success: false,
      cost: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process shipments in parallel batches
 */
async function processBatch(
  summaryService: HaikuSummaryService,
  shipments: ShipmentInfo[],
  onProgress: (result: ProcessResult, index: number, total: number) => void
): Promise<{ success: number; failed: number; totalCost: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  let totalCost = 0;
  const errors: string[] = [];
  let processed = 0;

  // Process in parallel chunks
  for (let i = 0; i < shipments.length; i += PARALLEL_CONCURRENCY) {
    const chunk = shipments.slice(i, i + PARALLEL_CONCURRENCY);

    const results = await Promise.all(
      chunk.map(shipment => processShipment(summaryService, shipment))
    );

    for (const result of results) {
      processed++;
      onProgress(result, processed, shipments.length);

      if (result.success) {
        success++;
        totalCost += result.cost;
      } else {
        failed++;
        if (result.error) {
          errors.push(`${result.bookingNumber || result.shipmentId.slice(0, 8)}: ${result.error}`);
        }
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + PARALLEL_CONCURRENCY < shipments.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return { success, failed, totalCost, errors };
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              AI SUMMARY BACKFILL - Complete Regeneration                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Configuration:');
  console.log(`  - Parallel concurrency: ${PARALLEL_CONCURRENCY}`);
  console.log(`  - Minimum chronicles: ${MIN_CHRONICLES}`);
  console.log(`  - Dry run: ${DRY_RUN}`);
  console.log(`  - Limit: ${LIMIT || 'None (all)'}`);
  console.log('');

  // Get eligible shipments
  console.log('Fetching eligible shipments...');
  const allShipments = await getEligibleShipments();

  // Apply limit if specified
  const shipments = LIMIT > 0 ? allShipments.slice(0, LIMIT) : allShipments;

  console.log(`Found ${allShipments.length} shipments with ${MIN_CHRONICLES}+ chronicles`);
  if (LIMIT > 0) {
    console.log(`Processing limited to ${shipments.length} shipments`);
  }
  console.log('');

  // Show stage distribution
  const byStage: Record<string, number> = {};
  for (const s of shipments) {
    const stage = s.stage || 'UNKNOWN';
    byStage[stage] = (byStage[stage] || 0) + 1;
  }
  console.log('Stage Distribution:');
  for (const [stage, count] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stage.padEnd(12)}: ${count}`);
  }
  console.log('');

  // Estimate cost
  const estimatedCost = shipments.length * 0.00076; // ~$0.00076 per summary
  console.log(`Estimated cost: $${estimatedCost.toFixed(2)}`);
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN - No changes made');
    return;
  }

  // Initialize service
  const summaryService = new HaikuSummaryService(supabase);

  // Process with progress tracking
  console.log('Starting processing...');
  console.log('────────────────────────────────────────────────────────────────────────────────────────────────────────────────');

  let lastProgressPrint = 0;
  const progressInterval = 10; // Print progress every N shipments

  const { success, failed, totalCost, errors } = await processBatch(
    summaryService,
    shipments,
    (result, index, total) => {
      // Print individual result
      const status = result.success ? '✅' : '❌';
      const booking = (result.bookingNumber || 'N/A').padEnd(15);
      const stage = (result.stage || 'N/A').padEnd(12);
      const costStr = result.success ? `$${result.cost.toFixed(4)}` : result.error?.slice(0, 40);

      if (result.success) {
        // Only print successes occasionally to reduce noise
        if (index % progressInterval === 0 || index === total) {
          console.log(`[${index}/${total}] ${status} ${booking} | ${stage} | ${costStr}`);
        }
      } else {
        // Always print failures
        console.log(`[${index}/${total}] ${status} ${booking} | ${stage} | ${costStr}`);
      }

      // Print progress summary
      if (index - lastProgressPrint >= progressInterval || index === total) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (index / parseFloat(elapsed)).toFixed(1);
        const eta = ((total - index) / parseFloat(rate)).toFixed(0);
        console.log(`    ⏱️  Progress: ${index}/${total} (${(index/total*100).toFixed(1)}%) | Elapsed: ${elapsed}s | Rate: ${rate}/s | ETA: ${eta}s`);
        lastProgressPrint = index;
      }
    }
  );

  // Final summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgTime = (parseFloat(totalTime) / shipments.length).toFixed(2);

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  BACKFILL COMPLETE');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  ✅ Success: ${success}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  📊 Success Rate: ${((success / shipments.length) * 100).toFixed(1)}%`);
  console.log('');
  console.log(`  💰 Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`  ⏱️  Total Time: ${totalTime}s`);
  console.log(`  📈 Avg Time/Shipment: ${avgTime}s`);
  console.log('');

  if (errors.length > 0) {
    console.log('  Errors (first 10):');
    for (const err of errors.slice(0, 10)) {
      console.log(`    - ${err}`);
    }
    console.log('');
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
