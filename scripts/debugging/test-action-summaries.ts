/**
 * Test AI Summaries with Updated Action System
 *
 * Generates 10 fresh Haiku AI summaries to validate action detection/resolution
 * Run: npx ts-node scripts/debugging/test-action-summaries.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const anthropic = new Anthropic();

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

const SYSTEM_PROMPT = `You are a freight forwarding operations analyst at Intoglo, an NVOCC (Non-Vessel Operating Common Carrier).

Analyze shipment communications and provide actionable intelligence for operations.

DOMAIN KNOWLEDGE:
- Stakeholders: ocean_carrier, trucker, customs_broker, shipper, consignee, nvocc, terminal
- Issue types: delay, documentation, detention, demurrage, hold, payment, rollover
- Milestones: Booking → SI Submitted → VGM → BL Draft → BL Issued → Departed → Arrived → Delivered
- Cutoffs: SI cutoff, VGM cutoff, Cargo cutoff (missing these = rollover risk)
- Financial risks: Detention (container held), Demurrage (port storage)

OUTPUT FORMAT (strict JSON):
{
  "story": "2-3 sentence narrative of shipment journey",
  "currentBlocker": "What's stopping progress RIGHT NOW (null if none)",
  "blockerOwner": "Who must act: carrier|trucker|customs|customer|intoglo|null",
  "nextAction": "Specific action needed with deadline if known",
  "actionOwner": "Who should do it",
  "actionPriority": "critical|high|medium|low",
  "financialImpact": "Any costs incurred or at risk (null if none)",
  "customerImpact": "How customer is affected (null if none)",
  "riskLevel": "red|amber|green",
  "riskReason": "Why this risk level",
  "pendingActions": [{"action": "description", "owner": "who", "priority": "level", "deadline": "date or null"}]
}

Focus on ACTIONABLE intelligence. Be concise.`;

interface ChronicleEntry {
  occurred_at: string;
  direction: string;
  from_party: string;
  document_type: string;
  summary: string;
  has_issue: boolean;
  issue_type: string | null;
  has_action: boolean;
  action_type: string | null;
  action_description: string | null;
  action_owner: string | null;
  action_priority: string | null;
  action_deadline: string | null;
  action_completed_at: string | null;
}

function formatChronicle(entries: ChronicleEntry[]): string {
  return entries.map(e => {
    const date = new Date(e.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dir = e.direction === 'inbound' ? '←' : '→';
    const issue = e.has_issue ? ` [ISSUE: ${e.issue_type}]` : '';

    let actionStr = '';
    if (e.has_action) {
      const status = e.action_completed_at ? '✅DONE' : '⏳PENDING';
      actionStr = ` [ACTION ${status}: ${e.action_type || 'task'} - ${e.action_description || 'action needed'}`;
      if (e.action_owner) actionStr += ` | Owner: ${e.action_owner}`;
      if (e.action_priority) actionStr += ` | Priority: ${e.action_priority}`;
      if (e.action_deadline) actionStr += ` | Due: ${new Date(e.action_deadline).toLocaleDateString()}`;
      actionStr += ']';
    }

    return `${date} ${dir} ${e.from_party} (${e.document_type}): ${e.summary}${issue}${actionStr}`;
  }).join('\n');
}

async function generateSummary(shipmentId: string): Promise<any> {
  // Get shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  if (!shipment) return { error: 'Shipment not found' };

  // Get chronicles with action data
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select(`
      occurred_at, direction, from_party, document_type, summary,
      has_issue, issue_type,
      has_action, action_type, action_description, action_owner,
      action_priority, action_deadline, action_completed_at
    `)
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false })
    .limit(30);

  if (!chronicles || chronicles.length === 0) return { error: 'No chronicles' };

  // Count actions
  const pendingActions = chronicles.filter(c => c.has_action && !c.action_completed_at);
  const completedActions = chronicles.filter(c => c.has_action && c.action_completed_at);

  const userPrompt = `Analyze this shipment and provide the structured JSON summary.

SHIPMENT INFO:
- Booking: ${shipment.booking_number || 'N/A'}
- MBL: ${shipment.mbl_number || 'N/A'}
- Route: ${shipment.port_of_loading || '?'} → ${shipment.port_of_discharge || '?'}
- Vessel: ${shipment.vessel_name || 'N/A'}
- ETD: ${shipment.etd || 'N/A'} | ETA: ${shipment.eta || 'N/A'}
- Current Stage: ${shipment.stage || 'N/A'}
- Shipper: ${shipment.shipper_name || 'N/A'}
- Consignee: ${shipment.consignee_name || 'N/A'}
- Carrier: ${shipment.carrier_name || 'N/A'}

ACTION STATUS:
- Pending Actions: ${pendingActions.length}
- Completed Actions: ${completedActions.length}

COMMUNICATION HISTORY (most recent first):
${formatChronicle(chronicles as ChronicleEntry[])}

Provide the JSON summary:`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  let summary;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    summary = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Parse failed', raw: text };
  } catch {
    summary = { error: 'JSON parse failed', raw: text };
  }

  const cost = (response.usage.input_tokens * 0.25 / 1_000_000) + (response.usage.output_tokens * 1.25 / 1_000_000);

  return {
    shipment,
    chronicles: chronicles.length,
    pendingActions: pendingActions.length,
    completedActions: completedActions.length,
    summary,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cost,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('🧪 AI SUMMARY TEST - Validating Updated Action System');
  console.log('='.repeat(100));
  console.log(`Testing ${TEST_SHIPMENTS.length} shipments with fresh Haiku AI summaries\n`);

  let totalCost = 0;
  let successCount = 0;

  for (let i = 0; i < TEST_SHIPMENTS.length; i++) {
    const test = TEST_SHIPMENTS[i];
    console.log('\n' + '─'.repeat(100));
    console.log(`📦 [${i + 1}/${TEST_SHIPMENTS.length}] ${test.name}`);
    console.log('─'.repeat(100));

    try {
      const startTime = Date.now();
      const result = await generateSummary(test.id);
      const elapsed = Date.now() - startTime;

      if (result.error) {
        console.log(`\n❌ ERROR: ${result.error}`);
        continue;
      }

      successCount++;
      totalCost += result.cost;

      console.log(`\n📊 SHIPMENT: ${result.shipment.booking_number || result.shipment.mbl_number}`);
      console.log(`   Route: ${result.shipment.port_of_loading} → ${result.shipment.port_of_discharge}`);
      console.log(`   Stage: ${result.shipment.stage} | Carrier: ${result.shipment.carrier_name}`);

      console.log(`\n📋 ACTION STATS:`);
      console.log(`   Chronicles: ${result.chronicles} | Pending Actions: ${result.pendingActions} | Completed: ${result.completedActions}`);

      console.log(`\n⏱️  Generated in ${elapsed}ms | Cost: $${result.cost.toFixed(4)} | Tokens: ${result.inputTokens}/${result.outputTokens}`);

      console.log(`\n🤖 AI SUMMARY OUTPUT:`);
      console.log('─'.repeat(50));

      const s = result.summary;

      console.log(`\n📖 STORY: ${s.story || 'N/A'}`);

      console.log(`\n🚧 BLOCKER: ${s.currentBlocker || 'None'}`);
      if (s.blockerOwner) console.log(`   Owner: ${s.blockerOwner}`);

      console.log(`\n⚡ NEXT ACTION: ${s.nextAction || 'None'}`);
      if (s.actionOwner) console.log(`   Owner: ${s.actionOwner} | Priority: ${s.actionPriority || 'N/A'}`);

      console.log(`\n💰 FINANCIAL: ${s.financialImpact || 'None'}`);
      console.log(`👥 CUSTOMER: ${s.customerImpact || 'None'}`);

      console.log(`\n🚦 RISK: ${(s.riskLevel || 'N/A').toUpperCase()}`);
      console.log(`   Reason: ${s.riskReason || 'N/A'}`);

      if (s.pendingActions && s.pendingActions.length > 0) {
        console.log(`\n📋 AI-IDENTIFIED PENDING ACTIONS:`);
        for (const action of s.pendingActions) {
          console.log(`   • [${action.priority || 'medium'}] ${action.action}`);
          console.log(`     Owner: ${action.owner || 'N/A'} | Deadline: ${action.deadline || 'N/A'}`);
        }
      }

    } catch (error) {
      console.log(`\n❌ EXCEPTION: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
