/**
 * Test Haiku-powered shipment summary generation
 *
 * Compares cost and quality vs Opus
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// =============================================================================
// OPTIMIZED PROMPT - Based on user requirements + data analysis + best practices
// =============================================================================

const SYSTEM_PROMPT = `You are a freight forwarding operations analyst at Intoglo, an NVOCC (Non-Vessel Operating Common Carrier).

Your job is to analyze shipment communication history and provide actionable intelligence for multiple stakeholders:
- Operations Manager: What actions need to happen TODAY
- Customer Success: What to proactively communicate to customers
- Finance: Cost implications (detention, demurrage, extra charges)
- Executive: High-level status and risk assessment

DOMAIN KNOWLEDGE:
- Stakeholders: ocean_carrier (shipping lines like Maersk, Hapag), trucker, customs_broker, shipper, consignee, nvocc, terminal, warehouse
- Issue types: delay, documentation, detention, demurrage, hold, payment, rollover, capacity, damage, shortage
- Key milestones: Booking → SI Submitted → BL Draft → BL Issued → Departed → Arrived → Customs Cleared → Delivered
- Cutoffs: SI cutoff, VGM cutoff, Cargo cutoff (missing these = rollover risk)
- Financial risks: Detention (container held), Demurrage (port storage), Per diem charges

OUTPUT FORMAT (strict):
Return a JSON object with these exact fields:
{
  "story": "2-3 sentence narrative of what happened from start to current state",
  "currentBlocker": "What's stopping progress RIGHT NOW (null if none)",
  "blockerOwner": "Who needs to act: carrier|trucker|customs|customer|intoglo|null",
  "nextAction": "Specific action needed with deadline if known",
  "actionOwner": "Who should do it",
  "actionPriority": "critical|high|medium|low",
  "financialImpact": "Any costs incurred or at risk (null if none)",
  "customerImpact": "How customer is affected (null if none)",
  "riskLevel": "red|amber|green",
  "riskReason": "Why this risk level"
}

Be concise. Focus on ACTIONABLE intelligence, not history narration.`;

const USER_PROMPT_TEMPLATE = `Analyze this shipment and provide the structured summary.

SHIPMENT INFO:
- Booking: {booking_number}
- Route: {origin} → {destination}
- Vessel: {vessel}
- ETD: {etd} | ETA: {eta}
- Current Stage: {stage}
- Shipper: {shipper}
- Consignee: {consignee}

COMMUNICATION HISTORY (most recent first):
{chronicle_entries}

Provide the JSON summary:`;

// =============================================================================
// FUNCTIONS
// =============================================================================

interface ChronicleEntry {
  occurred_at: string;
  direction: string;
  from_party: string;
  message_type: string;
  summary: string;
  has_issue: boolean;
  issue_type: string | null;
  issue_description: string | null;
  has_action: boolean;
  action_description: string | null;
  action_priority: string | null;
}

function formatChronicleForPrompt(entries: ChronicleEntry[]): string {
  return entries.map(e => {
    const date = new Date(e.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dir = e.direction === 'inbound' ? '←' : '→';
    const issue = e.has_issue ? ` [ISSUE: ${e.issue_type}]` : '';
    const action = e.has_action && e.action_description ? ` [ACTION: ${e.action_description}]` : '';
    return `${date} ${dir} ${e.from_party}: ${e.summary}${issue}${action}`;
  }).join('\n');
}

async function generateSummaryWithHaiku(
  shipment: Record<string, unknown>,
  chronicles: ChronicleEntry[]
): Promise<{ summary: Record<string, unknown>; inputTokens: number; outputTokens: number; cost: number }> {

  const userPrompt = USER_PROMPT_TEMPLATE
    .replace('{booking_number}', String(shipment.booking_number || shipment.mbl_number || 'N/A'))
    .replace('{origin}', String(shipment.port_of_loading || 'N/A'))
    .replace('{destination}', String(shipment.port_of_discharge || 'N/A'))
    .replace('{vessel}', String(shipment.vessel_name || 'N/A'))
    .replace('{etd}', String(shipment.etd || 'N/A'))
    .replace('{eta}', String(shipment.eta || 'N/A'))
    .replace('{stage}', String(shipment.stage || 'N/A'))
    .replace('{shipper}', String(shipment.shipper_name || 'N/A'))
    .replace('{consignee}', String(shipment.consignee_name || 'N/A'))
    .replace('{chronicle_entries}', formatChronicleForPrompt(chronicles));

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  });

  // Extract JSON from response
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  let summary: Record<string, unknown>;
  try {
    // Try to parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    summary = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Failed to parse', raw: text };
  } catch {
    summary = { error: 'JSON parse failed', raw: text };
  }

  // Calculate cost (Haiku pricing: $0.25/1M input, $1.25/1M output as of late 2024)
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = (inputTokens * 0.25 / 1_000_000) + (outputTokens * 1.25 / 1_000_000);

  return { summary, inputTokens, outputTokens, cost };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  // Test with 2 shipments
  const testShipments = [
    { id: '1cfb2a63-e53b-472f-b030-c81c02189ada', name: '13210347 (Houston chassis issue)' },
    { id: '1a3f589e-7fa6-4be5-856f-a98c51fb5589', name: '260836706 (Canada rail manifest)' },
  ];

  console.log('='.repeat(80));
  console.log('HAIKU-POWERED SHIPMENT SUMMARY TEST');
  console.log('='.repeat(80));

  let totalCost = 0;

  for (const test of testShipments) {
    console.log('\n' + '-'.repeat(80));
    console.log(`SHIPMENT: ${test.name}`);
    console.log('-'.repeat(80));

    // Get shipment details
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', test.id)
      .single();

    // Get chronicle entries (last 14 days, max 25)
    const { data: chronicles } = await supabase
      .from('chronicle')
      .select('occurred_at, direction, from_party, message_type, summary, has_issue, issue_type, issue_description, has_action, action_description, action_priority')
      .eq('shipment_id', test.id)
      .gte('occurred_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(25);

    if (!shipment || !chronicles) {
      console.log('  ERROR: Could not fetch data');
      continue;
    }

    console.log(`  Chronicle entries: ${chronicles.length}`);

    // Generate summary with Haiku
    const startTime = Date.now();
    const result = await generateSummaryWithHaiku(shipment, chronicles as ChronicleEntry[]);
    const elapsed = Date.now() - startTime;

    totalCost += result.cost;

    console.log(`  Time: ${elapsed}ms | Tokens: ${result.inputTokens} in, ${result.outputTokens} out | Cost: $${result.cost.toFixed(4)}`);
    console.log('\n  HAIKU OUTPUT:');
    console.log(JSON.stringify(result.summary, null, 2).split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`TOTAL COST FOR 2 SHIPMENTS: $${totalCost.toFixed(4)}`);
  console.log(`PROJECTED COST FOR 100 SHIPMENTS/DAY: $${(totalCost / 2 * 100).toFixed(2)}/day`);
  console.log('='.repeat(80));
}

main().catch(console.error);
