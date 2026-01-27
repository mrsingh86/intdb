/**
 * Test AI Summaries with Updated Action System
 *
 * Uses the ACTUAL HaikuSummaryService with real prompts
 * Run: node scripts/debugging/test-action-summaries.js
 */

require('dotenv').config();
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test shipments with good action data
const TEST_SHIPMENTS = [
  { id: '1cfb2a63-e53b-472f-b030-c81c02189ada', name: '13210347 - Hapag-Lloyd Houston' },
  { id: '6cf68062-3bbe-4d3f-ae71-d00442acd2c8', name: '94075162 - Hapag-Lloyd NYC' },
  { id: '44dfdf5d-0b3c-4989-b95c-6a5ff1867e59', name: '263077338 - OOCL BL_ISSUED' },
  { id: '7f5a177e-f968-4c86-ae78-72f4ac7619a5', name: '263115259 - ONE Houston' },
  { id: 'ffe540c9-21df-43b0-a724-6619dfa11de6', name: '262226938 - Maersk Newark' },
  { id: '1a3f589e-7fa6-4be5-856f-a98c51fb5589', name: '260836706 - Maersk Canada' },
  { id: '0fcd57af-04a1-4286-96c4-56c8a9b2cef1', name: '261050973 - Maersk Portland' },
  { id: 'a1a2699c-54eb-4036-b1fe-bbc08ee8024a', name: '261009776 - Maersk Toronto' },
  { id: '0ff900c2-0d9f-4c6c-99cf-ac243c68b3e7', name: '34901222 - Hapag-Lloyd NYC' },
  { id: 'fed19027-b2a4-4f3b-9594-43bba7a3356a', name: '262864944 - Maersk Newark' },
];

