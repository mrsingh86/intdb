/**
 * Test AI Summaries - Batch 2 (Different Shipments)
 * Validates action system across different stages
 * Run: npx tsx scripts/debugging/test-action-summaries-batch2.ts
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

// NEW set of 10 shipments - different from batch 1
const TEST_SHIPMENTS = [
  { id: '8ff1df07-56cf-472a-bb3d-5360dc22c8d3', name: '21655350 - Hapag-Lloyd Norfolk (DELIVERED)' },
  { id: '155ef87b-9234-431e-98ab-c10604a10219', name: 'DFSU2701385 - Detroit (DELIVERED)' },
  { id: '42c3e690-2420-429b-94de-7340a2f63286', name: '261708626 - Highway Motor (ARRIVED)' },
  { id: 'c92a4ee8-0324-401b-bb37-56f9fe8f5315', name: '94480005 - Hapag Detroit (BL_ISSUED)' },
  { id: '70e6c4cd-b6ef-4b69-b4c1-f0b4e67ba995', name: '258950951 - Maersk NYC (BL_ISSUED)' },
  { id: 'b6c5208f-ca7c-4807-b5cb-a75bab75d414', name: 'CAD0851894 - Triways (DRAFT_BL)' },
  { id: 'bb825113-5ddf-4844-8719-8f77aaeca552', name: '263887918 - Maersk Bay Port (DRAFT_BL)' },
  { id: '65d097a3-ae76-44d0-96ed-3d8359d4efc4', name: '259874018 - Maersk (SI_STAGE)' },
  { id: 'd661247f-b478-4525-908b-50268bdc5ac3', name: '2038394460 - OOCL Savannah (SI_STAGE)' },
  { id: '2ae9258e-8d8e-4d36-b844-15683a32c0ee', name: '2038256270 - OOCL NYC (DELIVERED - invoices)' },
];

const SYSTEM_PROMPT = `You are a freight forwarding operations analyst at Intoglo, an NVOCC.
Analyze shipment communications and provide actionable intelligence.

CRITICAL RULES:
1. If shipment stage is DELIVERED, the shipment is COMPLETE - only financial actions (invoices, payments) should be pending
2. Historical issues that were resolved should NOT be listed as current blockers
3. Match blocker severity to stage: DELIVERED = no operational blockers, only financial
4. Be specific about what's ACTUALLY pending vs what HAPPENED in the past

OUTPUT FORMAT (strict JSON):
{
  "story": "2-3 sentence narrative of shipment journey",
  "currentBlocker": "What's stopping progress NOW (null if none)",
  "blockerOwner": "Who must act: carrier|trucker|customs|customer|intoglo|null",
  "blockerType": "financial|documentation|operational|null",
  "nextAction": "Specific action needed",
  "actionOwner": "Who should do it",
  "actionPriority": "critical|high|medium|low",
  "financialImpact": "Any costs incurred or at risk",
  "customerImpact": "How customer is affected",
  "riskLevel": "red|amber|green",
  "riskReason": "Why this risk level",
  "pendingActions": [{"action": "description", "owner": "who", "priority": "level"}]
}`;

interface ChronicleEntry {
  occurred_at: string;
  direction: string;
  from_party: string;
  document_type: string;
  summary: string;
  has_action: boolean;
  action_type: string | null;
  action_completed_at: string | null;
}

async function generateSummary(shipmentId: string) {
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  if (!shipment) return { error: 'Shipment not found' };

  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('occurred_at, direction, from_party, document_type, summary, has_action, action_type, action_completed_at')
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false })
    .limit(30);

  if (!chronicles || chronicles.length === 0) return { error: 'No chronicles' };

  const pendingActions = chronicles.filter((c: ChronicleEntry) => c.has_action && !c.action_completed_at);
  const completedActions = chronicles.filter((c: ChronicleEntry) => c.has_action && c.action_completed_at);

  // Group pending by document type
  const pendingByType: Record<string, number> = {};
  for (const a of pendingActions) {
    pendingByType[a.document_type] = (pendingByType[a.document_type] || 0) + 1;
  }

  const formatted = chronicles.map((e: ChronicleEntry) => {
    const date = new Date(e.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const status = e.has_action ? (e.action_completed_at ? ' [DONE]' : ' [PENDING]') : '';
    return `${date} ${e.from_party} (${e.document_type}): ${e.summary}${status}`;
  }).join('\n');

  const userPrompt = `SHIPMENT INFO:
- Booking: ${shipment.booking_number || 'N/A'}
- Route: ${shipment.port_of_loading || '?'} → ${shipment.port_of_discharge || '?'}
- Stage: ${shipment.stage} (CURRENT STATUS - important for context)
- Carrier: ${shipment.carrier_name || 'N/A'}
- ETA: ${shipment.eta || 'N/A'}

ACTION STATUS:
- Pending Actions: ${pendingActions.length}
- Completed Actions: ${completedActions.length}
- Pending by Type: ${JSON.stringify(pendingByType)}

COMMUNICATIONS (most recent first):
${formatted}

Provide JSON summary:`;

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
    pendingActions: pendingActions.length,
    completedActions: completedActions.length,
    pendingByType,
    summary,
    cost,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('🧪 AI SUMMARY TEST - BATCH 2 (Different Shipments)');
  console.log('='.repeat(100));

  let totalCost = 0;
  let successCount = 0;

  for (let i = 0; i < TEST_SHIPMENTS.length; i++) {
    const test = TEST_SHIPMENTS[i];
    console.log('\n' + '─'.repeat(100));
    console.log(`📦 [${i + 1}/${TEST_SHIPMENTS.length}] ${test.name}`);
    console.log('─'.repeat(100));

    try {
      const result = await generateSummary(test.id);

      if (result.error) {
        console.log(`\n❌ ERROR: ${result.error}`);
        continue;
      }

      successCount++;
      totalCost += result.cost;

      console.log(`\n📊 SHIPMENT: ${result.shipment.booking_number || 'N/A'}`);
      console.log(`   Route: ${result.shipment.port_of_loading} → ${result.shipment.port_of_discharge}`);
      console.log(`   Stage: ${result.shipment.stage} | Carrier: ${result.shipment.carrier_name}`);

      console.log(`\n📋 ACTIONS: Pending=${result.pendingActions} | Completed=${result.completedActions}`);
      console.log(`   By Type: ${JSON.stringify(result.pendingByType)}`);

      const s = result.summary;
      console.log(`\n📖 STORY: ${s.story || 'N/A'}`);
      console.log(`\n🚧 BLOCKER: ${s.currentBlocker || 'None'}`);
      if (s.blockerOwner) console.log(`   Owner: ${s.blockerOwner} | Type: ${s.blockerType || 'N/A'}`);
      console.log(`\n⚡ NEXT ACTION: ${s.nextAction || 'None'}`);
      if (s.actionOwner) console.log(`   Owner: ${s.actionOwner} | Priority: ${s.actionPriority || 'N/A'}`);
      console.log(`\n💰 FINANCIAL: ${s.financialImpact || 'None'}`);
      console.log(`\n🚦 RISK: ${(s.riskLevel || 'N/A').toUpperCase()}`);
      console.log(`   Reason: ${s.riskReason || 'N/A'}`);

      // Validate stage-appropriateness
      const isDelivered = result.shipment.stage === 'DELIVERED';
      const hasNonFinancialBlocker = s.blockerType && s.blockerType !== 'financial';
      if (isDelivered && hasNonFinancialBlocker) {
        console.log(`\n⚠️  WARNING: DELIVERED shipment has non-financial blocker!`);
      } else if (isDelivered && !s.currentBlocker) {
        console.log(`\n✅ VALIDATED: DELIVERED with no operational blocker`);
      } else if (isDelivered && s.blockerType === 'financial') {
        console.log(`\n✅ VALIDATED: DELIVERED with only financial blocker`);
      }

    } catch (error) {
      console.log(`\n❌ EXCEPTION: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('📊 SUMMARY');
  console.log('='.repeat(100));
  console.log(`✅ Success: ${successCount}/${TEST_SHIPMENTS.length}`);
  console.log(`💰 Total Cost: $${totalCost.toFixed(4)}`);
  console.log('='.repeat(100));
}

main().catch(console.error);
