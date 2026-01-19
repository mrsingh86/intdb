/**
 * Test script for categorized delay calculations
 * Run: npx tsx scripts/debugging/test-delay-categories.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('========================================');
  console.log('DELAY CATEGORIES TEST');
  console.log('========================================\n');

  // Test 1: Query the view directly
  console.log('--- TEST 1: Raw View Query ---\n');

  const { data: viewData, error: viewError } = await supabase
    .from('v_shipment_delay_breakdown')
    .select('*')
    .limit(5);

  if (viewError) {
    console.log('ERROR:', viewError.message);
    return;
  }

  console.log(`Found ${viewData?.length || 0} rows in v_shipment_delay_breakdown\n`);

  // Test 2: Show examples by delay category
  console.log('--- TEST 2: Examples by Delay Category ---\n');

  const categories = ['PRE_DEPARTURE', 'DEPARTURE', 'TRANSIT', 'DELIVERY'];

  for (const cat of categories) {
    console.log(`\n📦 ${cat} Category:`);
    console.log('-'.repeat(60));

    const { data: catData } = await supabase
      .from('v_shipment_delay_breakdown')
      .select('*')
      .eq('delay_category', cat)
      .gt('primary_delay_days', 0)
      .order('primary_delay_days', { ascending: false })
      .limit(2);

    if (!catData || catData.length === 0) {
      console.log('  No delayed shipments in this category');
      continue;
    }

    for (const d of catData) {
      console.log(`\n  Shipment: ${d.intoglo_reference || d.shipment_id.slice(0, 8)}`);
      console.log(`  Stage: ${d.stage}`);
      console.log(`  Primary Delay: ${d.primary_delay_type} - ${d.primary_delay_days} days`);
      console.log(`  Summary: ${d.delay_summary}`);

      if (cat === 'PRE_DEPARTURE') {
        console.log(`  Cutoffs:`);
        if (d.si_cutoff) console.log(`    SI: ${d.si_cutoff} [${d.si_status}] ${d.si_delay_days > 0 ? `(${d.si_delay_days}d late)` : ''}`);
        if (d.vgm_cutoff) console.log(`    VGM: ${d.vgm_cutoff} [${d.vgm_status}] ${d.vgm_delay_days > 0 ? `(${d.vgm_delay_days}d late)` : ''}`);
        if (d.cargo_cutoff) console.log(`    Cargo: ${d.cargo_cutoff} [${d.cargo_status}] ${d.cargo_delay_days > 0 ? `(${d.cargo_delay_days}d late)` : ''}`);
      }

      if (cat === 'DEPARTURE') {
        console.log(`  ETD: ${d.etd || 'N/A'} (source: ${d.etd_source || 'N/A'})`);
        console.log(`  Departure Delay: ${d.departure_delay_days} days`);
      }

      if (cat === 'TRANSIT' || cat === 'DELIVERY') {
        console.log(`  ETA: ${d.eta || 'N/A'} (source: ${d.eta_source || 'N/A'})`);
        if (d.last_free_day) console.log(`  Last Free Day: ${d.last_free_day}`);
        console.log(`  ${cat === 'TRANSIT' ? 'Arrival' : 'Delivery'} Delay: ${cat === 'TRANSIT' ? d.arrival_delay_days : d.delivery_delay_days} days`);
      }
    }
  }

  // Test 3: Test via ShipmentIntelligenceService
  console.log('\n\n--- TEST 3: Via ShipmentIntelligenceService ---\n');

  const { ShipmentIntelligenceService } = await import('../../lib/chronicle-v2/services/shipment-intelligence-service');
  const service = new ShipmentIntelligenceService(supabase);

  // Get a shipment with delay
  const { data: testShipment } = await supabase
    .from('v_shipment_delay_breakdown')
    .select('shipment_id')
    .gt('primary_delay_days', 0)
    .limit(1)
    .single();

  if (testShipment) {
    console.log(`Testing getDelayBreakdown for shipment ${testShipment.shipment_id.slice(0, 8)}...\n`);

    const delayBreakdown = await service.getDelayBreakdown(testShipment.shipment_id);

    if (delayBreakdown) {
      console.log('✅ DelayBreakdown returned:');
      console.log(JSON.stringify(delayBreakdown, null, 2));
    } else {
      console.log('❌ No delay breakdown returned');
    }
  }

  // Test 4: Full intelligence with delay breakdown
  console.log('\n\n--- TEST 4: Full Intelligence with Delay Breakdown ---\n');

  if (testShipment) {
    const intel = await service.getIntelligence(testShipment.shipment_id);

    if (intel) {
      console.log('✅ Full Intelligence:');
      console.log(`  Shipment: ${intel.intogloReference || intel.shipmentId.slice(0, 8)}`);
      console.log(`  Stage: ${intel.stage}`);
      console.log(`  SLA Status: ${intel.sla.slaStatus}`);
      console.log(`  Escalation: ${intel.escalation.escalationLevel}`);

      if (intel.delayBreakdown) {
        console.log(`\n  📅 Delay Breakdown:`);
        console.log(`     Category: ${intel.delayBreakdown.delayCategory}`);
        console.log(`     Primary Type: ${intel.delayBreakdown.primaryDelayType}`);
        console.log(`     Primary Days: ${intel.delayBreakdown.primaryDelayDays}`);
        console.log(`     Summary: ${intel.delayBreakdown.delaySummary}`);
      }
    }
  }

  // Test 5: Distribution statistics
  console.log('\n\n--- TEST 5: Distribution Statistics ---\n');

  const { data: stats } = await supabase
    .from('v_shipment_delay_breakdown')
    .select('delay_category, primary_delay_type');

  if (stats) {
    // By category
    const catCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};

    for (const s of stats) {
      catCounts[s.delay_category] = (catCounts[s.delay_category] || 0) + 1;
      typeCounts[s.primary_delay_type] = (typeCounts[s.primary_delay_type] || 0) + 1;
    }

    console.log('By Category:');
    for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat}: ${count}`);
    }

    console.log('\nBy Delay Type:');
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  console.log('\n\n✅ Test completed!');
}

main().catch(console.error);
