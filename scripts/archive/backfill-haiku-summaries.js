/**
 * Backfill AI summaries for shipments using the improved prompt with COMPLETION STATUS
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).
Transform shipment data into clear, actionable narrative.

Return ONLY valid JSON with these fields:
{
  "story": "2-3 sentence summary of shipment status",
  "narrative": "Detailed context about current situation",
  "currentBlocker": "What's blocking progress (null if none)",
  "blockerOwner": "Who owns the blocker",
  "blockerType": "external_dependency|internal_task|customer_action|carrier_issue",
  "nextAction": "Most important next step",
  "actionOwner": "operations|sales|finance|customs|customer|carrier",
  "actionContact": "Email or contact if available",
  "actionPriority": "critical|high|medium|low",
  "riskLevel": "high|medium|low",
  "riskReason": "Why this risk level",
  "financialImpact": "Any cost implications",
  "customerImpact": "Impact on customer",
  "customerActionRequired": true/false
}`;

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
  if (docTypes.has('final_bl') || docTypes.has('bl_final') || docTypes.has('sea_waybill')) completed.push('✅ Final BL');
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
    const lines = actions.slice(0, 3).map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const verb = a.action_verb || 'Review';
      return `    [${priority}] ${verb}: ${(a.action_description || '').substring(0, 60)}`;
    }).join('\n');
    return `  ${owner.toUpperCase()} TEAM (${actions.length}):\n${lines}`;
  }).join('\n');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

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

IMPORTANT: Do NOT say cutoffs "passed" if the required document was submitted.

## PENDING ACTIONS (${pendingActions.length} total)
${actionsText || 'None'}

Return JSON summary.`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const jsonMatch = (response.content[0].text || '').match(/\{[\s\S]*\}/);
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const cost = (inputTokens * 0.00025 + outputTokens * 0.00125) / 1000;

  return {
    json: jsonMatch ? JSON.parse(jsonMatch[0]) : {},
    status,
    pendingCount: pendingActions.length,
    cost,
    chronicleCount: chronicles.length
  };
}

async function runBackfill() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         HAIKU SUMMARY BACKFILL - With COMPLETION STATUS                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const { data: existingSummaries } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id')
    .order('updated_at', { ascending: true })
    .limit(50);

  const shipmentIds = existingSummaries?.map(s => s.shipment_id) || [];

  if (shipmentIds.length === 0) {
    console.log('No existing summaries found');
    return;
  }

  console.log(`Found ${shipmentIds.length} shipments to regenerate`);
  console.log('');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, stage, carrier_name, port_of_loading, port_of_discharge, etd, eta')
    .in('id', shipmentIds);

  let totalCost = 0;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < shipments.length; i++) {
    const shipment = shipments[i];
    const progress = `[${i + 1}/${shipments.length}]`;

    try {
      const { data: chronicles } = await supabase
        .from('chronicle')
        .select('document_type, has_action, action_completed_at, action_description, action_priority, action_owner, action_verb')
        .eq('shipment_id', shipment.id)
        .order('occurred_at', { ascending: false })
        .limit(30);

      const result = await generateSummary(shipment, chronicles || []);
      const json = result.json;
      totalCost += result.cost;

      const { error: updateError } = await supabase
        .from('shipment_ai_summaries')
        .update({
          story: json.story || null,
          narrative: json.narrative || null,
          current_blocker: json.currentBlocker || null,
          blocker_owner: json.blockerOwner || null,
          blocker_type: json.blockerType || null,
          next_action: json.nextAction || null,
          action_owner: json.actionOwner || null,
          action_contact: json.actionContact || null,
          action_priority: json.actionPriority || null,
          risk_level: json.riskLevel || null,
          risk_reason: json.riskReason || null,
          financial_impact: json.financialImpact || null,
          customer_impact: json.customerImpact || null,
          customer_action_required: json.customerActionRequired || false,
          chronicle_count: result.chronicleCount,
          generation_cost_usd: result.cost,
          model_used: 'claude-3-5-haiku-20241022',
          updated_at: new Date().toISOString()
        })
        .eq('shipment_id', shipment.id);

      if (updateError) {
        console.log(`${progress} ❌ ${shipment.booking_number}: ${updateError.message}`);
        errorCount++;
      } else {
        const completedStr = result.status.completed.join(', ') || 'None';
        console.log(`${progress} ✅ ${(shipment.booking_number || 'N/A').padEnd(15)} | ${(shipment.stage || 'N/A').padEnd(12)} | ${completedStr.substring(0, 40)}`);
        successCount++;
      }
    } catch (err) {
      console.log(`${progress} ❌ ${shipment.booking_number}: ${err.message}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`  ✅ Success: ${successCount}  |  ❌ Errors: ${errorCount}  |  💰 Cost: $${totalCost.toFixed(4)}`);
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
}

runBackfill().catch(console.error);
