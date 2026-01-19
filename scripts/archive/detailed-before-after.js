require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function detailedBeforeAfter() {
  // Find a good shipment with diverse actions
  const { data: candidates } = await supabase
    .from('chronicle')
    .select('shipment_id, action_owner')
    .eq('action_source', 'template')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null)
    .limit(100);

  // Find one with multiple owners
  const ownersByShipment = {};
  for (const c of candidates || []) {
    if (!ownersByShipment[c.shipment_id]) ownersByShipment[c.shipment_id] = new Set();
    ownersByShipment[c.shipment_id].add(c.action_owner || 'operations');
  }

  let shipmentId = Object.entries(ownersByShipment)
    .sort((a, b) => b[1].size - a[1].size)[0]?.[0];

  if (!shipmentId) {
    console.log('No shipments found');
    return;
  }

  // Get shipment details
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  // Get actions with ALL fields
  const { data: actions } = await supabase
    .from('chronicle')
    .select(`
      id, subject, document_type, from_party, from_address, occurred_at,
      has_action, action_description, action_priority, action_deadline,
      action_type, action_verb, action_owner, action_deadline_source, action_auto_resolve_on,
      action_source
    `)
    .eq('shipment_id', shipmentId)
    .eq('has_action', true)
    .is('action_completed_at', null)
    .order('action_deadline', { ascending: true, nullsLast: true })
    .limit(6);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           DETAILED BEFORE vs AFTER COMPARISON                                          ║');
  console.log('║                           HaikuSummaryService Enhancement                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Shipment:', shipment?.booking_number || shipmentId);
  console.log('Stage:', shipment?.stage || 'PENDING');
  console.log('Carrier:', shipment?.carrier_name || 'N/A');
  console.log('Route:', (shipment?.port_of_loading_code || '?') + ' → ' + (shipment?.port_of_discharge_code || '?'));
  console.log('');

  // ============================================================================
  // BEFORE: Old format without precise action fields
  // ============================================================================
  console.log('');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('▓▓                                        BEFORE                                                       ▓▓');
  console.log('▓▓                         (Without PreciseActionService fields)                                       ▓▓');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');

  // Build OLD prompt format (simple list, no owner grouping, no precise fields)
  const oldActionsSection = actions.map(a => {
    const priority = a.action_priority || 'MEDIUM';
    const deadline = a.action_deadline ? formatSimpleDeadline(a.action_deadline) : 'no deadline';
    // OLD: Only had generic action_description, no verb, no owner, no deadline reason
    return `- [${priority}] ${a.action_description || 'Review document'} (${deadline})`;
  }).join('\n');

  const oldPrompt = `## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment?.booking_number || 'N/A'}
Route: ${shipment?.port_of_loading_code || '?'} → ${shipment?.port_of_discharge_code || '?'}
Stage: ${shipment?.stage || 'PENDING'}
Carrier: ${shipment?.carrier_name || 'N/A'}

## PENDING ACTIONS
${oldActionsSection}

Based on the above, generate a JSON summary:
{
  "story": "2-3 sentence summary",
  "nextAction": "Most urgent action",
  "actionOwner": "Who should do it",
  "actionPriority": "critical/high/medium/low",
  "riskLevel": "red/amber/green"
}
Return ONLY valid JSON.`;

  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ OLD PROMPT FORMAT (what AI received BEFORE)                                                            │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(oldPrompt.split('\n').map(l => '  ' + l).join('\n'));
  console.log('');

  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PROBLEMS WITH OLD FORMAT:                                                                              │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ ✗ No action owner → AI had to GUESS (usually said "operations")                                        │');
  console.log('│ ✗ No action type → AI didn\'t know if it\'s review/share/process/pay                                     │');
  console.log('│ ✗ No deadline reason → AI didn\'t know WHY the deadline                                                  │');
  console.log('│ ✗ No contact info → AI couldn\'t mention who to contact                                                  │');
  console.log('│ ✗ No auto-resolve → AI didn\'t know what closes the action                                               │');
  console.log('│ ✗ Flat list → AI couldn\'t prioritize by team                                                            │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Call AI with OLD prompt
  console.log('Calling AI with OLD prompt...');
  const oldResponse = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 400,
    messages: [{ role: 'user', content: oldPrompt }],
  });

  const oldText = oldResponse.content[0].type === 'text' ? oldResponse.content[0].text : '';
  const oldJson = JSON.parse(oldText.match(/\{[\s\S]*\}/)?.[0] || '{}');

  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ AI OUTPUT (BEFORE)                                                                                     │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  story:', oldJson.story);
  console.log('');
  console.log('  nextAction:', oldJson.nextAction);
  console.log('  actionOwner:', oldJson.actionOwner, '  ← AI had to GUESS');
  console.log('  actionPriority:', oldJson.actionPriority);
  console.log('  riskLevel:', oldJson.riskLevel);
  console.log('');

  // ============================================================================
  // AFTER: New format with precise action fields
  // ============================================================================
  console.log('');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('▓▓                                         AFTER                                                       ▓▓');
  console.log('▓▓                          (With PreciseActionService fields)                                         ▓▓');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');

  // Group actions by owner (NEW)
  const byOwner = {};
  for (const a of actions) {
    const owner = a.action_owner || 'operations';
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(a);
  }

  // Build NEW prompt format with all precise fields
  const ownerSections = Object.entries(byOwner).map(([owner, ownerActions]) => {
    const actionLines = ownerActions.map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const actionType = a.action_type || 'review';
      const verb = a.action_verb || 'Review';
      const deadline = a.action_deadline ? formatDetailedDeadline(a.action_deadline) : 'no deadline';
      const deadlineReason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
      const contact = a.from_address ? `\n    Contact: ${a.from_address}` : '';
      const autoResolve = a.action_auto_resolve_on && a.action_auto_resolve_on.length > 0
        ? `\n    Auto-resolves when: ${a.action_auto_resolve_on.join(', ')}`
        : '';

      return `  - [${priority}] ${verb}: ${a.action_description}
    Type: ${actionType} | Deadline: ${deadline}${deadlineReason}${contact}${autoResolve}`;
    }).join('\n\n');

    return `### ${owner.toUpperCase()} TEAM (${ownerActions.length} action${ownerActions.length > 1 ? 's' : ''})\n${actionLines}`;
  }).join('\n\n');

  const newPrompt = `## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment?.booking_number || 'N/A'}
Route: ${shipment?.port_of_loading_code || '?'} → ${shipment?.port_of_discharge_code || '?'}
Stage: ${shipment?.stage || 'PENDING'}
Carrier: ${shipment?.carrier_name || 'N/A'}

## PENDING ACTIONS BY OWNER
${ownerSections}

Based on the above, generate a JSON summary:
{
  "story": "2-3 sentence summary mentioning which teams need to act",
  "nextAction": "Most urgent action with the verb",
  "actionOwner": "Which team (MUST be one of: ${Object.keys(byOwner).join(', ')})",
  "actionPriority": "critical/high/medium/low",
  "riskLevel": "red/amber/green"
}
Return ONLY valid JSON.`;

  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ NEW PROMPT FORMAT (what AI receives AFTER)                                                             │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(newPrompt.split('\n').map(l => '  ' + l).join('\n'));
  console.log('');

  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ IMPROVEMENTS IN NEW FORMAT:                                                                            │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ ✓ action_owner → AI knows EXACTLY which team (operations, finance, sales, customs)                     │');
  console.log('│ ✓ action_type → AI knows the nature (review, share, process, pay, respond)                             │');
  console.log('│ ✓ action_verb → AI uses precise language ("Share SWB" not "Review document")                           │');
  console.log('│ ✓ deadline_source → AI explains WHY deadline ("1 day from receipt", "before cutoff")                   │');
  console.log('│ ✓ from_address → AI can mention contact for follow-up                                                  │');
  console.log('│ ✓ auto_resolve_on → AI knows what events close the action                                              │');
  console.log('│ ✓ Grouped by owner → AI can prioritize by team workload                                                │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Call AI with NEW prompt
  console.log('Calling AI with NEW prompt...');
  const newResponse = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 400,
    messages: [{ role: 'user', content: newPrompt }],
  });

  const newText = newResponse.content[0].type === 'text' ? newResponse.content[0].text : '';
  const newJson = JSON.parse(newText.match(/\{[\s\S]*\}/)?.[0] || '{}');

  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ AI OUTPUT (AFTER)                                                                                      │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  story:', newJson.story);
  console.log('');
  console.log('  nextAction:', newJson.nextAction);
  console.log('  actionOwner:', newJson.actionOwner, '  ← AI read from template data');
  console.log('  actionPriority:', newJson.actionPriority);
  console.log('  riskLevel:', newJson.riskLevel);
  console.log('');

  // ============================================================================
  // Side-by-side comparison
  // ============================================================================
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                    SIDE-BY-SIDE COMPARISON                                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('┌───────────────────────────────────────────┬────────────────────────────────────────────────────────────┐');
  console.log('│              BEFORE                       │                        AFTER                               │');
  console.log('├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┤');
  console.log('│ actionOwner: ' + (oldJson.actionOwner || 'N/A').padEnd(27) + ' │ actionOwner: ' + (newJson.actionOwner || 'N/A').padEnd(44) + ' │');
  console.log('│ (AI guessed)                              │ (From template: action_owner field)                        │');
  console.log('├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┤');
  console.log('│ nextAction: Generic description           │ nextAction: Precise verb + description                     │');
  console.log('│ "' + (oldJson.nextAction || '').substring(0, 35).padEnd(35) + '"   │ "' + (newJson.nextAction || '').substring(0, 52).padEnd(52) + '"   │');
  console.log('├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┤');
  console.log('│ No deadline reason                        │ Deadline with reason: "1 day from receipt"                 │');
  console.log('│ No contact info                           │ Contact: from_address field available                      │');
  console.log('│ No auto-resolve info                      │ Auto-resolves: acknowledgement, final_bl, etc.             │');
  console.log('└───────────────────────────────────────────┴────────────────────────────────────────────────────────────┘');
  console.log('');

  // Show the raw data difference
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              RAW DATABASE FIELDS COMPARISON                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const sample = actions[0];
  console.log('  Sample chronicle record:');
  console.log('  ─────────────────────────');
  console.log('');
  console.log('  BEFORE (only had these fields):');
  console.log('    action_description: "' + (sample.action_description || 'N/A') + '"');
  console.log('    action_priority: "' + (sample.action_priority || 'N/A') + '"');
  console.log('    action_deadline: "' + (sample.action_deadline || 'N/A') + '"');
  console.log('');
  console.log('  AFTER (now has these NEW fields from PreciseActionService):');
  console.log('    action_type: "' + (sample.action_type || 'N/A') + '"              ← NEW: Type of action');
  console.log('    action_verb: "' + (sample.action_verb || 'N/A') + '"           ← NEW: Short UI label');
  console.log('    action_owner: "' + (sample.action_owner || 'N/A') + '"          ← NEW: Which team');
  console.log('    action_deadline_source: "' + (sample.action_deadline_source || 'N/A') + '"  ← NEW: Why this deadline');
  console.log('    action_auto_resolve_on: ' + JSON.stringify(sample.action_auto_resolve_on || []) + '  ← NEW: What closes it');
  console.log('');
  console.log('  Cost comparison:');
  console.log('    BEFORE: $' + ((oldResponse.usage.input_tokens * 0.80 + oldResponse.usage.output_tokens * 4) / 1_000_000).toFixed(6));
  console.log('    AFTER:  $' + ((newResponse.usage.input_tokens * 0.80 + newResponse.usage.output_tokens * 4) / 1_000_000).toFixed(6));
  console.log('    (Slightly higher due to richer prompt, but much better output quality)');
  console.log('');
}

function formatSimpleDeadline(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return 'in ' + diffDays + ' days';
}

function formatDetailedDeadline(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${formatted} (OVERDUE by ${Math.abs(diffDays)} days)`;
  if (diffDays === 0) return `${formatted} (TODAY)`;
  if (diffDays === 1) return `${formatted} (TOMORROW)`;
  return `${formatted} (in ${diffDays} days)`;
}

detailedBeforeAfter().catch(console.error);
