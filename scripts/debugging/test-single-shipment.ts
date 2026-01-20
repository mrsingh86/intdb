/**
 * Test AI Summary for single shipment after fixes
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

const SYSTEM_PROMPT = `You are a freight forwarding operations analyst at Intoglo, an NVOCC.
Analyze shipment communications and provide actionable intelligence.

CRITICAL RULES:
1. If shipment stage is DELIVERED, the shipment is COMPLETE - no operational blockers possible
2. Historical issues that were resolved should NOT be listed as current blockers
3. For DELIVERED shipments, only pending items are: invoice collection, documentation filing
4. Be specific about what's ACTUALLY pending vs what HAPPENED in the past

OUTPUT FORMAT (strict JSON):
{
  "story": "2-3 sentence narrative INCLUDING current status and key events",
  "currentBlocker": "What's blocking progress NOW (null if delivered/none)",
  "blockerOwner": "Who must act",
  "nextAction": "Specific action needed",
  "actionOwner": "Who should do it",
  "actionPriority": "critical|high|medium|low",
  "financialImpact": "Costs incurred or pending",
  "riskLevel": "red|amber|green",
  "riskReason": "Why this level"
}`;

interface Chronicle {
  occurred_at: string;
  from_party: string;
  document_type: string;
  summary: string;
  has_action: boolean;
  action_completed_at: string | null;
}

async function main() {
  const bookingNumber = process.argv[2] || '260836706';

  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('booking_number', bookingNumber)
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('occurred_at, direction, from_party, document_type, summary, has_issue, issue_type, has_action, action_type, action_description, action_owner, action_completed_at')
    .eq('shipment_id', shipment.id)
    .order('occurred_at', { ascending: false })
    .limit(40);

  const pendingActions = (chronicles || []).filter((c: Chronicle) => c.has_action && c.action_completed_at === null);
  const completedActions = (chronicles || []).filter((c: Chronicle) => c.has_action && c.action_completed_at !== null);

  const formatted = (chronicles || []).map((e: Chronicle) => {
    const date = new Date(e.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const status = e.has_action ? (e.action_completed_at ? ' [DONE]' : ' [PENDING]') : '';
    return `${date} ${e.from_party} (${e.document_type}): ${e.summary}${status}`;
  }).join('\n');

  const prompt = `SHIPMENT INFO:
- Booking: ${shipment.booking_number}
- Route: ${shipment.port_of_loading} → ${shipment.port_of_discharge}
- Stage: ${shipment.stage} (IMPORTANT: This is the CURRENT status)
- Carrier: ${shipment.carrier_name}
- ETA: ${shipment.eta}

ACTION STATUS:
- Pending Actions: ${pendingActions.length}
- Completed Actions: ${completedActions.length}

RECENT COMMUNICATIONS (most recent first):
${formatted}

Provide JSON summary:`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const summary = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Parse failed' };

  console.log('=== REGENERATED AI SUMMARY FOR', bookingNumber, '===');
  console.log('Stage:', shipment.stage);
  console.log('Pending Actions:', pendingActions.length);
  console.log('Completed Actions:', completedActions.length);
  console.log('');
  console.log('📖 STORY:', summary.story);
  console.log('');
  console.log('🚧 BLOCKER:', summary.currentBlocker || 'None');
  if (summary.blockerOwner) console.log('   Owner:', summary.blockerOwner);
  console.log('');
  console.log('⚡ NEXT ACTION:', summary.nextAction || 'None');
  if (summary.actionOwner) console.log('   Owner:', summary.actionOwner, '| Priority:', summary.actionPriority);
  console.log('');
  console.log('💰 FINANCIAL:', summary.financialImpact || 'None');
  console.log('');
  console.log('🚦 RISK:', (summary.riskLevel || 'N/A').toUpperCase());
  console.log('   Reason:', summary.riskReason);
}

main().catch(console.error);
