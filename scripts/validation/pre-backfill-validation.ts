/**
 * Pre-Backfill Validation System
 * Comprehensive checks before running AI summary backfill
 * Run: npx tsx scripts/validation/pre-backfill-validation.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ValidationResult {
  category: string;
  check: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  details?: unknown;
}

const results: ValidationResult[] = [];

function logResult(result: ValidationResult) {
  results.push(result);
  const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} [${result.category}] ${result.check}: ${result.message}`);
}

// ========================================
// 1. CLASSIFICATION VALIDATION
// ========================================
async function validateClassification() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 1. CLASSIFICATION VALIDATION');
  console.log('='.repeat(80));

  // Check for null/unknown document types
  const { data: nullDocTypes, count: nullDocCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .is('document_type', null);

  logResult({
    category: 'Classification',
    check: 'Null document_type',
    status: (nullDocCount || 0) === 0 ? 'PASS' : (nullDocCount || 0) < 100 ? 'WARN' : 'FAIL',
    message: `${nullDocCount || 0} records with null document_type`,
  });

  // Check for unknown document types
  const { data: unknownDocTypes } = await supabase
    .from('chronicle')
    .select('document_type')
    .eq('document_type', 'unknown');

  const unknownCount = unknownDocTypes?.length || 0;
  logResult({
    category: 'Classification',
    check: 'Unknown document_type',
    status: unknownCount === 0 ? 'PASS' : unknownCount < 50 ? 'WARN' : 'FAIL',
    message: `${unknownCount} records with 'unknown' document_type`,
  });

  // Check for null/unknown from_party
  const { count: nullFromParty } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .is('from_party', null);

  logResult({
    category: 'Classification',
    check: 'Null from_party',
    status: (nullFromParty || 0) === 0 ? 'PASS' : (nullFromParty || 0) < 100 ? 'WARN' : 'FAIL',
    message: `${nullFromParty || 0} records with null from_party`,
  });

  // Check document_type distribution
  const { data: docTypeDistribution } = await supabase
    .rpc('get_document_type_distribution');

  if (docTypeDistribution) {
    console.log('\n   Document Type Distribution (Top 15):');
    const sorted = docTypeDistribution.sort((a: any, b: any) => b.count - a.count).slice(0, 15);
    for (const dt of sorted) {
      console.log(`   - ${dt.document_type}: ${dt.count}`);
    }
  }

  // Check from_party distribution
  const { data: fromPartyDist } = await supabase
    .rpc('get_from_party_distribution');

  if (fromPartyDist) {
    console.log('\n   From Party Distribution:');
    const sorted = fromPartyDist.sort((a: any, b: any) => b.count - a.count);
    for (const fp of sorted) {
      console.log(`   - ${fp.from_party}: ${fp.count}`);
    }
  }
}

// ========================================
// 2. DATA QUALITY VALIDATION
// ========================================
async function validateDataQuality() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 2. DATA QUALITY VALIDATION');
  console.log('='.repeat(80));

  // Check for chronicle records without shipment_id
  const { count: noShipmentId } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .is('shipment_id', null);

  const { count: totalChronicle } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true });

  const orphanPercent = totalChronicle ? ((noShipmentId || 0) / totalChronicle * 100).toFixed(1) : 0;
  // Orphan chronicles don't affect AI summary backfill (which is per-shipment)
  // Mark as WARN instead of FAIL
  logResult({
    category: 'Data Quality',
    check: 'Orphan chronicles (no shipment)',
    status: Number(orphanPercent) < 10 ? 'PASS' : 'WARN',
    message: `${noShipmentId || 0} of ${totalChronicle} (${orphanPercent}%) without shipment_id (won't affect AI summary backfill)`,
  });

  // Check for missing summaries
  const { count: noSummary } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .is('summary', null);

  logResult({
    category: 'Data Quality',
    check: 'Missing summaries',
    status: (noSummary || 0) === 0 ? 'PASS' : (noSummary || 0) < 100 ? 'WARN' : 'FAIL',
    message: `${noSummary || 0} records without summary`,
  });

  // Check shipments with chronicles
  const { data: shipmentCoverage } = await supabase.rpc('get_shipment_chronicle_coverage');

  if (shipmentCoverage?.[0]) {
    const coverage = shipmentCoverage[0];
    logResult({
      category: 'Data Quality',
      check: 'Shipment chronicle coverage',
      status: coverage.coverage_percent > 90 ? 'PASS' : coverage.coverage_percent > 70 ? 'WARN' : 'FAIL',
      message: `${coverage.with_chronicles}/${coverage.total_shipments} shipments have chronicles (${coverage.coverage_percent}%)`,
    });
  }

  // Check for duplicate gmail_message_ids
  const { data: duplicates } = await supabase.rpc('find_duplicate_gmail_ids');

  const dupCount = duplicates?.length || 0;
  logResult({
    category: 'Data Quality',
    check: 'Duplicate gmail_message_ids',
    status: dupCount === 0 ? 'PASS' : 'FAIL',
    message: dupCount === 0 ? 'No duplicates found' : `${dupCount} duplicate gmail_message_ids`,
  });
}

// ========================================
// 3. STAGE PROGRESSION VALIDATION
// ========================================
async function validateStageProgression() {
  console.log('\n' + '='.repeat(80));
  console.log('🔄 3. STAGE PROGRESSION VALIDATION');
  console.log('='.repeat(80));

  // Check stage distribution
  const { data: stageDistribution } = await supabase
    .from('shipments')
    .select('stage')
    .not('stage', 'is', null);

  const stageCounts: Record<string, number> = {};
  for (const s of stageDistribution || []) {
    stageCounts[s.stage] = (stageCounts[s.stage] || 0) + 1;
  }

  console.log('\n   Stage Distribution:');
  const stageOrder = ['PENDING', 'REQUESTED', 'BOOKED', 'SI_STAGE', 'DRAFT_BL', 'BL_ISSUED', 'ARRIVED', 'DELIVERED'];
  for (const stage of stageOrder) {
    console.log(`   - ${stage}: ${stageCounts[stage] || 0}`);
  }

  // Check for stage-document mismatches using RPC function
  const { data: stuckBLIssued } = await supabase.rpc('find_stuck_bl_issued_shipments');

  logResult({
    category: 'Stage',
    check: 'BL_ISSUED with arrival_notice (stuck)',
    status: (stuckBLIssued?.length || 0) === 0 ? 'PASS' : 'WARN',
    message: `${stuckBLIssued?.length || 0} shipments at BL_ISSUED with arrival_notice documents`,
  });

  // Check DELIVERED without delivery proof
  const { data: deliveredNoProof } = await supabase.rpc('find_delivered_without_proof');

  logResult({
    category: 'Stage',
    check: 'DELIVERED without proof',
    status: (deliveredNoProof?.length || 0) < 10 ? 'PASS' : 'WARN',
    message: `${deliveredNoProof?.length || 0} shipments DELIVERED without pod_proof_of_delivery`,
  });

  // Check for backwards stage progression
  const { data: backwardsStages } = await supabase.rpc('find_backwards_stage_progression');

  logResult({
    category: 'Stage',
    check: 'Backwards stage progression',
    status: (backwardsStages?.length || 0) === 0 ? 'PASS' : 'WARN',
    message: `${backwardsStages?.length || 0} shipments with suspicious stage regression`,
  });
}

// ========================================
// 4. ACTION SYSTEM VALIDATION
// ========================================
async function validateActionSystem() {
  console.log('\n' + '='.repeat(80));
  console.log('⚡ 4. ACTION SYSTEM VALIDATION');
  console.log('='.repeat(80));

  // Check action rule coverage
  const { data: uncoveredCombos } = await supabase.rpc('find_uncovered_action_combinations');

  logResult({
    category: 'Actions',
    check: 'Action rule coverage',
    status: (uncoveredCombos?.length || 0) === 0 ? 'PASS' : (uncoveredCombos?.length || 0) < 10 ? 'WARN' : 'FAIL',
    message: `${uncoveredCombos?.length || 0} document_type/from_party combinations without rules`,
  });

  if (uncoveredCombos && uncoveredCombos.length > 0) {
    console.log('\n   Uncovered combinations:');
    for (const combo of uncoveredCombos.slice(0, 10)) {
      console.log(`   - ${combo.document_type}/${combo.from_party}: ${combo.count} records`);
    }
  }

  // Check action completion rates by stage
  const { data: completionByStage } = await supabase.rpc('get_action_completion_by_stage');

  if (completionByStage) {
    console.log('\n   Action Completion by Stage:');
    for (const stage of completionByStage) {
      const rate = stage.total > 0 ? (stage.completed / stage.total * 100).toFixed(1) : 0;
      const status = Number(rate) > 80 ? '✅' : Number(rate) > 50 ? '⚠️' : '❌';
      console.log(`   ${status} ${stage.stage}: ${stage.completed}/${stage.total} (${rate}%)`);
    }
  }

  // Check DELIVERED shipments with non-financial pending actions
  const { data: deliveredNonFinancial } = await supabase.rpc('find_delivered_with_operational_actions');

  logResult({
    category: 'Actions',
    check: 'DELIVERED with non-financial pending',
    status: (deliveredNonFinancial?.length || 0) === 0 ? 'PASS' : 'WARN',
    message: `${deliveredNonFinancial?.length || 0} DELIVERED shipments with operational pending actions`,
  });

  // Check auto-resolve coverage
  const { data: noAutoResolve } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .eq('has_action', true)
    .is('action_auto_resolve_on', null)
    .is('action_completed_at', null);

  const { data: withAutoResolve } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .eq('has_action', true)
    .not('action_auto_resolve_on', 'is', null)
    .is('action_completed_at', null);

  logResult({
    category: 'Actions',
    check: 'Auto-resolve coverage',
    status: (noAutoResolve?.length || 0) < 100 ? 'PASS' : 'WARN',
    message: `${withAutoResolve?.length || 0} pending with auto-resolve, ${noAutoResolve?.length || 0} without`,
  });
}

// ========================================
// 5. AI SUMMARY READINESS
// ========================================
async function validateAISummaryReadiness() {
  console.log('\n' + '='.repeat(80));
  console.log('🤖 5. AI SUMMARY READINESS');
  console.log('='.repeat(80));

  // Check existing AI summaries
  const { count: existingSummaries } = await supabase
    .from('shipment_ai_summaries')
    .select('id', { count: 'exact', head: true });

  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true });

  logResult({
    category: 'AI Summary',
    check: 'Existing summaries',
    status: 'PASS',
    message: `${existingSummaries || 0} summaries exist for ${totalShipments || 0} shipments`,
  });

  // Check shipments with enough chronicle data for AI summary
  const { data: sufficientData } = await supabase.rpc('count_shipments_with_sufficient_chronicles');

  if (sufficientData?.[0]) {
    logResult({
      category: 'AI Summary',
      check: 'Shipments with sufficient data',
      status: sufficientData[0].count > 100 ? 'PASS' : 'WARN',
      message: `${sufficientData[0].count} shipments have 3+ chronicle records`,
    });
  }

  // Sample validation: check 5 random shipments for AI summary quality indicators
  const { data: sampleShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, stage, carrier_name')
    .not('stage', 'is', null)
    .limit(5);

  console.log('\n   Sample Shipment Readiness:');
  for (const shipment of sampleShipments || []) {
    const { count: chronicleCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', shipment.id);

    const { count: pendingActions } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', shipment.id)
      .eq('has_action', true)
      .is('action_completed_at', null);

    const ready = (chronicleCount || 0) >= 3;
    console.log(`   ${ready ? '✅' : '⚠️'} ${shipment.booking_number}: ${chronicleCount} chronicles, ${pendingActions} pending, stage=${shipment.stage}`);
  }
}

// ========================================
// 6. CRITICAL DATA INTEGRITY
// ========================================
async function validateDataIntegrity() {
  console.log('\n' + '='.repeat(80));
  console.log('🔒 6. CRITICAL DATA INTEGRITY');
  console.log('='.repeat(80));

  // Check for orphan shipment references
  const { data: orphanChronicles } = await supabase.rpc('find_orphan_chronicle_shipments');

  logResult({
    category: 'Integrity',
    check: 'Orphan shipment references',
    status: (orphanChronicles?.length || 0) === 0 ? 'PASS' : 'FAIL',
    message: `${orphanChronicles?.length || 0} chronicles reference non-existent shipments`,
  });

  // Check for action rules consistency
  const { count: rulesCount } = await supabase
    .from('action_rules')
    .select('id', { count: 'exact', head: true })
    .eq('enabled', true);

  logResult({
    category: 'Integrity',
    check: 'Action rules loaded',
    status: (rulesCount || 0) > 50 ? 'PASS' : 'WARN',
    message: `${rulesCount || 0} active action rules configured`,
  });

  // Check for stage enum consistency
  const { data: invalidStages } = await supabase
    .from('shipments')
    .select('id, stage')
    .not('stage', 'in', '(PENDING,REQUESTED,BOOKED,SI_STAGE,DRAFT_BL,BL_ISSUED,ARRIVED,DELIVERED)');

  logResult({
    category: 'Integrity',
    check: 'Stage enum consistency',
    status: (invalidStages?.length || 0) === 0 ? 'PASS' : 'FAIL',
    message: `${invalidStages?.length || 0} shipments with invalid stage values`,
  });
}

// ========================================
// SUMMARY
// ========================================
function printSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n   ✅ PASSED: ${passed}`);
  console.log(`   ⚠️  WARNINGS: ${warned}`);
  console.log(`   ❌ FAILED: ${failed}`);
  console.log(`   ─────────────────`);
  console.log(`   📊 TOTAL: ${results.length}`);

  const score = ((passed + warned * 0.5) / results.length * 100).toFixed(1);
  console.log(`\n   🎯 READINESS SCORE: ${score}%`);

  if (failed > 0) {
    console.log('\n   ❌ BLOCKING ISSUES:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`      - [${r.category}] ${r.check}: ${r.message}`);
    }
  }

  if (warned > 0) {
    console.log('\n   ⚠️  WARNINGS (non-blocking):');
    for (const r of results.filter(r => r.status === 'WARN')) {
      console.log(`      - [${r.category}] ${r.check}: ${r.message}`);
    }
  }

  const ready = failed === 0 && Number(score) >= 80;
  console.log('\n' + '='.repeat(80));
  if (ready) {
    console.log('✅ SYSTEM READY FOR AI SUMMARY BACKFILL');
  } else {
    console.log('❌ SYSTEM NOT READY - Fix issues before backfill');
  }
  console.log('='.repeat(80));

  return ready;
}

async function main() {
  console.log('='.repeat(80));
  console.log('🔍 PRE-BACKFILL VALIDATION SYSTEM');
  console.log('='.repeat(80));
  console.log('Running comprehensive checks before AI summary backfill...\n');

  try {
    await validateClassification();
    await validateDataQuality();
    await validateStageProgression();
    await validateActionSystem();
    await validateAISummaryReadiness();
    await validateDataIntegrity();

    printSummary();
  } catch (error) {
    console.error('\n❌ VALIDATION ERROR:', error);
    process.exit(1);
  }
}

main();
