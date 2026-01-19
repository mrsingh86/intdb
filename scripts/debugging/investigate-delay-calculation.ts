/**
 * Investigate how delays are calculated and show examples at departure stages
 * Run: npx tsx scripts/debugging/investigate-delay-calculation.ts
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
  console.log('DELAY CALCULATION INVESTIGATION');
  console.log('========================================\n');

  // 1. Check how days_overdue relates to ETD vs ETA
  console.log('--- SAMPLE: Comparing days_overdue with ETD/ETA ---\n');

  const { data: samples } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, days_overdue')
    .not('days_overdue', 'is', null)
    .order('days_overdue', { ascending: false })
    .limit(10);

  if (samples) {
    console.log('Shipment ID              | Days Overdue | ETD           | ETA           | Stage      | Calc from ETD | Calc from ETA');
    console.log('-'.repeat(120));

    for (const s of samples) {
      const { data: ship } = await supabase
        .from('shipments')
        .select('etd, eta, stage')
        .eq('id', s.shipment_id)
        .single();

      if (ship) {
        const now = new Date();
        const etd = ship.etd ? new Date(ship.etd) : null;
        const eta = ship.eta ? new Date(ship.eta) : null;

        const daysFromEtd = etd ? Math.floor((now.getTime() - etd.getTime()) / (1000*60*60*24)) : null;
        const daysFromEta = eta ? Math.floor((now.getTime() - eta.getTime()) / (1000*60*60*24)) : null;

        console.log(
          `${s.shipment_id.slice(0, 24)} | ${String(s.days_overdue).padStart(12)} | ${(ship.etd || 'N/A').toString().slice(0, 13).padEnd(13)} | ${(ship.eta || 'N/A').toString().slice(0, 13).padEnd(13)} | ${(ship.stage || 'N/A').padEnd(10)} | ${String(daysFromEtd ?? 'N/A').padStart(13)} | ${String(daysFromEta ?? 'N/A').padStart(13)}`
        );
      }
    }
  }

  // 2. Show stage distribution
  console.log('\n\n--- STAGE DISTRIBUTION FOR ESCALATED SHIPMENTS ---\n');

  const { data: stageData } = await supabase
    .from('v_shipment_intelligence')
    .select('stage, escalation_level');

  if (stageData) {
    const stageCounts: Record<string, Record<string, number>> = {};
    for (const s of stageData) {
      const stage = s.stage || 'NULL';
      const level = s.escalation_level || 'NULL';
      if (!stageCounts[stage]) stageCounts[stage] = { L1: 0, L2: 0, L3: 0 };
      stageCounts[stage][level] = (stageCounts[stage][level] || 0) + 1;
    }

    console.log('Stage                | L1    | L2    | L3    | Total');
    console.log('-'.repeat(60));
    for (const [stage, counts] of Object.entries(stageCounts).sort()) {
      const total = (counts.L1 || 0) + (counts.L2 || 0) + (counts.L3 || 0);
      console.log(`${stage.padEnd(20)} | ${String(counts.L1 || 0).padStart(5)} | ${String(counts.L2 || 0).padStart(5)} | ${String(counts.L3 || 0).padStart(5)} | ${String(total).padStart(5)}`);
    }
  }

  // 3. Examples at DEPARTURE stages (PENDING, BOOKED, SI_SUBMITTED, BL_ISSUED)
  const departureStages = ['PENDING', 'BOOKED', 'SI_SUBMITTED', 'BL_ISSUED'];

  console.log('\n\n========================================');
  console.log('EXAMPLES AT DEPARTURE STAGES');
  console.log('========================================');

  for (const level of ['L1', 'L2', 'L3']) {
    console.log(`\n--- ${level} at Departure Stages ---\n`);

    const { data: examples } = await supabase
      .from('v_shipment_intelligence')
      .select('*')
      .eq('escalation_level', level)
      .in('stage', departureStages)
      .order('priority_score', { ascending: false })
      .limit(2);

    if (!examples || examples.length === 0) {
      console.log(`  No ${level} examples at departure stages`);
      continue;
    }

    for (const ex of examples) {
      // Get shipment dates
      const { data: ship } = await supabase
        .from('shipments')
        .select('etd, eta, actual_departure')
        .eq('id', ex.shipment_id)
        .single();

      console.log(`📦 ${ex.intoglo_reference || ex.shipment_id.slice(0, 8)}`);
      console.log(`   Stage: ${ex.stage}`);
      console.log(`   Shipper: ${ex.shipper_name || 'N/A'}`);
      console.log(`   Carrier: ${ex.carrier_name || 'N/A'}`);
      if (ship) {
        console.log(`   ETD: ${ship.etd || 'N/A'}`);
        console.log(`   ETA: ${ship.eta || 'N/A'}`);
        console.log(`   Actual Departure: ${ship.actual_departure || 'N/A'}`);
      }
      console.log(`   Days Overdue: ${ex.days_overdue ?? 'N/A'}`);
      console.log(`   Estimated Exposure: $${(ex.estimated_exposure_usd || 0).toLocaleString()}`);
      console.log(`   SLA Status: ${ex.sla_status}`);
      console.log(`   Escalation Reason: ${ex.escalation_reason}`);
      console.log(`   Blocker: ${ex.current_blocker || 'None'}`);
      console.log(`   Priority Score: ${ex.priority_score}`);
      console.log('');
    }
  }

  // 4. Summary of delay calculation logic
  console.log('\n========================================');
  console.log('DELAY CALCULATION ANALYSIS');
  console.log('========================================\n');

  // Check what the AI summary service uses
  const { data: withEta } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, days_overdue')
    .not('days_overdue', 'is', null)
    .limit(20);

  let matchesEtd = 0;
  let matchesEta = 0;
  let matchesNeither = 0;

  if (withEta) {
    for (const s of withEta) {
      const { data: ship } = await supabase
        .from('shipments')
        .select('etd, eta')
        .eq('id', s.shipment_id)
        .single();

      if (ship) {
        const now = new Date();
        const etd = ship.etd ? new Date(ship.etd) : null;
        const eta = ship.eta ? new Date(ship.eta) : null;

        const daysFromEtd = etd ? Math.floor((now.getTime() - etd.getTime()) / (1000*60*60*24)) : null;
        const daysFromEta = eta ? Math.floor((now.getTime() - eta.getTime()) / (1000*60*60*24)) : null;

        const tolerance = 5; // Allow 5 day tolerance for capping at 90
        const daysOverdue = s.days_overdue || 0;

        if (daysFromEtd !== null && Math.abs(Math.min(daysFromEtd, 90) - daysOverdue) <= tolerance) {
          matchesEtd++;
        } else if (daysFromEta !== null && Math.abs(Math.min(daysFromEta, 90) - daysOverdue) <= tolerance) {
          matchesEta++;
        } else {
          matchesNeither++;
        }
      }
    }
  }

  console.log('Based on sample of 20 shipments:');
  console.log(`  Matches ETD calculation: ${matchesEtd}`);
  console.log(`  Matches ETA calculation: ${matchesEta}`);
  console.log(`  Matches neither: ${matchesNeither}`);
  console.log('\nConclusion: days_overdue appears to be calculated from',
    matchesEtd > matchesEta ? 'ETD (departure)' :
    matchesEta > matchesEtd ? 'ETA (arrival)' :
    'whichever is available (ETD or ETA)');

  console.log('\n✅ Done!');
}

main().catch(console.error);
