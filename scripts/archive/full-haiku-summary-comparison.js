require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The actual system prompt from HaikuSummaryService
const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).

Your job: Transform raw shipment data into a clear, actionable narrative.

## YOUR AUDIENCE
- Operations Manager: "What do I need to do TODAY?"
- Customer Success: "What should I tell the customer?"
- Finance: "What costs are at risk?"
- Executive: "Is this shipment healthy?"

## OUTPUT FORMAT
Return a JSON object with these fields:
{
  "story": "2-3 sentence narrative of shipment status",
  "narrative": "One tight paragraph with key intelligence",
  "currentBlocker": "What's blocking progress (or null)",
  "blockerOwner": "Who owns the blocker",
  "blockerType": "external_dependency or internal_task",
  "nextAction": "Most urgent action needed",
  "actionOwner": "Who should do it",
  "actionContact": "Contact email if available",
  "actionPriority": "critical/high/medium/low",
  "financialImpact": "Dollar amount at risk (or null)",
  "customerImpact": "How this affects the customer",
  "customerActionRequired": true/false,
  "riskLevel": "red/amber/green",
  "riskReason": "Why this risk level"
}`;

async function fullHaikuComparison() {
  // Find a good shipment with diverse data
  const { data: candidates } = await supabase
    .from('chronicle')
    .select('shipment_id, action_owner')
    .eq('action_source', 'template')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null)
    .limit(200);

  // Find one with multiple owners
  const ownersByShipment = {};
  for (const c of candidates || []) {
    if (!ownersByShipment[c.shipment_id]) ownersByShipment[c.shipment_id] = new Set();
    ownersByShipment[c.shipment_id].add(c.action_owner || 'operations');
  }

  const shipmentId = Object.entries(ownersByShipment)
    .sort((a, b) => b[1].size - a[1].size)[0]?.[0];

  if (!shipmentId) {
    console.log('No shipments found');
    return;
  }

  // Get full shipment context
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  // Get ALL chronicle entries for context (like HaikuSummaryService does)
  const { data: allChronicles } = await supabase
    .from('chronicle')
    .select(`
      occurred_at, direction, from_party, from_address, message_type, summary,
      has_issue, issue_type, issue_description,
      has_action, action_description, action_priority, action_deadline, action_completed_at,
      carrier_name, sentiment, document_type,
      action_type, action_verb, action_owner, action_deadline_source, action_auto_resolve_on
    `)
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false })
    .limit(15);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         FULL HAIKU SUMMARY SERVICE: BEFORE vs AFTER                                            ║');
  console.log('║                         Complete AI Summary Output Comparison                                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Shipment:', shipment?.booking_number || shipmentId);
  console.log('  Stage:', shipment?.stage || 'PENDING');
  console.log('  Carrier:', shipment?.carrier_name || 'N/A');
  console.log('  Route:', (shipment?.port_of_loading || '?') + ' → ' + (shipment?.port_of_discharge || '?'));
  console.log('  ETD:', shipment?.etd ? new Date(shipment.etd).toLocaleDateString() : 'N/A');
  console.log('  ETA:', shipment?.eta ? new Date(shipment.eta).toLocaleDateString() : 'N/A');
  console.log('');

  // ====================================================================================
  // BEFORE: Old prompt format (without PreciseActionService fields)
  // ====================================================================================
  console.log('');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('▓▓                                              BEFORE                                                         ▓▓');
  console.log('▓▓                               (Old HaikuSummaryService prompt format)                                       ▓▓');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');

  // Build OLD prompt (simple format without precise action fields)
  const oldRecentSection = allChronicles.slice(0, 10).map(c => {
    const date = new Date(c.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dir = c.direction === 'inbound' ? '←' : '→';
    const party = c.carrier_name || c.from_party || 'unknown';
    const issue = c.has_issue ? ` [ISSUE: ${c.issue_type}]` : '';
    // OLD: Only had basic action info
    const action = c.has_action && !c.action_completed_at
      ? ` [ACTION: ${c.action_description?.slice(0, 30)}]`
      : '';
    return `${date} ${dir} ${party}: ${c.summary?.slice(0, 50)}${issue}${action}`;
  }).join('\n');

  // OLD pending actions format (flat list, no grouping, no precise fields)
  const oldPendingActions = allChronicles
    .filter(c => c.has_action && !c.action_completed_at)
    .slice(0, 5)
    .map(c => {
      const priority = c.action_priority || 'MEDIUM';
      const deadline = c.action_deadline ? formatSimple(c.action_deadline) : 'no deadline';
      return `- [${priority}] ${c.action_description || 'Review document'} (${deadline})`;
    }).join('\n');

  const oldPrompt = `## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment?.booking_number || 'N/A'}
