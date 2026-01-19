/**
 * Regenerate AI summary for shipment 41498257 to verify the fix
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).

Your job: Transform raw shipment data into a clear, actionable narrative.

## STORYTELLING RULES

1. **BE SPECIFIC** - Use actual names, dates, amounts
2. **DERIVE URGENCY FROM DATES** - Even without new emails
3. **IDENTIFY THE BLOCKER** - What's stopping progress RIGHT NOW
4. **QUANTIFY IMPACT** - Make stakes concrete
5. **ASSIGN OWNERSHIP** - Who needs to act

## OUTPUT FORMAT (strict JSON)

{
  "story": "3-4 sentence narrative with specific names, dates, and current state",
  "currentBlocker": "What's stopping progress NOW (null if none)",
  "blockerOwner": "Who owns the blocker: [specific company/party name]|intoglo|null",
  "nextAction": "Specific action with deadline",
  "actionOwner": "Who should act: intoglo|customer|[specific party name]",
  "actionPriority": "critical|high|medium|low",
  "riskLevel": "red|amber|green",
  "riskReason": "One line: why this risk level"
}

Return ONLY valid JSON.`;

async function main() {
  // Get shipment
  const { data: shipment, error } = await supabase
    .from('shipments')
    .select(`
      id, booking_number, mbl_number,
      port_of_loading_code, port_of_discharge_code,
      vessel_name, voyage_number, carrier_name,
      etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff,
      stage, shipper_name, consignee_name
    `)
    .eq('booking_number', '41498257')
    .single();

  if (error || !shipment) {
    console.error('Shipment not found:', error);
    return;
  }

  console.log('Shipment:', shipment.booking_number);

  // Get recent chronicles
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select(`
      occurred_at, direction, from_party, document_type, summary,
      has_issue, issue_type,
      has_action, action_description, action_deadline, action_completed_at,
      carrier_name
    `)
    .eq('shipment_id', shipment.id)
    .gte('occurred_at', sevenDaysAgo)
    .order('occurred_at', { ascending: false })
    .limit(25);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A';

  // Build prompt
  const header = `
## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment.booking_number}
Route: ${shipment.port_of_loading_code || '?'} → ${shipment.port_of_discharge_code || '?'}
Vessel: ${shipment.vessel_name || 'TBD'} ${shipment.voyage_number ? `/ ${shipment.voyage_number}` : ''}
Carrier: ${shipment.carrier_name || 'N/A'}
Stage: ${shipment.stage || 'PENDING'}
Shipper: ${shipment.shipper_name || 'N/A'}
Consignee: ${shipment.consignee_name || 'N/A'}`;

  const schedule = `
## CRITICAL DATES
ETD: ${formatDate(shipment.etd)}
ETA: ${formatDate(shipment.eta)}
SI Cutoff: ${formatDate(shipment.si_cutoff)}
VGM Cutoff: ${formatDate(shipment.vgm_cutoff)}
Cargo Cutoff: ${formatDate(shipment.cargo_cutoff)}`;

  // Build pending actions section
  const pendingActions = (chronicles || []).filter(c => c.has_action && !c.action_completed_at);
  let actionsSection = '';
  if (pendingActions.length > 0) {
    const actions = pendingActions.slice(0, 5).map(a => {
      const deadline = a.action_deadline ? formatDate(a.action_deadline) : 'no deadline';
      return `- ${a.action_description || 'Pending action'} (${deadline})`;
    }).join('\n');
    actionsSection = `\n## PENDING ACTIONS (${pendingActions.length} total)\n${actions}`;
  } else {
    actionsSection = `\n## PENDING ACTIONS\nNone`;
  }

  // Build recent activity
  const recentSection = (chronicles || []).slice(0, 10).map(c => {
    const date = formatDate(c.occurred_at);
    const issue = c.has_issue ? ` [ISSUE: ${c.issue_type}]` : '';
    const action = c.has_action && !c.action_completed_at ? ' [ACTION]' : '';
    const completed = c.has_action && c.action_completed_at ? ' [DONE]' : '';
    return `${date} | ${c.from_party}: ${c.summary?.slice(0, 60) || c.document_type}${issue}${action}${completed}`;
  }).join('\n');

  const userPrompt = `${header}${schedule}${actionsSection}

## RECENT ACTIVITY
${recentSection}

Analyze this shipment and return the JSON summary:`;

  console.log('\n--- PROMPT ---');
  console.log(userPrompt);
  console.log('\n--- END PROMPT ---\n');

  // Generate summary
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  console.log('═'.repeat(70));
  console.log('AI SUMMARY');
  console.log('═'.repeat(70));
  console.log(text);
  console.log('\nTokens:', response.usage.input_tokens, '/', response.usage.output_tokens);
}

main().catch(console.error);
