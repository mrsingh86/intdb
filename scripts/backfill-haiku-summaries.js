#!/usr/bin/env node
/**
 * Backfill script to regenerate AI summaries with enhanced prompt.
 *
 * Enhancements:
 * - Anti-template rules for shipment-specific summaries
 * - Chronicle intelligence signals (sentiment, amendments, escalations)
 * - Profile data (preferred carriers, common issues, performance factors)
 * - Predictive elements (predicted risks, proactive recommendations, ETA confidence)
 *
 * Usage: node scripts/backfill-haiku-summaries.js [--limit=N]
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  // Parse --limit argument
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  console.log('='.repeat(60));
  console.log('BACKFILL HAIKU SUMMARIES');
  console.log(`Regenerating up to ${limit} shipment summaries with enhanced prompt`);
  console.log('='.repeat(60));

  // Import the HaikuSummaryService
  const { HaikuSummaryService } = require('../lib/chronicle-v2/services/haiku-summary-service.ts');
  const service = new HaikuSummaryService(supabase);

  // Get shipments that have chronicle data (most recent first)
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, stage')
    .not('stage', 'eq', 'CANCELLED')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching shipments:', error);
    process.exit(1);
  }

  console.log(`\nFound ${shipments.length} shipments to process\n`);

  let processed = 0;
  let errors = 0;
  let totalCost = 0;

  for (const shipment of shipments) {
    try {
      console.log(`[${processed + 1}/${shipments.length}] Processing ${shipment.booking_number || shipment.id.slice(0, 8)} (${shipment.stage || 'PENDING'})...`);

      const result = await service.processShipment(shipment.id);

      if (result) {
        totalCost += result.cost;
        console.log(`  -> Summary generated (${result.chronicleCount} chronicles, $${result.cost.toFixed(4)})`);

        // Show a snippet of the narrative
        const narrative = result.summary.narrative || result.summary.story;
        if (narrative) {
          console.log(`  -> "${narrative.slice(0, 100)}${narrative.length > 100 ? '...' : ''}"`);
        }

        // Show predictive elements if present
        if (result.summary.predictedRisks && result.summary.predictedRisks.length > 0) {
          console.log(`  -> Predicted Risks: ${result.summary.predictedRisks.join(', ')}`);
        }
        if (result.summary.proactiveRecommendations && result.summary.proactiveRecommendations.length > 0) {
          console.log(`  -> Recommendations: ${result.summary.proactiveRecommendations.join(', ')}`);
        }
      } else {
        console.log(`  -> No chronicle data, skipped`);
      }

      processed++;
    } catch (err) {
      console.error(`  -> ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total Cost: $${totalCost.toFixed(4)}`);
}

main().catch(console.error);