MBL: ${shipment?.mbl_number || 'N/A'}
Route: ${shipment?.port_of_loading || '?'} → ${shipment?.port_of_discharge || '?'}
Carrier: ${shipment?.carrier_name || 'N/A'}
Stage: ${shipment?.stage || 'PENDING'}
ETD: ${shipment?.etd ? formatWithDays(shipment.etd) : 'N/A'}
ETA: ${shipment?.eta ? formatWithDays(shipment.eta) : 'N/A'}

## RECENT ACTIVITY (Last 7 Days)
${oldRecentSection}

## PENDING ACTIONS
${oldPendingActions || '(none)'}

Generate a comprehensive JSON summary.`;

  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ OLD PROMPT (sent to AI)                                                                                       │');
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(oldPrompt.split('\n').map(l => '  ' + l).join('\n'));
  console.log('');

  // Call AI with OLD prompt
  console.log('  Calling AI with OLD prompt...');
  const oldResp = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: oldPrompt }],
  });

  const oldText = oldResp.content[0].type === 'text' ? oldResp.content[0].text : '';
  let oldJson = {};
  try {
    oldJson = JSON.parse(oldText.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (e) {
    oldJson = { error: 'Parse failed', raw: oldText.substring(0, 200) };
  }

  console.log('');
  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ AI OUTPUT (BEFORE) - Full HaikuSummary Response                                                               │');
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  story:');
  console.log('    "' + (oldJson.story || 'N/A') + '"');
  console.log('');
  console.log('  narrative:');
  console.log('    "' + (oldJson.narrative || 'N/A') + '"');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ BLOCKER                                                                                                    │');
  console.log('  │   currentBlocker: ' + JSON.stringify(oldJson.currentBlocker || null).padEnd(70) + '│');
  console.log('  │   blockerOwner: ' + JSON.stringify(oldJson.blockerOwner || null).padEnd(72) + '│');
  console.log('  │   blockerType: ' + JSON.stringify(oldJson.blockerType || null).padEnd(73) + '│');
  console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ ACTION                                                                                                     │');
  console.log('  │   nextAction: ' + JSON.stringify(oldJson.nextAction || null).substring(0, 70).padEnd(75) + '│');
  console.log('  │   actionOwner: ' + JSON.stringify(oldJson.actionOwner || null).padEnd(74) + '│');
  console.log('  │   actionContact: ' + JSON.stringify(oldJson.actionContact || null).padEnd(71) + '│');
  console.log('  │   actionPriority: ' + JSON.stringify(oldJson.actionPriority || null).padEnd(70) + '│');
  console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ RISK & IMPACT                                                                                              │');
  console.log('  │   riskLevel: ' + JSON.stringify(oldJson.riskLevel || null).padEnd(76) + '│');
  console.log('  │   riskReason: ' + JSON.stringify(oldJson.riskReason || null).substring(0, 70).padEnd(75) + '│');
  console.log('  │   financialImpact: ' + JSON.stringify(oldJson.financialImpact || null).padEnd(69) + '│');
  console.log('  │   customerImpact: ' + JSON.stringify(oldJson.customerImpact || null).substring(0, 65).padEnd(70) + '│');
  console.log('  │   customerActionRequired: ' + JSON.stringify(oldJson.customerActionRequired || false).padEnd(62) + '│');
  console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // ====================================================================================
  // AFTER: New prompt format (with PreciseActionService fields)
  // ====================================================================================
  console.log('');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('▓▓                                              AFTER                                                          ▓▓');
  console.log('▓▓                              (New HaikuSummaryService with PreciseActionService)                            ▓▓');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');

  // Build NEW prompt with precise action fields
  const newRecentSection = allChronicles.slice(0, 10).map(c => {
    const date = new Date(c.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dir = c.direction === 'inbound' ? '←' : '→';
    const party = c.carrier_name || c.from_party || 'unknown';
    const issue = c.has_issue ? ` [ISSUE: ${c.issue_type}]` : '';
    // NEW: Include precise action info
    const action = c.has_action && !c.action_completed_at
      ? ` [ACTION: ${c.action_verb || 'Review'} - ${c.action_owner || 'ops'}${c.action_deadline ? ' by ' + new Date(c.action_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}]`
      : '';
    return `${date} ${dir} ${party}: ${c.summary?.slice(0, 50)}${issue}${action}`;
  }).join('\n');

  // NEW: Group pending actions by owner
  const pendingActions = allChronicles.filter(c => c.has_action && !c.action_completed_at);
  const byOwner = {};
  for (const a of pendingActions) {
    const owner = a.action_owner || 'operations';
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(a);
  }

  const newActionsSection = Object.entries(byOwner).map(([owner, actions]) => {
    const actionLines = actions.slice(0, 3).map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const verb = a.action_verb || 'Review';
      const deadline = a.action_deadline ? formatDetailed(a.action_deadline) : 'no deadline';
      const deadlineReason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
      const contact = a.from_address ? `\n    Contact: ${a.from_address}` : '';
      const autoResolve = a.action_auto_resolve_on?.length > 0
        ? `\n    Auto-resolves when: ${a.action_auto_resolve_on.join(', ')}`
        : '';
      return `  - [${priority}] ${verb}: ${a.action_description?.substring(0, 50)}
    Type: ${a.action_type || 'review'} | Deadline: ${deadline}${deadlineReason}${contact}${autoResolve}`;
    }).join('\n\n');

    return `### ${owner.toUpperCase()} TEAM (${actions.length} action${actions.length > 1 ? 's' : ''})\n${actionLines}`;
  }).join('\n\n');

  const newPrompt = `## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment?.booking_number || 'N/A'}
MBL: ${shipment?.mbl_number || 'N/A'}
Route: ${shipment?.port_of_loading || '?'} → ${shipment?.port_of_discharge || '?'}
Carrier: ${shipment?.carrier_name || 'N/A'}
Stage: ${shipment?.stage || 'PENDING'}
ETD: ${shipment?.etd ? formatWithDays(shipment.etd) : 'N/A'}
ETA: ${shipment?.eta ? formatWithDays(shipment.eta) : 'N/A'}

## RECENT ACTIVITY (Last 7 Days)
${newRecentSection}

## PENDING ACTIONS BY OWNER
${newActionsSection || '(none)'}

Generate a comprehensive JSON summary. The actionOwner MUST be one of: ${Object.keys(byOwner).join(', ')}.`;

  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ NEW PROMPT (sent to AI)                                                                                       │');
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(newPrompt.split('\n').map(l => '  ' + l).join('\n'));
  console.log('');

  // Call AI with NEW prompt
  console.log('  Calling AI with NEW prompt...');
  const newResp = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: newPrompt }],
  });

  const newText = newResp.content[0].type === 'text' ? newResp.content[0].text : '';
  let newJson = {};
  try {
    newJson = JSON.parse(newText.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (e) {
    newJson = { error: 'Parse failed', raw: newText.substring(0, 200) };
  }

  console.log('');
  console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ AI OUTPUT (AFTER) - Full HaikuSummary Response                                                                │');
  console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  story:');
  console.log('    "' + (newJson.story || 'N/A') + '"');
  console.log('');
  console.log('  narrative:');
  console.log('    "' + (newJson.narrative || 'N/A') + '"');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ BLOCKER                                                                                                    │');
  console.log('  │   currentBlocker: ' + JSON.stringify(newJson.currentBlocker || null).padEnd(70) + '│');
  console.log('  │   blockerOwner: ' + JSON.stringify(newJson.blockerOwner || null).padEnd(72) + '│');
  console.log('  │   blockerType: ' + JSON.stringify(newJson.blockerType || null).padEnd(73) + '│');
  console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ ACTION                                                                                                     │');
  console.log('  │   nextAction: ' + JSON.stringify(newJson.nextAction || null).substring(0, 70).padEnd(75) + '│');
  console.log('  │   actionOwner: ' + JSON.stringify(newJson.actionOwner || null).padEnd(74) + '│');
  console.log('  │   actionContact: ' + JSON.stringify(newJson.actionContact || null).padEnd(71) + '│');
  console.log('  │   actionPriority: ' + JSON.stringify(newJson.actionPriority || null).padEnd(70) + '│');
  console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ RISK & IMPACT                                                                                              │');
  console.log('  │   riskLevel: ' + JSON.stringify(newJson.riskLevel || null).padEnd(76) + '│');
  console.log('  │   riskReason: ' + JSON.stringify(newJson.riskReason || null).substring(0, 70).padEnd(75) + '│');
  console.log('  │   financialImpact: ' + JSON.stringify(newJson.financialImpact || null).padEnd(69) + '│');
  console.log('  │   customerImpact: ' + JSON.stringify(newJson.customerImpact || null).substring(0, 65).padEnd(70) + '│');
  console.log('  │   customerActionRequired: ' + JSON.stringify(newJson.customerActionRequired || false).padEnd(62) + '│');
  console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // ====================================================================================
  // SIDE BY SIDE COMPARISON
  // ====================================================================================
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                        SIDE-BY-SIDE COMPARISON                                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('┌─────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┐');
  console.log('│                   BEFORE                        │                        AFTER                                 │');
  console.log('├─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤');
  console.log('│ actionOwner: ' + (oldJson.actionOwner || 'N/A').substring(0, 30).padEnd(34) + '│ actionOwner: ' + (newJson.actionOwner || 'N/A').substring(0, 40).padEnd(45) + '│');
  console.log('│ (AI guessed from context)                       │ (From template: action_owner field)                          │');
  console.log('├─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤');
  console.log('│ actionContact: ' + (oldJson.actionContact || 'null').substring(0, 28).padEnd(32) + '│ actionContact: ' + (newJson.actionContact || 'null').substring(0, 38).padEnd(43) + '│');
  console.log('│ (AI had no contact info)                        │ (From template: from_address field)                          │');
  console.log('├─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤');
  console.log('│ nextAction: Generic description                 │ nextAction: Precise verb from template                       │');
  console.log('├─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤');
  console.log('│ Pending actions: flat list                      │ Pending actions: grouped by owner team                       │');
  console.log('│ No deadline reason                              │ Deadline with reason (e.g., "1 day from receipt")            │');
  console.log('│ No auto-resolve info                            │ Auto-resolve triggers shown                                  │');
  console.log('└─────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┘');
  console.log('');

  // Token/cost comparison
  console.log('  Cost comparison:');
  console.log('    BEFORE: ' + oldResp.usage.input_tokens + ' input + ' + oldResp.usage.output_tokens + ' output = $' + ((oldResp.usage.input_tokens * 0.80 + oldResp.usage.output_tokens * 4) / 1_000_000).toFixed(6));
  console.log('    AFTER:  ' + newResp.usage.input_tokens + ' input + ' + newResp.usage.output_tokens + ' output = $' + ((newResp.usage.input_tokens * 0.80 + newResp.usage.output_tokens * 4) / 1_000_000).toFixed(6));
  console.log('');
}

function formatSimple(dateStr) {
  const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'in ' + diff + ' days';
}

function formatDetailed(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const diff = Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${formatted} (OVERDUE by ${Math.abs(diff)} days)`;
  if (diff === 0) return `${formatted} (TODAY)`;
  if (diff === 1) return `${formatted} (TOMORROW)`;
  return `${formatted} (in ${diff} days)`;
}

function formatWithDays(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const diff = Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${formatted} (${Math.abs(diff)}d ago)`;
  if (diff === 0) return `${formatted} (TODAY)`;
  return `${formatted} (${diff}d)`;
}

fullHaikuComparison().catch(console.error);
