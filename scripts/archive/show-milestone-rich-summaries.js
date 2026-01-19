/**
 * Generate AI summaries for shipments with PRE-DEPARTURE milestones
 * (booking_confirmation, si_confirmation, vgm_confirmation, draft_bl, final_bl)
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).
Transform shipment data into clear, actionable narrative.
Return JSON with: story, narrative, currentBlocker, blockerOwner, nextAction, actionOwner, actionPriority, riskLevel, riskReason`;

const MILESTONE_TYPES = [
  'booking_confirmation', 'booking_amendment',
  'shipping_instructions', 'si_confirmation', 'si_submitted',
  'vgm_confirmation', 'draft_bl', 'bl_draft', 'final_bl', 'bl_final',
  'sea_waybill', 'telex_release', 'arrival_notice'
];

async function getCompletionStatus(chronicles) {
  const docTypes = new Set((chronicles || []).map(c => c.document_type?.toLowerCase()).filter(Boolean));

  const completed = [];
  const pending = [];

  if (docTypes.has('booking_confirmation') || docTypes.has('booking_amendment')) completed.push('✅ Booking');
  else pending.push('⏳ Booking');

  if (docTypes.has('shipping_instructions') || docTypes.has('si_confirmation') || docTypes.has('si_submitted')) {
    completed.push('✅ SI');
  } else {
    pending.push('⏳ SI');
  }

  if (docTypes.has('vgm_confirmation')) completed.push('✅ VGM');
  else pending.push('⏳ VGM');

  if (docTypes.has('draft_bl') || docTypes.has('bl_draft')) completed.push('✅ Draft BL');
  if (docTypes.has('final_bl') || docTypes.has('bl_final') || docTypes.has('sea_waybill')) {
    completed.push('✅ Final BL');
  }
  if (docTypes.has('telex_release')) completed.push('✅ Telex');
  if (docTypes.has('arrival_notice')) completed.push('✅ Arrived');

  return { completed, pending, docTypes: Array.from(docTypes) };
}

async function generateSummary(shipment, chronicles) {
  const status = await getCompletionStatus(chronicles);
  const pendingActions = chronicles.filter(c => c.has_action && !c.action_completed_at);

  const byOwner = {};
  for (const a of pendingActions) {
    const owner = a.action_owner || 'operations';
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(a);
  }

  const actionsText = Object.entries(byOwner).map(([owner, actions]) => {
    const lines = actions.slice(0, 2).map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const verb = a.action_verb || 'Review';
      return `    [${priority}] ${verb}: ${(a.action_description || '').substring(0, 50)}`;
    }).join('\n');
    return `  ${owner.toUpperCase()} TEAM:\n${lines}`;
  }).join('\n');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const prompt = `
## SHIPMENT: ${shipment.booking_number || 'N/A'}
Today: ${today}
Stage: ${shipment.stage || 'PENDING'}
Carrier: ${shipment.carrier_name || 'N/A'}
Route: ${shipment.port_of_loading || '?'} → ${shipment.port_of_discharge || '?'}
ETD: ${shipment.etd ? new Date(shipment.etd).toLocaleDateString() : 'TBD'}
ETA: ${shipment.eta ? new Date(shipment.eta).toLocaleDateString() : 'TBD'}

## COMPLETION STATUS
COMPLETED: ${status.completed.length > 0 ? status.completed.join(' | ') : 'None yet'}
STILL NEEDED: ${status.pending.length > 0 ? status.pending.join(' | ') : 'All complete'}

Document types received: ${status.docTypes.join(', ') || 'none'}

IMPORTANT: Do NOT say cutoffs "passed" if the required document was submitted.
If SI/VGM is confirmed, the cutoff was MET, not missed.

## PENDING ACTIONS (${pendingActions.length} total)
${actionsText || 'None'}

Return JSON summary focusing on what is COMPLETED and what action is needed next.`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const jsonMatch = (response.content[0].text || '').match(/\{[\s\S]*\}/);
  return {
    json: jsonMatch ? JSON.parse(jsonMatch[0]) : {},
    status,
    pendingCount: pendingActions.length,
    actionOwners: Object.keys(byOwner)
  };
}

async function showSummaries() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              AI SUMMARIES FOR SHIPMENTS WITH PRE-DEPARTURE MILESTONES                                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Find shipments with milestone document types
  const { data: milestoneRecords } = await supabase
    .from('chronicle')
    .select('shipment_id, document_type')
    .in('document_type', MILESTONE_TYPES)
    .not('shipment_id', 'is', null)
    .limit(500);

  // Count milestone types per shipment
  const shipmentMilestones = {};
  for (const c of milestoneRecords || []) {
    if (!shipmentMilestones[c.shipment_id]) {
      shipmentMilestones[c.shipment_id] = new Set();
    }
    shipmentMilestones[c.shipment_id].add(c.document_type);
  }

  // Sort by number of different milestone types
  const rankedShipments = Object.entries(shipmentMilestones)
    .map(([id, types]) => ({ id, count: types.size, types: Array.from(types) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (rankedShipments.length === 0) {
    console.log('No shipments with milestone document types found');
    return;
  }

  console.log('  Found shipments with these milestone counts:');
  for (const s of rankedShipments) {
    console.log(`    ${s.id.substring(0, 8)}... : ${s.count} milestones (${s.types.join(', ')})`);
  }
  console.log('');

  // Get shipment details
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, stage, carrier_name, port_of_loading, port_of_discharge, etd, eta')
    .in('id', rankedShipments.map(s => s.id));

  let totalCost = 0;

  for (let i = 0; i < shipments.length; i++) {
    const shipment = shipments[i];

    const { data: chronicles } = await supabase
      .from('chronicle')
      .select(`
        document_type, has_action, action_completed_at, action_description,
        action_priority, action_owner, action_verb, summary
      `)
      .eq('shipment_id', shipment.id)
      .order('occurred_at', { ascending: false })
      .limit(30);

    const result = await generateSummary(shipment, chronicles || []);
    const json = result.json;
    totalCost += 0.001;

    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│  📦 SHIPMENT ${i + 1}: ${(shipment.booking_number || 'N/A').padEnd(20)} Stage: ${(shipment.stage || 'N/A').padEnd(15)} Carrier: ${(shipment.carrier_name || 'N/A').substring(0, 15).padEnd(15)}│`);
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');

    const route = `${shipment.port_of_loading || '?'} → ${shipment.port_of_discharge || '?'}`;
    const etd = shipment.etd ? new Date(shipment.etd).toLocaleDateString() : 'TBD';
    const eta = shipment.eta ? new Date(shipment.eta).toLocaleDateString() : 'TBD';
    console.log(`│  Route: ${route.padEnd(40)} ETD: ${etd.padEnd(15)} ETA: ${eta.padEnd(30)}│`);

    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    const completedStr = result.status.completed.join(' | ') || 'None';
    const pendingStr = result.status.pending.join(' | ') || 'All done';
    console.log(`│  ✅ COMPLETED: ${completedStr.padEnd(93)}│`);
    console.log(`│  ⏳ PENDING:   ${pendingStr.padEnd(93)}│`);

    const docsStr = result.status.docTypes.slice(0, 8).join(', ');
    console.log(`│  📄 Docs: ${docsStr.padEnd(98)}│`);

    const riskEmoji = json.riskLevel === 'high' ? '🔴' : json.riskLevel === 'medium' ? '🟡' : '🟢';
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│  ${riskEmoji} RISK: ${(json.riskLevel || 'N/A').toUpperCase().padEnd(10)} ${(json.riskReason || '').substring(0, 85).padEnd(90)}│`);

    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│  📝 AI STORY                                                                                                    │');
    const story = json.story || 'No story generated';
    const storyLines = wrapText(story, 103);
    storyLines.forEach(line => {
      console.log(`│  ${line.padEnd(106)}│`);
    });

    if (json.currentBlocker) {
      console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
      console.log(`│  ⚠️  BLOCKER: ${(json.currentBlocker || '').substring(0, 90).padEnd(93)}│`);
      console.log(`│     Owner: ${(json.blockerOwner || 'N/A').padEnd(98)}│`);
    }

    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│  ▶️  NEXT ACTION: ${(json.nextAction || 'None').substring(0, 88).padEnd(90)}│`);
    console.log(`│     Owner: ${(json.actionOwner || 'N/A').padEnd(25)} Priority: ${(json.actionPriority || 'N/A').toUpperCase().padEnd(65)}│`);

    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│  📋 Pending Actions: ${String(result.pendingCount).padEnd(5)} Teams: ${result.actionOwners.join(', ').padEnd(75)}│`);
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`  Generated ${shipments.length} summaries | Estimated cost: $${totalCost.toFixed(4)}`);
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

function wrapText(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxWidth) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines.slice(0, 3) : [''];
}

showSummaries().catch(console.error);