async function main() {
  console.log('='.repeat(100));
  console.log('🧪 AI SUMMARY TEST - Using REAL HaikuSummaryService');
  console.log('='.repeat(100));

  // Dynamically import the ES module
  const { HaikuSummaryService } = await import('../../lib/chronicle-v2/index.js');
  const summaryService = new HaikuSummaryService(supabase);

  let totalCost = 0;
  let successCount = 0;

  for (let i = 0; i < TEST_SHIPMENTS.length; i++) {
    const test = TEST_SHIPMENTS[i];
    console.log('\n' + '─'.repeat(100));
    console.log(`📦 [${i + 1}/${TEST_SHIPMENTS.length}] ${test.name}`);
    console.log('─'.repeat(100));

    try {
      // Get action stats first
      const { data: actionData } = await supabase
        .from('chronicle')
        .select('has_action, action_owner, action_type, action_completed_at, action_priority')
        .eq('shipment_id', test.id);

      const actions = (actionData || []).filter(c => c.has_action);
      const pending = actions.filter(a => !a.action_completed_at);
      const completed = actions.filter(a => a.action_completed_at);

      const byOwner = {};
      const byType = {};
      for (const a of pending) {
        if (a.action_owner) byOwner[a.action_owner] = (byOwner[a.action_owner] || 0) + 1;
        if (a.action_type) byType[a.action_type] = (byType[a.action_type] || 0) + 1;
      }

      console.log(`\n📊 ACTION STATS:`);
      console.log(`   Total: ${actions.length} | Pending: ${pending.length} | Completed: ${completed.length}`);
      if (Object.keys(byOwner).length > 0) console.log(`   By Owner: ${JSON.stringify(byOwner)}`);
      if (Object.keys(byType).length > 0) console.log(`   By Type: ${JSON.stringify(byType)}`);

      // Generate fresh AI summary using real service
      const startTime = Date.now();
      const result = await summaryService.processShipment(test.id);
      const elapsed = Date.now() - startTime;

      if (!result) {
        console.log(`\n❌ No result returned`);
        continue;
      }

      successCount++;
      totalCost += result.cost || 0;

      console.log(`\n⏱️  Generated in ${elapsed}ms | Cost: $${(result.cost || 0).toFixed(4)} | Tokens: ${result.inputTokens}/${result.outputTokens}`);

      console.log(`\n🤖 AI SUMMARY OUTPUT (Real HaikuSummaryService):`);
      console.log('─'.repeat(50));

      const s = result.summary;

      // V2 Format
      if (s.narrative) {
        console.log(`\n📝 NARRATIVE: ${s.narrative}`);
      }
      if (s.owner) {
        console.log(`👤 OWNER: ${s.owner} (${s.ownerType || 'unknown'})`);
      }
      if (s.keyDeadline) {
        console.log(`📅 KEY DEADLINE: ${s.keyDeadline}`);
      }
      if (s.keyInsight) {
        console.log(`💡 KEY INSIGHT: ${s.keyInsight}`);
      }

      // V1 Format
      console.log(`\n📖 STORY: ${s.story || 'N/A'}`);

      console.log(`\n🚧 BLOCKER: ${s.currentBlocker || 'None'}`);
      if (s.blockerOwner) console.log(`   Owner: ${s.blockerOwner} | Type: ${s.blockerType || 'N/A'}`);

      console.log(`\n⚡ NEXT ACTION: ${s.nextAction || 'None'}`);
      if (s.actionOwner) console.log(`   Owner: ${s.actionOwner} | Priority: ${s.actionPriority || 'N/A'}`);
      if (s.actionContact) console.log(`   Contact: ${s.actionContact}`);

      console.log(`\n💰 FINANCIAL: ${s.financialImpact || 'None'}`);
      if (s.documentedCharges) console.log(`   Documented: ${s.documentedCharges}`);
      if (s.estimatedDetention) console.log(`   Detention: ${s.estimatedDetention}`);

      console.log(`\n👥 CUSTOMER: ${s.customerImpact || 'None'}`);
      console.log(`   Action Required: ${s.customerActionRequired ? 'YES' : 'No'}`);

      console.log(`\n🚦 RISK: ${(s.riskLevel || 'N/A').toUpperCase()}`);
      console.log(`   Reason: ${s.riskReason || 'N/A'}`);
      if (s.daysOverdue) console.log(`   Days Overdue: ${s.daysOverdue}`);

      // Intelligence signals
      if (s.escalationCount || s.issueCount || s.urgentMessageCount) {
        console.log(`\n📈 SIGNALS:`);
        if (s.escalationCount) console.log(`   Escalations: ${s.escalationCount}`);
        if (s.issueCount) console.log(`   Issues: ${s.issueCount}`);
        if (s.urgentMessageCount) console.log(`   Urgent Messages: ${s.urgentMessageCount}`);
        if (s.daysSinceActivity) console.log(`   Days Since Activity: ${s.daysSinceActivity}`);
      }

      // Predictive
      if (s.predictedRisks && s.predictedRisks.length > 0) {
        console.log(`\n🔮 PREDICTED RISKS:`);
        for (const risk of s.predictedRisks) {
          console.log(`   • ${risk}`);
        }
      }
      if (s.proactiveRecommendations && s.proactiveRecommendations.length > 0) {
        console.log(`\n💡 RECOMMENDATIONS:`);
        for (const rec of s.proactiveRecommendations) {
          console.log(`   • ${rec}`);
        }
      }

      // SLA & Escalation
      if (s.slaStatus) {
        console.log(`\n⏰ SLA: ${s.slaStatus}`);
        if (s.hoursSinceCustomerUpdate) console.log(`   Hours Since Update: ${s.hoursSinceCustomerUpdate}`);
        if (s.slaSummary) console.log(`   Summary: ${s.slaSummary}`);
      }
      if (s.escalationLevel) {
        console.log(`\n🚨 ESCALATION: ${s.escalationLevel}`);
        if (s.escalateTo) console.log(`   Escalate To: ${s.escalateTo}`);
      }

    } catch (error) {
      console.log(`\n❌ EXCEPTION: ${error.message || 'Unknown error'}`);
      console.log(error.stack);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('📊 SUMMARY');
  console.log('='.repeat(100));
  console.log(`✅ Success: ${successCount}/${TEST_SHIPMENTS.length}`);
  console.log(`💰 Total Cost: $${totalCost.toFixed(4)}`);
  if (successCount > 0) {
    console.log(`📈 Avg Cost per Summary: $${(totalCost / successCount).toFixed(4)}`);
    console.log(`🔮 Projected Cost (100 shipments): $${(totalCost / successCount * 100).toFixed(2)}`);
  }
  console.log('='.repeat(100));
}

main().catch(console.error);
