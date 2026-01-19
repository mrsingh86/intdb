/**
 * Generate AI summaries for shipments with RICH chronicle data
 * Shows the improved prompts with COMPLETION STATUS section
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).
Transform shipment data into clear, actionable narrative.
Return JSON with: story, narrative, currentBlocker, blockerOwner, nextAction, actionOwner, actionPriority, riskLevel, riskReason`;

async function getCompletionStatus(chronicles) {
  const docTypes = new Set((chronicles || []).map(c => c.document_type?.toLowerCase()).filter(Boolean));

  const completed = [];
  const pending = [];

  if (docTypes.has('booking_confirmation')) completed.push('✅ Booking');
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
  if (docTypes.has('invoice')) completed.push('✅ Invoice');

  return { completed, pending, docTypes: Array.from(docTypes) };
}

async function generateSummary(shipment, chronicles) {
  const status = await getCompletionStatus(chronicles);
  const pendingActions = chronicles.filter(c => c.has_action && !c.action_completed_at);

  // Group actions by owner
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
  console.log('║                    AI SUMMARIES FOR SHIPMENTS WITH RICH CHRONICLE DATA                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Find shipments with the most chronicle entries
  const { data: richShipments } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .not('shipment_id', 'is', null)
    .not('document_type', 'is', null);

  // Count by shipment
  const counts = {};
  for (const c of richShipments || []) {
    counts[c.shipment_id] = (counts[c.shipment_id] || 0) + 1;
  }

  // Get top 5 shipments by chronicle count
  const topShipmentIds = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  if (topShipmentIds.length === 0) {
    console.log('No shipments with chronicle data found');
    return;
  }

  // Get shipment details
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, stage, carrier_name, port_of_loading, port_of_discharge, etd, eta')
    .in('id', topShipmentIds);

  let totalCost = 0;

  for (let i = 0; i < shipments.length; i++) {
    const shipment = shipments[i];

    // Get chronicles for this shipment
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

    // Route & Dates
    const route = `${shipment.port_of_loading || '?'} → ${shipment.port_of_discharge || '?'}`;
    const etd = shipment.etd ? new Date(shipment.etd).toLocaleDateString() : 'TBD';
    const eta = shipment.eta ? new Date(shipment.eta).toLocaleDateString() : 'TBD';
    console.log(`│  Route: ${route.padEnd(40)} ETD: ${etd.padEnd(15)} ETA: ${eta.padEnd(30)}│`);

    // Completion Status
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    const completedStr = result.status.completed.join(' | ') || 'None';
    const pendingStr = result.status.pending.join(' | ') || 'All done';
    console.log(`│  ✅ COMPLETED: ${completedStr.padEnd(93)}│`);
    console.log(`│  ⏳ PENDING:   ${pendingStr.padEnd(93)}│`);

    // Document types found
    const docsStr = result.status.docTypes.slice(0, 6).join(', ');
    console.log(`│  📄 Docs: ${docsStr.padEnd(98)}│`);

    // Risk
    const riskEmoji = json.riskLevel === 'high' ? '🔴' : json.riskLevel === 'medium' ? '🟡' : '🟢';
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│  ${riskEmoji} RISK: ${(json.riskLevel || 'N/A').toUpperCase().padEnd(10)} ${(json.riskReason || '').substring(0, 85).padEnd(90)}│`);

    // AI Story
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│  📝 AI STORY                                                                                                    │');
    const story = json.story || 'No story generated';
    const storyLines = wrapText(story, 103);
    storyLines.forEach(line => {
      console.log(`│  ${line.padEnd(106)}│`);
    });

    // Blocker (if any)
    if (json.currentBlocker) {
      console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
      console.log(`│  ⚠️  BLOCKER: ${(json.currentBlocker || '').substring(0, 90).padEnd(93)}│`);
      console.log(`│     Owner: ${(json.blockerOwner || 'N/A').padEnd(98)}│`);
    }

    // Next Action
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│  ▶️  NEXT ACTION: ${(json.nextAction || 'None').substring(0, 88).padEnd(90)}│`);
    console.log(`│     Owner: ${(json.actionOwner || 'N/A').padEnd(25)} Priority: ${(json.actionPriority || 'N/A').toUpperCase().padEnd(65)}│`);

    // Pending actions count
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
