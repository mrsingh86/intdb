require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).
Transform shipment data into clear, actionable narrative.
Return JSON with: story, narrative, currentBlocker, blockerOwner, blockerType, nextAction, actionOwner, actionContact, actionPriority, financialImpact, customerImpact, customerActionRequired, riskLevel, riskReason`;

async function runSecondExample() {
  // Find a different shipment - one with finance actions
  const { data: financeShipments } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .eq('action_source', 'template')
    .eq('action_owner', 'finance')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null)
    .limit(50);

  const shipmentId = financeShipments?.[5]?.shipment_id || financeShipments?.[0]?.shipment_id;
  if (!shipmentId) {
    console.log('No shipments found');
    return;
  }

  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  const { data: chronicles } = await supabase
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
    .limit(12);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       SECOND EXAMPLE: Full HaikuSummary Before vs After                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Shipment:', shipment?.booking_number || shipmentId.substring(0, 8));
  console.log('  Stage:', shipment?.stage || 'N/A');
  console.log('  Carrier:', shipment?.carrier_name || 'N/A');
  console.log('');

  // ================== BEFORE ==================
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('▓▓                                 BEFORE                                        ▓▓');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');

  const oldPending = chronicles.filter(c => c.has_action && !c.action_completed_at).slice(0, 5);
  const oldActionsText = oldPending.map(a => {
    const priority = a.action_priority || 'MEDIUM';
    const deadline = a.action_deadline ? formatSimple(a.action_deadline) : 'no deadline';
    return `- [${priority}] ${a.action_description || 'Review'} (${deadline})`;
  }).join('\n');

  const oldPrompt = `Shipment: ${shipment?.booking_number || 'N/A'}
Stage: ${shipment?.stage || 'N/A'}
Carrier: ${shipment?.carrier_name || 'N/A'}

PENDING ACTIONS:
${oldActionsText}

Return comprehensive JSON summary.`;

  console.log('  OLD Pending Actions (flat list):');
  console.log(oldActionsText.split('\n').map(l => '    ' + l).join('\n'));
  console.log('');

  const oldResp = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: oldPrompt }],
  });

  const oldJson = JSON.parse((oldResp.content[0].text || '').match(/\{[\s\S]*\}/)?.[0] || '{}');

  console.log('  AI OUTPUT (BEFORE):');
  console.log('  ─────────────────────────────────────────────────────────────────────────────');
  console.log('  story:', (oldJson.story || 'N/A').substring(0, 100));
  console.log('');
  console.log('  nextAction:', oldJson.nextAction || 'N/A');
  console.log('  actionOwner:', oldJson.actionOwner || 'N/A', ' ← AI GUESSED');
  console.log('  actionContact:', oldJson.actionContact || 'null', ' ← NO DATA');
  console.log('  actionPriority:', oldJson.actionPriority || 'N/A');
  console.log('');
  console.log('  blockerOwner:', oldJson.blockerOwner || 'N/A');
  console.log('  riskLevel:', oldJson.riskLevel || 'N/A');
  console.log('');

  // ================== AFTER ==================
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('▓▓                                  AFTER                                        ▓▓');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');

  // Group by owner
  const byOwner = {};
  for (const a of oldPending) {
    const owner = a.action_owner || 'operations';
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(a);
  }

  const newActionsText = Object.entries(byOwner).map(([owner, actions]) => {
    const lines = actions.map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const verb = a.action_verb || 'Review';
      const deadline = a.action_deadline ? formatDetailed(a.action_deadline) : 'no deadline';
      const reason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
      const contact = a.from_address ? `\n      Contact: ${a.from_address}` : '';
      return `    - [${priority}] ${verb}: ${a.action_description?.substring(0, 45)}\n      Type: ${a.action_type || 'review'} | Deadline: ${deadline}${reason}${contact}`;
    }).join('\n\n');
    return `  ### ${owner.toUpperCase()} TEAM\n${lines}`;
  }).join('\n\n');

  console.log('  NEW Pending Actions (grouped by owner):');
  console.log(newActionsText);
  console.log('');

  const newPrompt = `Shipment: ${shipment?.booking_number || 'N/A'}
Stage: ${shipment?.stage || 'N/A'}
Carrier: ${shipment?.carrier_name || 'N/A'}

PENDING ACTIONS BY OWNER:
${newActionsText}

Return comprehensive JSON summary. actionOwner MUST be one of: ${Object.keys(byOwner).join(', ')}`;

  const newResp = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: newPrompt }],
  });

  const newJson = JSON.parse((newResp.content[0].text || '').match(/\{[\s\S]*\}/)?.[0] || '{}');

  console.log('  AI OUTPUT (AFTER):');
  console.log('  ─────────────────────────────────────────────────────────────────────────────');
  console.log('  story:', (newJson.story || 'N/A').substring(0, 100));
  console.log('');
  console.log('  nextAction:', newJson.nextAction || 'N/A');
  console.log('  actionOwner:', newJson.actionOwner || 'N/A', ' ← FROM TEMPLATE');
  console.log('  actionContact:', newJson.actionContact || 'null', ' ← FROM from_address');
  console.log('  actionPriority:', newJson.actionPriority || 'N/A');
  console.log('');
  console.log('  blockerOwner:', newJson.blockerOwner || 'N/A');
  console.log('  riskLevel:', newJson.riskLevel || 'N/A');
  console.log('');

  // ================== COMPARISON ==================
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  KEY DIFFERENCES');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  ┌─────────────────────────────────┬─────────────────────────────────────────┐');
  console.log('  │ BEFORE                          │ AFTER                                   │');
  console.log('  ├─────────────────────────────────┼─────────────────────────────────────────┤');
  console.log('  │ actionOwner: ' + (oldJson.actionOwner || 'N/A').substring(0, 17).padEnd(18) + '│ actionOwner: ' + (newJson.actionOwner || 'N/A').substring(0, 24).padEnd(25) + '│');
  console.log('  │ (guessed)                       │ (from template)                         │');
  console.log('  ├─────────────────────────────────┼─────────────────────────────────────────┤');
  console.log('  │ actionContact: ' + (oldJson.actionContact || 'null').substring(0, 15).padEnd(16) + '│ actionContact: ' + (newJson.actionContact || 'null').substring(0, 22).padEnd(23) + '│');
  console.log('  └─────────────────────────────────┴─────────────────────────────────────────┘');
  console.log('');

  // Show owners present
  console.log('  Teams with pending actions:', Object.keys(byOwner).join(', '));
  console.log('  AI correctly selected:', newJson.actionOwner);
  console.log('');
}

function formatSimple(d) {
  const diff = Math.ceil((new Date(d) - new Date()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'in ' + diff + ' days';
}

function formatDetailed(d) {
  const date = new Date(d);
  const f = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const diff = Math.ceil((date - new Date()) / 86400000);
  if (diff < 0) return `${f} (OVERDUE)`;
  if (diff === 0) return `${f} (TODAY)`;
  if (diff === 1) return `${f} (TOMORROW)`;
  return `${f} (in ${diff}d)`;
}

runSecondExample().catch(console.error);
