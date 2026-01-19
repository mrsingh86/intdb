require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function testSummary() {
  // Find a shipment with diverse pending template actions
  const { data: shipments } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .eq('action_source', 'template')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null)
    .limit(20);

  if (!shipments || shipments.length === 0) {
    console.log('No shipments with pending template actions found');
    return;
  }

  const uniqueIds = [...new Set(shipments.map(s => s.shipment_id))];

  // Find one with multiple actions from different owners
  let bestShipmentId = uniqueIds[0];
  let bestActionCount = 0;

  for (const id of uniqueIds.slice(0, 5)) {
    const { count } = await supabase
      .from('chronicle')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', id)
      .eq('has_action', true)
      .is('action_completed_at', null);

    if (count > bestActionCount) {
      bestActionCount = count;
      bestShipmentId = id;
    }
  }

  console.log('');
  console.log('Testing HaikuSummaryService with shipment:', bestShipmentId);
  console.log('Pending actions:', bestActionCount);
  console.log('');

  // Get the shipment context
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', bestShipmentId)
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════');
  console.log('  SHIPMENT CONTEXT');
  console.log('════════════════════════════════════════════════════════════════════════════════════');
  console.log('  Booking:', shipment.booking_number || 'N/A');
  console.log('  Route:', (shipment.port_of_loading_code || '?') + ' → ' + (shipment.port_of_discharge_code || '?'));
  console.log('  Stage:', shipment.stage || 'PENDING');
  console.log('  Carrier:', shipment.carrier_name || 'N/A');
  console.log('');

  // Get pending actions with new precise fields
  const { data: actions } = await supabase
    .from('chronicle')
    .select(`
      subject, document_type, from_party, from_address,
      has_action, action_description, action_priority, action_deadline,
      action_type, action_verb, action_owner, action_deadline_source, action_auto_resolve_on
    `)
    .eq('shipment_id', bestShipmentId)
    .eq('has_action', true)
    .is('action_completed_at', null)
    .order('action_deadline', { ascending: true, nullsLast: true })
    .limit(10);

  console.log('════════════════════════════════════════════════════════════════════════════════════');
  console.log('  PENDING ACTIONS (Enhanced with PreciseActionService fields)');
  console.log('════════════════════════════════════════════════════════════════════════════════════');

  if (actions && actions.length > 0) {
    // Group by owner
    const byOwner = {};
    for (const a of actions) {
      const owner = a.action_owner || 'operations';
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push(a);
    }

    for (const [owner, ownerActions] of Object.entries(byOwner)) {
      console.log('');
      console.log('  ### ' + owner.toUpperCase() + ' TEAM (' + ownerActions.length + ' action' + (ownerActions.length > 1 ? 's' : '') + ')');

      for (const a of ownerActions) {
        const priority = a.action_priority || 'MEDIUM';
        const verb = a.action_verb || 'Review';
        const deadline = a.action_deadline ? new Date(a.action_deadline).toLocaleDateString() : 'no deadline';
        const deadlineSource = a.action_deadline_source || 'N/A';

        console.log('');
        console.log('    [' + priority + '] ' + verb + ': ' + (a.action_description || '').substring(0, 50));
        console.log('      Type: ' + (a.action_type || 'review') + ' | Deadline: ' + deadline + ' (' + deadlineSource + ')');
        if (a.from_address) console.log('      Contact: ' + a.from_address);
        if (a.action_auto_resolve_on && a.action_auto_resolve_on.length > 0) {
          console.log('      Auto-resolves: ' + a.action_auto_resolve_on.join(', '));
        }
      }
    }
  } else {
    console.log('  (No pending actions)');
  }

  console.log('');
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════════');
  console.log('  CALLING AI (Claude Haiku) FOR SUMMARY...');
  console.log('════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Build a simplified prompt to test
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  let actionsPrompt = '';
  if (actions && actions.length > 0) {
    const byOwner = {};
    for (const a of actions) {
      const owner = a.action_owner || 'operations';
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push(a);
    }

    const ownerSections = [];
    for (const [owner, ownerActions] of Object.entries(byOwner)) {
      const lines = ownerActions.map(a => {
        const priority = a.action_priority || 'MEDIUM';
        const verb = a.action_verb || 'Review';
        const deadline = a.action_deadline ? formatDeadline(a.action_deadline) : 'no deadline';
        const deadlineReason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
        const contact = a.from_address ? `\n    Contact: ${a.from_address}` : '';
        const autoResolve = a.action_auto_resolve_on && a.action_auto_resolve_on.length > 0
          ? `\n    Auto-resolves when: ${a.action_auto_resolve_on.join(', ')}`
          : '';
        return `  - [${priority}] ${verb}: ${a.action_description}\n    Type: ${a.action_type || 'review'} | Deadline: ${deadline}${deadlineReason}${contact}${autoResolve}`;
      }).join('\n\n');

      ownerSections.push(`### ${owner.toUpperCase()} TEAM (${ownerActions.length} action${ownerActions.length > 1 ? 's' : ''})\n${lines}`);
    }

    actionsPrompt = `\n## PENDING ACTIONS BY OWNER\n${ownerSections.join('\n\n')}`;
  }

  const userPrompt = `
## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment.booking_number || 'N/A'}
Route: ${shipment.port_of_loading_code || '?'} → ${shipment.port_of_discharge_code || '?'}
Stage: ${shipment.stage || 'PENDING'}
Carrier: ${shipment.carrier_name || 'N/A'}
${actionsPrompt}

Based on the above, generate a JSON summary with these fields:
- story: One paragraph summary (2-3 sentences)
- nextAction: The most urgent action
- actionOwner: Who should do it (from the PENDING ACTIONS BY OWNER section)
- actionPriority: critical/high/medium/low
- riskLevel: red/amber/green

Return ONLY valid JSON.
`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    console.log('  Raw AI Response:');
    console.log('  ────────────────');
    console.log('  ' + text.split('\n').join('\n  '));
    console.log('');

    // Parse JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('════════════════════════════════════════════════════════════════════════════════════');
      console.log('  AI SUMMARY OUTPUT');
      console.log('════════════════════════════════════════════════════════════════════════════════════');
      console.log('');
      console.log('  Story:', parsed.story);
      console.log('');
      console.log('  Next Action:', parsed.nextAction);
      console.log('  Action Owner:', parsed.actionOwner, '← AI correctly identified owner from template data');
      console.log('  Action Priority:', parsed.actionPriority);
      console.log('  Risk Level:', parsed.riskLevel);
      console.log('');
      console.log('  Tokens used:', response.usage.input_tokens, 'input,', response.usage.output_tokens, 'output');
      console.log('  Cost: $' + ((response.usage.input_tokens * 0.80 + response.usage.output_tokens * 4) / 1_000_000).toFixed(6));
    }
  } catch (err) {
    console.log('  Error calling AI:', err.message);
  }
}

function formatDeadline(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${formatted} (OVERDUE by ${Math.abs(diffDays)} days)`;
  if (diffDays === 0) return `${formatted} (TODAY)`;
  if (diffDays === 1) return `${formatted} (TOMORROW)`;
  return `${formatted} (in ${diffDays} days)`;
}

testSummary().catch(console.error);
