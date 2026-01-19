/**
 * Test script for Enhanced HaikuSummaryService with P0-P3 Anti-Hallucination
 * Run: npx tsx scripts/debugging/test-enhanced-haiku-summary.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function findTestShipment(): Promise<string | null> {
  // Find a shipment with chronicle data and some activity
  const { data, error } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .not('shipment_id', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    console.error('No shipments with chronicle data found');
    return null;
  }

  return data[0].shipment_id;
}

async function testIntelligenceView(shipmentId: string) {
  console.log('\n========================================');
  console.log('1. TESTING v_shipment_intelligence VIEW');
  console.log('========================================\n');

  const { data: intel, error } = await supabase
    .from('v_shipment_intelligence')
    .select('*')
    .eq('shipment_id', shipmentId)
    .single();

  if (error) {
    console.log('❌ View query failed:', error.message);
    return null;
  }

  if (!intel) {
    console.log('⚠️ No intelligence data found for shipment');
    return null;
  }

  console.log('✅ Intelligence data loaded:');
  console.log('   Shipment ID:', intel.shipment_id);
  console.log('   Reference:', intel.intoglo_reference);
  console.log('   Stage:', intel.stage);
  console.log('   Shipper:', intel.shipper_name);
  console.log('   Carrier:', intel.carrier_name);
  console.log('\n--- SLA Status ---');
  console.log('   SLA Status:', intel.sla_status);
  console.log('   Hours Since Customer Update:', intel.hours_since_customer_update);
  console.log('   Hours Awaiting Response:', intel.hours_awaiting_response);
  console.log('   Response Pending:', intel.response_pending);
  console.log('   Unanswered Customer Emails:', intel.unanswered_customer_emails);
  console.log('\n--- Escalation ---');
  console.log('   Escalation Level:', intel.escalation_level);
  console.log('   Escalate To:', intel.escalate_to);
  console.log('   Escalation Reason:', intel.escalation_reason);
  console.log('   Days Overdue:', intel.days_overdue);
  console.log('   Estimated Exposure USD:', intel.estimated_exposure_usd);
  console.log('   Priority Score:', intel.priority_score);
  console.log('\n--- Blocker Info ---');
  console.log('   Current Blocker:', intel.current_blocker);
  console.log('   Blocker Owner:', intel.blocker_owner);
  console.log('   Risk Level:', intel.risk_level);

  return intel;
}

async function testRootCauseMatching(blockerText: string | null) {
  console.log('\n========================================');
  console.log('2. TESTING ROOT CAUSE MATCHING');
  console.log('========================================\n');

  if (!blockerText) {
    console.log('⚠️ No blocker text to match');
    return null;
  }

  console.log('Blocker text:', blockerText);

  const { data, error } = await supabase
    .rpc('match_root_cause', { blocker_text: blockerText });

  if (error) {
    console.log('❌ Root cause matching failed:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No root cause pattern matched');
    return null;
  }

  const match = data[0];
  console.log('✅ Root cause matched:');
  console.log('   Category:', match.category);
  console.log('   Subcategory:', match.subcategory);
  console.log('   Typical Resolution:', match.typical_resolution_days, 'days');
  console.log('   Resolution Owner:', match.resolution_owner);
  console.log('   Requires Customer Action:', match.requires_customer_action);
  console.log('   Match Confidence:', match.match_confidence);

  return match;
}

async function testBenchmarks() {
  console.log('\n========================================');
  console.log('3. TESTING RESOLUTION BENCHMARKS');
  console.log('========================================\n');

  const { data, error } = await supabase
    .from('v_resolution_benchmarks')
    .select('*')
    .gte('sample_count', 5)
    .order('sample_count', { ascending: false })
    .limit(5);

  if (error) {
    console.log('❌ Benchmarks query failed:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No benchmarks available');
    return;
  }

  console.log('✅ Top benchmarks:');
  for (const b of data) {
    console.log(`   ${b.benchmark_type}:${b.category} - ${b.avg_resolution_days} days avg (${b.sample_count} cases)`);
  }
}

async function testFullHaikuService(shipmentId: string) {
  console.log('\n========================================');
  console.log('4. TESTING FULL HAIKU SERVICE');
  console.log('========================================\n');

  // Dynamically import to avoid module resolution issues
  const { HaikuSummaryService } = await import('../../lib/chronicle-v2/services/haiku-summary-service');

  const service = new HaikuSummaryService(supabase);

  console.log('Processing shipment:', shipmentId);
  console.log('This will call Anthropic API...\n');

  try {
    const result = await service.processShipment(shipmentId);

    if (!result) {
      console.log('❌ No result returned');
      return;
    }

    console.log('✅ Summary generated successfully!');
    console.log('\n--- V2 Format ---');
    console.log('   Narrative:', result.summary.narrative);
    console.log('   Owner:', result.summary.owner);
    console.log('   Key Deadline:', result.summary.keyDeadline);
    console.log('   Key Insight:', result.summary.keyInsight);

    console.log('\n--- P0: SLA Status (Pre-computed) ---');
    console.log('   SLA Status:', result.summary.slaStatus);
    console.log('   Hours Since Customer Update:', result.summary.hoursSinceCustomerUpdate);
    console.log('   SLA Summary:', result.summary.slaSummary);

    console.log('\n--- P1: Escalation (Pre-computed) ---');
    console.log('   Escalation Level:', result.summary.escalationLevel);
    console.log('   Escalate To:', result.summary.escalateTo);

    console.log('\n--- P2: Root Cause (Pre-computed) ---');
    console.log('   Category:', result.summary.rootCauseCategory);
    console.log('   Subcategory:', result.summary.rootCauseSubcategory);
    console.log('   Typical Resolution:', result.summary.typicalResolutionDays, 'days');
    console.log('   Benchmark Reference:', result.summary.benchmarkReference);

    console.log('\n--- P0: Customer Draft (AI-generated) ---');
    console.log('   Subject:', result.summary.customerDraftSubject);
    console.log('   Body:', result.summary.customerDraftBody?.substring(0, 200) + '...');

    console.log('\n--- P3: Confidence ---');
    console.log('   Recommendation Confidence:', result.summary.recommendationConfidence);
    console.log('   Confidence Reason:', result.summary.confidenceReason);

    console.log('\n--- Metadata ---');
    console.log('   Input Tokens:', result.inputTokens);
    console.log('   Output Tokens:', result.outputTokens);
    console.log('   Cost: $' + result.cost.toFixed(4));
    console.log('   Chronicle Count:', result.chronicleCount);

  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
}

async function main() {
  console.log('========================================');
  console.log('ENHANCED HAIKU SUMMARY SERVICE TEST');
  console.log('P0-P3 Anti-Hallucination Architecture');
  console.log('========================================');

  // Find a test shipment
  const shipmentId = await findTestShipment();
  if (!shipmentId) {
    console.log('❌ Could not find a test shipment');
    return;
  }

  console.log('\nUsing shipment:', shipmentId);

  // Test each component
  const intel = await testIntelligenceView(shipmentId);
  await testRootCauseMatching(intel?.current_blocker);
  await testBenchmarks();

  // Ask before calling AI (costs money)
  console.log('\n========================================');
  console.log('Ready to test full Haiku service.');
  console.log('This will call Anthropic API (costs ~$0.001)');
  console.log('========================================\n');

  await testFullHaikuService(shipmentId);

  console.log('\n✅ Test completed!');
}

main().catch(console.error);
