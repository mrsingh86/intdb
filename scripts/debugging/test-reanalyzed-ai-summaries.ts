/**
 * Test AI Summary Generation on Reanalyzed Shipments
 *
 * Generates fresh AI summaries for shipments with recently reanalyzed chronicles.
 * Provides deep dive comparison of BEFORE (old summary) vs AFTER (new summary).
 *
 * Run: npx tsx scripts/debugging/test-reanalyzed-ai-summaries.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface ShipmentWithStaleAI {
  shipment_id: string;
  booking_number: string | null;
  shipper_name: string | null;
  stage: string | null;
  chronicle_count: number;
  old_summary_date: string;
  latest_reanalysis: string;
}

async function findShipmentsWithStaleAI(limit: number = 5): Promise<ShipmentWithStaleAI[]> {
  // Find shipments where chronicles were reanalyzed AFTER the AI summary was generated
  const { data, error } = await supabase.rpc('get_stale_ai_summaries', { p_limit: limit });

  if (error) {
    // Fallback: manual query if function doesn't exist
    console.log('Using fallback query...');
    const { data: fallback, error: fallbackError } = await supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        shipper_name,
        stage
      `)
      .not('status', 'in', '(cancelled,completed)')
      .limit(limit);

    if (fallbackError || !fallback) {
      console.error('Error finding shipments:', fallbackError?.message);
      return [];
    }

    // Get chronicle counts and dates for these shipments
    const results: ShipmentWithStaleAI[] = [];
    for (const s of fallback) {
      const { data: chronicles } = await supabase
        .from('chronicle')
        .select('analyzed_at')
        .eq('shipment_id', s.id)
        .order('analyzed_at', { ascending: false })
        .limit(1);

      const { data: oldSummary } = await supabase
        .from('ai_shipment_summaries')
        .select('updated_at')
        .eq('shipment_id', s.id)
        .single();

      const { count } = await supabase
        .from('chronicle')
        .select('*', { count: 'exact', head: true })
        .eq('shipment_id', s.id);

      if (chronicles?.[0] && oldSummary) {
        const reanalysisDate = new Date(chronicles[0].analyzed_at);
        const summaryDate = new Date(oldSummary.updated_at);

        if (reanalysisDate > summaryDate) {
          results.push({
            shipment_id: s.id,
            booking_number: s.booking_number,
            shipper_name: s.shipper_name,
            stage: s.stage,
            chronicle_count: count || 0,
            old_summary_date: oldSummary.updated_at,
            latest_reanalysis: chronicles[0].analyzed_at
          });
        }
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  return data || [];
}

async function getOldSummary(shipmentId: string) {
  const { data } = await supabase
    .from('ai_shipment_summaries')
    .select('*')
    .eq('shipment_id', shipmentId)
    .single();

  return data;
}

async function getChronicleData(shipmentId: string) {
  // Get chronicles with new reanalyzed data
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select(`
      id,
      occurred_at,
      document_type,
      carrier_name,
      has_action,
      action_type,
      action_description,
      action_owner,
      action_priority,
      action_deadline,
      has_issue,
      issue_type,
      issue_description,
      summary,
      direction,
      from_party,
      analyzed_at
    `)
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false })
    .limit(15);

  // Get shipment dates
  const { data: shipment } = await supabase
    .from('shipments')
    .select(`
      booking_number,
      mbl_number,
      shipper_name,
      consignee_name,
      carrier_name,
      stage,
      etd,
      eta,
      si_cutoff,
      vgm_cutoff,
      cargo_cutoff,
      last_free_day,
      port_of_loading,
      port_of_discharge
    `)
    .eq('id', shipmentId)
    .single();

  return { chronicles, shipment };
}

async function generateNewSummary(shipmentId: string) {
  // Dynamically import to avoid module resolution issues
  const { HaikuSummaryService } = await import('../../lib/chronicle-v2/services/haiku-summary-service');

  const service = new HaikuSummaryService(supabase);
  const result = await service.processShipment(shipmentId);

  return result;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

async function deepDive(shipment: ShipmentWithStaleAI, index: number) {
  console.log('\n' + '═'.repeat(80));
  console.log(`DEEP DIVE #${index + 1}: ${shipment.booking_number || 'Unknown'} (${shipment.shipper_name || 'Unknown'})`);
  console.log('═'.repeat(80));

  // Get old summary
  const oldSummary = await getOldSummary(shipment.shipment_id);

  // Get chronicle data
  const { chronicles, shipment: shipmentData } = await getChronicleData(shipment.shipment_id);

  console.log('\n┌─ SHIPMENT CONTEXT ─────────────────────────────────────────────────────────┐');
  console.log(`│ Booking: ${shipmentData?.booking_number || 'N/A'}`);
  console.log(`│ MBL: ${shipmentData?.mbl_number || 'N/A'}`);
  console.log(`│ Stage: ${shipmentData?.stage || 'N/A'}`);
  console.log(`│ Route: ${shipmentData?.port_of_loading || '?'} → ${shipmentData?.port_of_discharge || '?'}`);
  console.log(`│ Carrier: ${shipmentData?.carrier_name || 'N/A'}`);
  console.log(`│ ETD: ${formatDate(shipmentData?.etd)} | ETA: ${formatDate(shipmentData?.eta)}`);
  console.log(`│ SI Cutoff: ${formatDate(shipmentData?.si_cutoff)} | VGM: ${formatDate(shipmentData?.vgm_cutoff)}`);
  console.log(`│ Last Free Day: ${formatDate(shipmentData?.last_free_day)}`);
  console.log('└────────────────────────────────────────────────────────────────────────────┘');

  // Show OLD AI Summary
  console.log('\n┌─ OLD AI SUMMARY (Before Reanalysis) ──────────────────────────────────────┐');
  console.log(`│ Generated: ${formatDate(shipment.old_summary_date)}`);
  console.log('├────────────────────────────────────────────────────────────────────────────┤');
  if (oldSummary) {
    console.log(`│ Story: ${oldSummary.story?.substring(0, 150) || 'N/A'}...`);
    console.log(`│ Risk: ${oldSummary.risk_level || 'N/A'} - ${oldSummary.risk_reason || 'N/A'}`);
    console.log(`│ Blocker: ${oldSummary.current_blocker || 'None'}`);
    console.log(`│ Next Action: ${oldSummary.next_action || 'None'}`);
    console.log(`│ Action Owner: ${oldSummary.action_owner || 'N/A'}`);
    console.log(`│ Financial: ${oldSummary.financial_impact || 'None'}`);
  } else {
    console.log('│ No existing AI summary found');
  }
  console.log('└────────────────────────────────────────────────────────────────────────────┘');

  // Show Reanalyzed Chronicle Data (what will feed the new summary)
  console.log('\n┌─ REANALYZED CHRONICLE DATA (Input to AI) ─────────────────────────────────┐');
  console.log(`│ Total Chronicles: ${chronicles?.length || 0}`);
  console.log(`│ Latest Reanalysis: ${formatDate(shipment.latest_reanalysis)}`);
  console.log('├────────────────────────────────────────────────────────────────────────────┤');

  // Show actions from reanalyzed chronicles
  const withActions = chronicles?.filter(c => c.has_action) || [];
  const withIssues = chronicles?.filter(c => c.has_issue) || [];

  console.log(`│ Actions Detected: ${withActions.length}`);
  for (const action of withActions.slice(0, 3)) {
    console.log(`│   • [${action.action_priority || 'N/A'}] ${action.action_type || 'action'}: ${action.action_description?.substring(0, 60) || 'N/A'}`);
    console.log(`│     Owner: ${action.action_owner || 'N/A'} | Deadline: ${formatDate(action.action_deadline)}`);
  }

  console.log(`│ Issues Detected: ${withIssues.length}`);
  for (const issue of withIssues.slice(0, 2)) {
    console.log(`│   • ${issue.issue_type || 'issue'}: ${issue.issue_description?.substring(0, 60) || 'N/A'}`);
  }

  console.log('└────────────────────────────────────────────────────────────────────────────┘');

  // Generate NEW AI Summary
  console.log('\n┌─ GENERATING NEW AI SUMMARY... ─────────────────────────────────────────────┐');
  const startTime = Date.now();

  try {
    const newResult = await generateNewSummary(shipment.shipment_id);
    const elapsed = Date.now() - startTime;

    if (!newResult) {
      console.log('│ ❌ Failed to generate summary');
      console.log('└────────────────────────────────────────────────────────────────────────────┘');
      return null;
    }

    console.log(`│ ✅ Generated in ${elapsed}ms | Cost: $${newResult.cost.toFixed(4)}`);
    console.log('└────────────────────────────────────────────────────────────────────────────┘');

    // Show NEW AI Summary
    console.log('\n┌─ NEW AI SUMMARY (After Reanalysis) ───────────────────────────────────────┐');
    const summary = newResult.summary;

    // V2 Format (narrative)
    if (summary.narrative) {
      console.log('│ [V2 NARRATIVE]:');
      console.log(`│ ${summary.narrative}`);
      console.log(`│ Owner: ${summary.owner || 'N/A'} | Deadline: ${summary.keyDeadline || 'N/A'}`);
      console.log(`│ Key Insight: ${summary.keyInsight || 'N/A'}`);
    }

    console.log('├────────────────────────────────────────────────────────────────────────────┤');

    // V1 Format (detailed)
    console.log('│ [V1 DETAILED]:');
    console.log(`│ Story: ${summary.story?.substring(0, 200) || 'N/A'}...`);
    console.log(`│ Risk: ${summary.riskLevel || 'N/A'} - ${summary.riskReason || 'N/A'}`);
    console.log(`│ Blocker: ${summary.currentBlocker || 'None'}`);
    console.log(`│ Blocker Owner: ${summary.blockerOwner || 'N/A'} (${summary.blockerType || 'N/A'})`);
    console.log(`│ Next Action: ${summary.nextAction || 'None'}`);
    console.log(`│ Action Owner: ${summary.actionOwner || 'N/A'}`);
    console.log(`│ Action Priority: ${summary.actionPriority || 'N/A'}`);

    console.log('├────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ [FINANCIAL]:');
    console.log(`│ Financial Impact: ${summary.financialImpact || 'None'}`);
    console.log(`│ Documented Charges: ${summary.documentedCharges || 'None'}`);
    console.log(`│ Estimated Detention: ${summary.estimatedDetention || 'None'}`);
    console.log(`│ Customer Impact: ${summary.customerImpact || 'None'}`);

    console.log('├────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ [ANTI-HALLUCINATION P0-P3]:');
    console.log(`│ SLA Status: ${summary.slaStatus || 'N/A'} (${summary.hoursSinceCustomerUpdate || 0}h since update)`);
    console.log(`│ Escalation: ${summary.escalationLevel || 'None'} → ${summary.escalateTo || 'N/A'}`);
    console.log(`│ Root Cause: ${summary.rootCauseCategory || 'N/A'} / ${summary.rootCauseSubcategory || 'N/A'}`);
    console.log(`│ Typical Resolution: ${summary.typicalResolutionDays || 'N/A'} days`);
    console.log(`│ Benchmark: ${summary.benchmarkReference || 'N/A'}`);
    console.log(`│ Confidence: ${summary.recommendationConfidence || 'N/A'} - ${summary.confidenceReason || 'N/A'}`);

    if (summary.predictedRisks?.length) {
      console.log('├────────────────────────────────────────────────────────────────────────────┤');
      console.log('│ [PREDICTED RISKS]:');
      for (const risk of summary.predictedRisks.slice(0, 3)) {
        console.log(`│   • ${risk}`);
      }
    }

    if (summary.proactiveRecommendations?.length) {
      console.log('├────────────────────────────────────────────────────────────────────────────┤');
      console.log('│ [PROACTIVE RECOMMENDATIONS]:');
      for (const rec of summary.proactiveRecommendations.slice(0, 3)) {
        console.log(`│   • ${rec}`);
      }
    }

    if (summary.customerDraftSubject) {
      console.log('├────────────────────────────────────────────────────────────────────────────┤');
      console.log('│ [CUSTOMER DRAFT]:');
      console.log(`│ Subject: ${summary.customerDraftSubject}`);
      console.log(`│ Body: ${summary.customerDraftBody?.substring(0, 150) || 'N/A'}...`);
    }

    console.log('└────────────────────────────────────────────────────────────────────────────┘');

    return newResult;
  } catch (error: any) {
    console.log(`│ ❌ Error: ${error.message}`);
    console.log('└────────────────────────────────────────────────────────────────────────────┘');
    return null;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('AI SUMMARY GENERATION TEST - Reanalyzed Shipments');
  console.log('═'.repeat(80));
  console.log('Finding shipments with stale AI summaries (reanalyzed after last summary)...\n');

  const shipments = await findShipmentsWithStaleAI(5);

  if (shipments.length === 0) {
    console.log('No shipments found with stale AI summaries. Trying alternative approach...');

    // Alternative: just get any shipments with chronicles
    const { data: anyShipments } = await supabase
      .from('chronicle')
      .select('shipment_id, shipments!inner(booking_number, shipper_name, stage)')
      .not('shipment_id', 'is', null)
      .order('analyzed_at', { ascending: false })
      .limit(100);

    // Dedupe by shipment_id
    const uniqueShipments = new Map();
    for (const s of anyShipments || []) {
      if (!uniqueShipments.has(s.shipment_id)) {
        uniqueShipments.set(s.shipment_id, {
          shipment_id: s.shipment_id,
          booking_number: (s.shipments as any)?.booking_number,
          shipper_name: (s.shipments as any)?.shipper_name,
          stage: (s.shipments as any)?.stage,
          chronicle_count: 1,
          old_summary_date: '',
          latest_reanalysis: ''
        });
      }
    }

    const testShipments = Array.from(uniqueShipments.values()).slice(0, 5);

    if (testShipments.length === 0) {
      console.log('No shipments found with chronicles');
      return;
    }

    console.log(`Found ${testShipments.length} shipments to test\n`);

    let totalCost = 0;
    let successCount = 0;

    for (let i = 0; i < testShipments.length; i++) {
      const result = await deepDive(testShipments[i], i);
      if (result) {
        totalCost += result.cost;
        successCount++;
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log(`Shipments processed: ${successCount}/${testShipments.length}`);
    console.log(`Total cost: $${totalCost.toFixed(4)}`);
    console.log(`Average cost per summary: $${(totalCost / successCount).toFixed(4)}`);
    return;
  }

  console.log(`Found ${shipments.length} shipments with stale AI summaries:\n`);
  for (const s of shipments) {
    console.log(`  • ${s.booking_number || 'N/A'} (${s.shipper_name || 'Unknown'}) - ${s.chronicle_count} chronicles`);
    console.log(`    Old summary: ${formatDate(s.old_summary_date)} | Reanalyzed: ${formatDate(s.latest_reanalysis)}`);
  }

  let totalCost = 0;
  let successCount = 0;

  for (let i = 0; i < shipments.length; i++) {
    const result = await deepDive(shipments[i], i);
    if (result) {
      totalCost += result.cost;
      successCount++;
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Shipments processed: ${successCount}/${shipments.length}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Average cost per summary: $${(totalCost / successCount).toFixed(4)}`);
}

main().catch(console.error);
