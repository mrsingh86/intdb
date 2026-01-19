/**
 * Deep investigation into specific shipments with high delays
 * Run: npx tsx scripts/debugging/investigate-specific-delays.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function investigateShipment(shipmentId: string) {
  console.log('\n' + '='.repeat(60));

  // Get shipment
  const { data: ship } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  if (!ship) {
    console.log('Shipment not found:', shipmentId);
    return;
  }

  console.log('SHIPMENT:', ship.intoglo_reference || shipmentId.slice(0, 8));
  console.log('='.repeat(60));

  console.log('\n--- SHIPMENT DATA ---');
  console.log('Stage:', ship.stage);
  console.log('Status:', ship.status);
  console.log('ETD:', ship.etd);
  console.log('ETA:', ship.eta);
  console.log('Actual Departure:', ship.actual_departure);
  console.log('Actual Arrival:', ship.actual_arrival);
  console.log('Created:', ship.created_at);
  console.log('Updated:', ship.updated_at);

  // Get AI summary
  const { data: summary } = await supabase
    .from('shipment_ai_summaries')
    .select('*')
    .eq('shipment_id', shipmentId)
    .single();

  if (summary) {
    console.log('\n--- AI SUMMARY ---');
    console.log('Blocker:', summary.current_blocker);
    console.log('Blocker Owner:', summary.blocker_owner);
    console.log('Days Overdue:', summary.days_overdue);
    console.log('Risk Level:', summary.risk_level);
    console.log('Summary Updated:', summary.updated_at);
    if (summary.narrative) {
      console.log('Narrative:', summary.narrative.slice(0, 100) + '...');
    }
  }

  // Get chronicle history
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('occurred_at, direction, from_party, document_type, ai_summary')
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false })
    .limit(10);

  if (chronicles && chronicles.length > 0) {
    console.log('\n--- CHRONICLE HISTORY (Last 10) ---');
    for (const c of chronicles) {
      const date = new Date(c.occurred_at).toLocaleDateString();
      const dir = (c.direction || 'unknown').toUpperCase().padEnd(8);
      const party = (c.from_party || 'unknown').padEnd(15);
      console.log(`[${date}] ${dir} | ${party} | ${c.document_type}`);
      if (c.ai_summary) {
        console.log('         -> ' + c.ai_summary.slice(0, 70) + '...');
      }
    }

    // Check for completion indicators
    const allSummaries = chronicles.map(c => (c.ai_summary || '').toLowerCase()).join(' ');
    const completionSignals = ['delivered', 'completed', 'cleared', 'released', 'paid', 'resolved'];
    const foundSignals = completionSignals.filter(s => allSummaries.includes(s));

    if (foundSignals.length > 0) {
      console.log('\n⚠️ COMPLETION SIGNALS DETECTED:', foundSignals.join(', '));
      console.log('   Blocker may be STALE!');
    }
  }

  // Date analysis
  console.log('\n--- DATE ANALYSIS ---');
  const now = new Date();
  if (ship.eta) {
    const eta = new Date(ship.eta);
    const daysFromEta = Math.floor((now.getTime() - eta.getTime()) / (1000*60*60*24));
    const isFuture = eta > now;
    console.log('Days since ETA:', daysFromEta, isFuture ? '⚠️ (ETA is in FUTURE!)' : '');
  }
  if (ship.etd) {
    const etd = new Date(ship.etd);
    const daysFromEtd = Math.floor((now.getTime() - etd.getTime()) / (1000*60*60*24));
    const isFuture = etd > now;
    console.log('Days since ETD:', daysFromEtd, isFuture ? '⚠️ (ETD is in FUTURE!)' : '');
  }
  if (chronicles && chronicles.length > 0) {
    const lastChronicle = new Date(chronicles[0].occurred_at);
    const daysFromLastActivity = Math.floor((now.getTime() - lastChronicle.getTime()) / (1000*60*60*24));
    console.log('Days since last activity:', daysFromLastActivity);
  }

  // Assessment
  console.log('\n--- ASSESSMENT ---');
  if (summary) {
    // Check if delay makes sense
    const refDate = ship.eta ? new Date(ship.eta) : (ship.etd ? new Date(ship.etd) : null);
    if (refDate && refDate > now) {
      console.log('❌ DATA QUALITY ISSUE: days_overdue is set but ETA/ETD is in the future');
    } else if (refDate) {
      const calculatedDelay = Math.floor((now.getTime() - refDate.getTime()) / (1000*60*60*24));
      console.log(`✅ Delay appears mathematically correct (calculated: ${calculatedDelay} days)`);
    }

    // Check stage vs blocker
    if (ship.stage === 'COMPLETED' || ship.stage === 'DELIVERED') {
      console.log('❌ STALE BLOCKER: Stage is', ship.stage, 'but blocker still exists');
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('DEEP DIVE: SHIPMENT DELAY INVESTIGATION');
  console.log('========================================');

  // Get shipments with high delays that have blockers
  const { data: summaries } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, days_overdue, current_blocker')
    .gt('days_overdue', 30)
    .not('current_blocker', 'is', null)
    .order('days_overdue', { ascending: false })
    .limit(5);

  if (!summaries || summaries.length === 0) {
    console.log('No high-delay shipments found');
    return;
  }

  console.log(`\nInvestigating ${summaries.length} shipments with 30+ days overdue...\n`);

  for (const s of summaries) {
    await investigateShipment(s.shipment_id);
  }

  // Summary of findings
  console.log('\n\n========================================');
  console.log('SUMMARY OF FINDINGS');
  console.log('========================================');

  // Count by issue type
  const { data: allHighDelay } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, days_overdue')
    .gt('days_overdue', 30);

  let futureEtaCount = 0;
  let completedStageCount = 0;
  let legitimateDelayCount = 0;

  if (allHighDelay) {
    for (const summary of allHighDelay) {
      const { data: ship } = await supabase
        .from('shipments')
        .select('eta, etd, stage')
        .eq('id', summary.shipment_id)
        .single();

      if (ship) {
        const now = new Date();
        const eta = ship.eta ? new Date(ship.eta) : null;
        const etd = ship.etd ? new Date(ship.etd) : null;

        if ((eta && eta > now) || (etd && etd > now)) {
          futureEtaCount++;
        } else if (ship.stage === 'COMPLETED' || ship.stage === 'DELIVERED') {
          completedStageCount++;
        } else {
          legitimateDelayCount++;
        }
      }
    }
  }

  console.log(`\nTotal high-delay shipments (30+ days): ${allHighDelay?.length || 0}`);
  console.log(`  - Future ETA/ETD (data issue): ${futureEtaCount}`);
  console.log(`  - Completed stage (stale blocker): ${completedStageCount}`);
  console.log(`  - Legitimate delays: ${legitimateDelayCount}`);

  console.log('\n✅ Investigation complete!');
}

main().catch(console.error);
