#!/usr/bin/env npx tsx
/**
 * Test Insight Engine
 *
 * Validates that the Insight Engine is working correctly
 * by generating insights for a sample shipment.
 *
 * Usage:
 *   npx tsx scripts/test-insight-engine.ts           # Rules only
 *   npx tsx scripts/test-insight-engine.ts --ai      # Rules + AI
 */

import { createClient } from '@supabase/supabase-js';
import { createInsightEngine } from '../lib/services/insight-engine';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function testInsightEngine() {
  const useAI = process.argv.includes('--ai');
  const anthropicApiKey = useAI ? process.env.ANTHROPIC_API_KEY : undefined;

  console.log('');
  console.log('═'.repeat(70));
  console.log('  INSIGHT ENGINE TEST');
  console.log(`  Mode: ${useAI && anthropicApiKey ? 'Rules + AI' : 'Rules Only'}`);
  console.log('═'.repeat(70));
  console.log('');

  // Create engine (with optional AI)
  const engine = createInsightEngine(supabase, anthropicApiKey);

  // Get a sample shipment
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, si_cutoff, status')
    .not('etd', 'is', null)
    .limit(5);

  if (!shipments || shipments.length === 0) {
    console.log('No shipments found to test');
    return;
  }

  console.log('Found shipments to test:', shipments.length);
  console.log('');

  // Test each shipment
  for (const shipment of shipments) {
    console.log('─'.repeat(70));
    console.log(`Testing: ${shipment.booking_number || 'N/A'}`);
    console.log(`  Status: ${shipment.status}`);
    console.log(`  ETD: ${shipment.etd}`);
    console.log(`  SI Cutoff: ${shipment.si_cutoff || 'N/A'}`);
    console.log('');

    try {
      const startTime = Date.now();
      const result = await engine.generateInsights(shipment.id);
      const elapsed = Date.now() - startTime;

      console.log(`  ✅ Generated ${result.insights.length} insights in ${elapsed}ms`);
      console.log(`  Priority Boost: +${result.priority_boost}`);
      console.log('');

      if (result.insights.length > 0) {
        console.log('  INSIGHTS:');
        for (const insight of result.insights) {
          const severityEmoji = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '🟢',
          }[insight.severity];
          console.log(
            `    ${severityEmoji} [${insight.severity.toUpperCase()}] ${insight.title}`
          );
          console.log(`       ${insight.description.substring(0, 80)}...`);
        }
        console.log('');

        console.log('  BOOST REASONS:');
        for (const reason of result.priority_boost_reasons) {
          console.log(`    • ${reason}`);
        }
      } else {
        console.log('  No patterns detected for this shipment');
      }

      console.log('');
      console.log(`  Stats: ${result.generation_stats.rules_checked} rules checked, ${result.generation_stats.rules_matched} matched`);
      if (result.generation_stats.ai_ran) {
        console.log(`  AI: ${result.generation_stats.ai_insights} AI insights generated`);
      }
      console.log(`  Context: ${result.context_summary.days_to_etd} days to ETD, ${result.context_summary.days_to_nearest_cutoff} days to nearest cutoff`);

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }

    console.log('');
  }

  console.log('═'.repeat(70));
  console.log('  TEST COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
}

testInsightEngine().catch(console.error);
