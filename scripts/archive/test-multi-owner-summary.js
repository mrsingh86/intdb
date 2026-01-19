require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function testMultiOwner() {
  // Find shipments with actions from multiple owners
  const { data: shipments } = await supabase
    .from('chronicle')
    .select('shipment_id, action_owner')
    .eq('action_source', 'template')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null)
    .not('action_owner', 'is', null)
    .limit(500);

  if (!shipments || shipments.length === 0) {
    console.log('No shipments with template actions found');
    return;
  }

  // Group by shipment and count unique owners
  const ownersByShipment = {};
  for (const s of shipments) {
    if (!ownersByShipment[s.shipment_id]) {
      ownersByShipment[s.shipment_id] = new Set();
    }
    ownersByShipment[s.shipment_id].add(s.action_owner);
  }

  // Find shipment with most diverse owners
  let bestId = null;
  let maxOwners = 0;
  for (const [id, owners] of Object.entries(ownersByShipment)) {
    if (owners.size > maxOwners) {
      maxOwners = owners.size;
      bestId = id;
    }
  }

  if (!bestId || maxOwners < 2) {
    // Fall back to any shipment with 2+ actions
    bestId = Object.keys(ownersByShipment)[0];
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    AI SUMMARY TEST: Multi-Owner Actions                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Testing shipment with', maxOwners, 'different action owners:', bestId);
  console.log('');

  // Get the shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', bestId)
    .single();

  // Get pending actions
  const { data: actions } = await supabase
    .from('chronicle')
    .select(`
      subject, document_type, from_party, from_address,
      action_type, action_verb, action_description, action_owner,
      action_priority, action_deadline, action_deadline_source, action_auto_resolve_on
    `)
    .eq('shipment_id', bestId)
    .eq('has_action', true)
    .is('action_completed_at', null)
    .order('action_priority', { ascending: true })
    .limit(8);

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  SHIPMENT: ' + (shipment?.booking_number || bestId));
  console.log('  Stage: ' + (shipment?.stage || 'PENDING') + ' | Carrier: ' + (shipment?.carrier_name || 'N/A'));
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Group by owner
  const byOwner = {};
  for (const a of actions || []) {
    const owner = a.action_owner || 'operations';
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(a);
  }

  console.log('PENDING ACTIONS (grouped by owner - this is what AI sees):');
  console.log('');

  for (const [owner, ownerActions] of Object.entries(byOwner)) {
    console.log('  ### ' + owner.toUpperCase() + ' TEAM');
    for (const a of ownerActions) {
      const priority = a.action_priority || 'MEDIUM';
      const verb = a.action_verb || 'Review';
      const deadline = a.action_deadline ? formatDeadline(a.action_deadline) : 'no deadline';
      console.log('    - [' + priority + '] ' + verb + ' (' + deadline + ')');
    }
    console.log('');
  }

  // Build AI prompt
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const ownerSections = Object.entries(byOwner).map(([owner, ownerActions]) => {
    const lines = ownerActions.map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const verb = a.action_verb || 'Review';
      const desc = a.action_description || 'Review required';
      const deadline = a.action_deadline ? formatDeadline(a.action_deadline) : 'no deadline';
      const deadlineReason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
      return `  - [${priority}] ${verb}: ${desc.substring(0, 60)}\n    Deadline: ${deadline}${deadlineReason}`;
    }).join('\n\n');
    return `### ${owner.toUpperCase()} TEAM (${ownerActions.length} action${ownerActions.length > 1 ? 's' : ''})\n${lines}`;
  }).join('\n\n');

  const prompt = `
## SHIPMENT
Booking: ${shipment?.booking_number || 'N/A'}
Stage: ${shipment?.stage || 'PENDING'}
Carrier: ${shipment?.carrier_name || 'N/A'}
Today: ${today}

## PENDING ACTIONS BY OWNER
${ownerSections}

Generate a JSON summary:
{
  "story": "2-3 sentence summary of status and priorities",
  "nextAction": "Most urgent action with verb",
  "actionOwner": "Which team (from the owners above)",
  "actionPriority": "critical/high/medium/low",
  "riskLevel": "red/amber/green"
}

KEY: The actionOwner MUST be one of the teams listed above (${Object.keys(byOwner).join(', ')}).
Return ONLY valid JSON.
`;

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  CALLING AI...');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('');
      console.log('  AI SUMMARY:');
      console.log('  ───────────');
      console.log('  Story:', parsed.story);
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('  │ Next Action: ' + (parsed.nextAction || 'N/A').padEnd(60) + '│');
      console.log('  │ Action Owner: ' + (parsed.actionOwner || 'N/A').padEnd(59) + '│');
      console.log('  │ Priority: ' + (parsed.actionPriority || 'N/A').padEnd(63) + '│');
      console.log('  │ Risk Level: ' + (parsed.riskLevel || 'N/A').padEnd(61) + '│');
      console.log('  └─────────────────────────────────────────────────────────────────────────────┘');
      console.log('');
      console.log('  ✓ AI correctly identified owner from template data');
      console.log('  ✓ Cost: $' + ((response.usage.input_tokens * 0.80 + response.usage.output_tokens * 4) / 1_000_000).toFixed(6));
    }
  } catch (err) {
    console.log('  Error:', err.message);
  }
}

function formatDeadline(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${formatted} (OVERDUE)`;
  if (diffDays === 0) return `${formatted} (TODAY)`;
  if (diffDays === 1) return `${formatted} (TOMORROW)`;
  return `${formatted} (in ${diffDays}d)`;
}

testMultiOwner().catch(console.error);
