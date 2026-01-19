/**
 * Run AI Summaries V2 - Using HaikuSummaryService
 *
 * Uses the proper tiered data strategy and existing service.
 * Adds Zod validation for AI output.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { HaikuSummaryService } from '../lib/chronicle-v2/services/haiku-summary-service.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const MAX_SHIPMENTS = 20;

async function main() {
  console.log('═'.repeat(70));
  console.log('GENERATING AI SUMMARIES V2 (Using HaikuSummaryService)');
  console.log('═'.repeat(70));

  const service = new HaikuSummaryService(supabase);

  // Get shipments needing summaries (prioritized by ETD)
  const shipmentIds = await service.getShipmentsNeedingSummary(MAX_SHIPMENTS);

  console.log(`\nFound ${shipmentIds.length} shipments to process\n`);

  if (shipmentIds.length === 0) {
    console.log('No shipments need processing.');
    return;
  }

  // Process with progress callback
  const result = await service.processShipments(shipmentIds, (processed, total) => {
    // Progress indicator
  });

  console.log('\n' + '═'.repeat(70));
  console.log(`DONE! Processed: ${result.processed}, Failed: ${result.failed}, Cost: $${result.totalCost.toFixed(4)}`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
