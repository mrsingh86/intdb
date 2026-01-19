/**
 * Investigate whether high delays (33-99 days) are real or data quality issues
 * Run: npx tsx scripts/debugging/investigate-delay-data-quality.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface ShipmentData {
  id: string;
  intoglo_reference: string;
  stage: string;
  etd: string | null;
  eta: string | null;
  actual_departure: string | null;
  actual_arrival: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

interface AISummaryData {
  shipment_id: string;
  current_blocker: string | null;
  blocker_owner: string | null;
  risk_level: string | null;
  days_overdue: number | null;
  narrative: string | null;
  updated_at: string;
}

interface ChronicleData {
  id: string;
  shipment_id: string;
  occurred_at: string;
  direction: string;
  from_party: string;
  ai_summary: string | null;
  document_type: string;
  has_action: boolean;
}

async function main() {
  console.log('========================================');
  console.log('DATA QUALITY INVESTIGATION');
  console.log('Checking if high delays are real or stale');
  console.log('========================================\n');

  // Get shipments that have high delays in AI summaries
  const { data: summaries, error: summaryError } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, current_blocker, blocker_owner, risk_level, days_overdue, narrative, updated_at')
    .gt('days_overdue', 30)
    .not('current_blocker', 'is', null)
    .order('days_overdue', { ascending: false })
    .limit(10);

  if (summaryError || !summaries?.length) {
    console.log('No high-delay shipments found:', summaryError?.message);
    return;
  }

  console.log(`Found ${summaries.length} shipments with 30+ days overdue\n`);

  for (const summary of summaries) {
    console.log('\n========================================');
    console.log(`SHIPMENT: ${summary.shipment_id.slice(0, 8)}...`);
    console.log('========================================');

    // Get shipment base data
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, intoglo_reference, stage, etd, eta, actual_departure, actual_arrival, status, created_at, updated_at')
      .eq('id', summary.shipment_id)
      .single();

    if (!shipment) {
      console.log('  [ERROR] Shipment not found');
      continue;
    }

    // Calculate actual delay
    const eta = shipment.eta ? new Date(shipment.eta) : null;
    const etd = shipment.etd ? new Date(shipment.etd) : null;
    const now = new Date();
    const etaDaysAgo = eta ? Math.floor((now.getTime() - eta.getTime()) / (1000 * 60 * 60 * 24)) : null;
    const etdDaysAgo = etd ? Math.floor((now.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24)) : null;

    console.log('\n--- SHIPMENT BASE DATA ---');
    console.log(`  Reference: ${shipment.intoglo_reference}`);
    console.log(`  Stage: ${shipment.stage}`);
    console.log(`  Status: ${shipment.status || 'N/A'}`);
    console.log(`  ETD: ${shipment.etd || 'N/A'}${etdDaysAgo !== null ? ` (${etdDaysAgo} days ago)` : ''}`);
    console.log(`  ETA: ${shipment.eta || 'N/A'}${etaDaysAgo !== null ? ` (${etaDaysAgo} days ago)` : ''}`);
    console.log(`  Actual Departure: ${shipment.actual_departure || 'N/A'}`);
    console.log(`  Actual Arrival: ${shipment.actual_arrival || 'N/A'}`);

    console.log('\n--- AI SUMMARY DATA ---');
    console.log(`  Current Blocker: ${summary.current_blocker}`);
    console.log(`  Blocker Owner: ${summary.blocker_owner}`);
    console.log(`  Days Overdue: ${summary.days_overdue}`);
    console.log(`  Risk Level: ${summary.risk_level}`);
    console.log(`  Summary Updated: ${summary.updated_at}`);

    // Get latest chronicles to see actual current status
    const { data: chronicles } = await supabase
      .from('chronicle')
      .select('id, shipment_id, occurred_at, direction, from_party, ai_summary, document_type, has_action')
      .eq('shipment_id', summary.shipment_id)
      .order('occurred_at', { ascending: false })
      .limit(5);

    if (chronicles?.length) {
      console.log('\n--- LATEST 5 CHRONICLES ---');
      for (const c of chronicles) {
        const date = new Date(c.occurred_at).toLocaleDateString();
        console.log(`  [${date}] ${c.direction} from ${c.from_party}: ${c.document_type}`);
        if (c.ai_summary) {
          console.log(`           ${c.ai_summary.slice(0, 80)}...`);
        }
      }

      // Check for completion signals in recent chronicles
      const completionSignals = ['delivered', 'completed', 'released', 'arrival', 'cleared'];
      let hasCompletionSignal = false;
      let completionText = '';

      for (const c of chronicles) {
        const summary = (c.ai_summary || '').toLowerCase();
        const docType = (c.document_type || '').toLowerCase();

        for (const signal of completionSignals) {
          if (summary.includes(signal) || docType.includes(signal)) {
            hasCompletionSignal = true;
            completionText = c.ai_summary || c.document_type;
            break;
          }
        }
        if (hasCompletionSignal) break;
      }

      // Data quality assessment
      console.log('\n--- DATA QUALITY ASSESSMENT ---');

      // Check 1: Is delay mathematically correct?
      const referenceDate = eta || etd;
      if (referenceDate) {
        const calculatedDelay = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
        const delayMatch = Math.abs(calculatedDelay - (summary.days_overdue || 0)) < 5;
        console.log(`  Delay Calculation: ${delayMatch ? '✅ CORRECT' : '⚠️ MISMATCH'} (calculated: ${calculatedDelay}, reported: ${summary.days_overdue})`);
      }

      // Check 2: Does blocker text match recent activity?
      const blockerLower = (summary.current_blocker || '').toLowerCase();
      if (hasCompletionSignal) {
        console.log(`  Blocker Relevance: ⚠️ STALE - Recent activity shows "${completionText.slice(0, 50)}..." but blocker says "${summary.current_blocker}"`);
      } else {
        console.log(`  Blocker Relevance: ✅ Appears current (no completion signals in recent chronicles)`);
      }

      // Check 3: Stage vs blocker consistency
      const stageLower = (shipment.stage || '').toLowerCase();
      if (stageLower.includes('completed') || stageLower.includes('delivered')) {
        if (summary.current_blocker) {
          console.log(`  Stage/Blocker Consistency: ⚠️ INCONSISTENT - Stage is "${shipment.stage}" but blocker exists`);
        }
      } else {
        console.log(`  Stage/Blocker Consistency: ✅ Stage "${shipment.stage}" allows for blockers`);
      }

      // Check 4: When was AI summary last updated vs last chronicle
      const summaryUpdated = new Date(summary.updated_at);
      const latestChronicle = new Date(chronicles[0].occurred_at);
      const summaryAgeAfterLastChronicle = Math.floor((latestChronicle.getTime() - summaryUpdated.getTime()) / (1000 * 60 * 60 * 24));

      if (summaryAgeAfterLastChronicle > 1) {
        console.log(`  Summary Freshness: ⚠️ STALE - Summary updated ${summaryUpdated.toLocaleDateString()}, last chronicle ${latestChronicle.toLocaleDateString()} (${summaryAgeAfterLastChronicle} days newer)`);
      } else {
        console.log(`  Summary Freshness: ✅ Up to date`);
      }
    }
  }

  // Summary statistics
  console.log('\n\n========================================');
  console.log('SUMMARY STATISTICS');
  console.log('========================================');

  // Count shipments by stage
  const { data: stageStats } = await supabase
    .from('shipments')
    .select('stage')
    .in('id', summaries.map(s => s.shipment_id));

  if (stageStats) {
    const stageCounts: Record<string, number> = {};
    for (const s of stageStats) {
      stageCounts[s.stage || 'null'] = (stageCounts[s.stage || 'null'] || 0) + 1;
    }
    console.log('\nShipments by Stage:');
    for (const [stage, count] of Object.entries(stageCounts)) {
      console.log(`  ${stage}: ${count}`);
    }
  }

  // Check how many summaries are older than their latest chronicle
  const { data: staleSummaries } = await supabase.rpc('count_stale_ai_summaries');
  if (typeof staleSummaries === 'number') {
    console.log(`\nStale Summaries (older than latest chronicle): ${staleSummaries}`);
  }

  console.log('\n✅ Investigation complete!');
}

main().catch(console.error);
