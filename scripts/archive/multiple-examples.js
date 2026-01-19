require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function runMultipleExamples() {
  // Find shipments with diverse action types
  const { data: candidates } = await supabase
    .from('chronicle')
    .select('shipment_id, action_owner, action_type, document_type')
    .eq('action_source', 'template')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .not('shipment_id', 'is', null)
    .limit(500);

  // Group by shipment and find diverse ones
  const shipmentData = {};
  for (const c of candidates || []) {
    if (!shipmentData[c.shipment_id]) {
      shipmentData[c.shipment_id] = {
        owners: new Set(),
        types: new Set(),
        docTypes: new Set()
      };
    }
    shipmentData[c.shipment_id].owners.add(c.action_owner || 'operations');
    shipmentData[c.shipment_id].types.add(c.action_type || 'review');
    shipmentData[c.shipment_id].docTypes.add(c.document_type);
  }

  // Sort by diversity
  const sortedShipments = Object.entries(shipmentData)
    .map(([id, data]) => ({
      id,
      score: data.owners.size * 3 + data.types.size * 2 + data.docTypes.size
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              MULTIPLE BEFORE/AFTER EXAMPLES                                            ║');
  console.log('║                              PreciseActionService Enhancement                                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  let exampleNum = 0;
  for (const { id: shipmentId } of sortedShipments) {
    exampleNum++;

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    // Get actions
    const { data: actions } = await supabase
      .from('chronicle')
      .select(`
        subject, document_type, from_party, from_address,
        action_type, action_verb, action_description, action_owner,
        action_priority, action_deadline, action_deadline_source, action_auto_resolve_on
      `)
      .eq('shipment_id', shipmentId)
      .eq('has_action', true)
      .is('action_completed_at', null)
      .order('action_deadline', { ascending: true, nullsLast: true })
      .limit(5);

    if (!actions || actions.length === 0) continue;

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  EXAMPLE ' + exampleNum + ': ' + (shipment?.booking_number || shipmentId.substring(0, 8)));
    console.log('  Stage: ' + (shipment?.stage || 'PENDING') + ' | Carrier: ' + (shipment?.carrier_name || 'N/A'));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ========== BEFORE ==========
    console.log('');
    console.log('  ╭─────────────────────────────────────────────────────────────────────────────────────────────────╮');
    console.log('  │ BEFORE: What AI received (old format)                                                          │');
    console.log('  ╰─────────────────────────────────────────────────────────────────────────────────────────────────╯');
    console.log('');
    console.log('  ## PENDING ACTIONS');

    const oldActions = actions.map(a => {
      const priority = a.action_priority || 'MEDIUM';
      const deadline = a.action_deadline ? formatSimple(a.action_deadline) : 'no deadline';
      return `  - [${priority}] ${a.action_description || 'Review document'} (${deadline})`;
    });
    console.log(oldActions.join('\n'));

    // Build old prompt
    const oldPrompt = `Shipment ${shipment?.booking_number || 'N/A'} (${shipment?.stage || 'PENDING'})
PENDING ACTIONS:
${oldActions.join('\n')}

Return JSON: {"nextAction":"...", "actionOwner":"...", "riskLevel":"red/amber/green"}`;

    const oldResp = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      messages: [{ role: 'user', content: oldPrompt }],
    });
    const oldText = oldResp.content[0].type === 'text' ? oldResp.content[0].text : '';
    const oldJson = JSON.parse(oldText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    console.log('');
    console.log('  AI Output (BEFORE):');
    console.log('    nextAction: "' + (oldJson.nextAction || 'N/A').substring(0, 50) + '"');
    console.log('    actionOwner: "' + (oldJson.actionOwner || 'N/A') + '"  ← GUESSED');
    console.log('    riskLevel: ' + (oldJson.riskLevel || 'N/A'));

    // ========== AFTER ==========
    console.log('');
    console.log('  ╭─────────────────────────────────────────────────────────────────────────────────────────────────╮');
    console.log('  │ AFTER: What AI receives (new format with PreciseActionService)                                 │');
    console.log('  ╰─────────────────────────────────────────────────────────────────────────────────────────────────╯');
    console.log('');

    // Group by owner
    const byOwner = {};
    for (const a of actions) {
      const owner = a.action_owner || 'operations';
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push(a);
    }

    console.log('  ## PENDING ACTIONS BY OWNER');
    for (const [owner, ownerActions] of Object.entries(byOwner)) {
      console.log('');
      console.log('  ### ' + owner.toUpperCase() + ' TEAM');
      for (const a of ownerActions) {
        const priority = a.action_priority || 'MEDIUM';
        const verb = a.action_verb || 'Review';
        const deadline = a.action_deadline ? formatDetailed(a.action_deadline) : 'no deadline';
        const reason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
        console.log('    - [' + priority + '] ' + verb + ': ' + (a.action_description || '').substring(0, 45));
        console.log('      Type: ' + (a.action_type || 'review') + ' | Deadline: ' + deadline + reason);
        if (a.from_address) console.log('      Contact: ' + a.from_address);
        if (a.action_auto_resolve_on?.length > 0) console.log('      Auto-resolves: ' + a.action_auto_resolve_on.join(', '));
      }
    }

    // Build new prompt
    const ownerSections = Object.entries(byOwner).map(([owner, oa]) => {
      const lines = oa.map(a => {
        const verb = a.action_verb || 'Review';
        const deadline = a.action_deadline ? formatDetailed(a.action_deadline) : 'no deadline';
        const reason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
        return `- [${a.action_priority || 'MEDIUM'}] ${verb}: ${a.action_description}\n  Deadline: ${deadline}${reason}`;
      }).join('\n');
      return `### ${owner.toUpperCase()} TEAM\n${lines}`;
    }).join('\n\n');

    const newPrompt = `Shipment ${shipment?.booking_number || 'N/A'} (${shipment?.stage || 'PENDING'})

## PENDING ACTIONS BY OWNER
${ownerSections}

Return JSON: {"nextAction":"...", "actionOwner":"must be one of: ${Object.keys(byOwner).join(', ')}", "riskLevel":"red/amber/green"}`;

    const newResp = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      messages: [{ role: 'user', content: newPrompt }],
    });
    const newText = newResp.content[0].type === 'text' ? newResp.content[0].text : '';
    const newJson = JSON.parse(newText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    console.log('');
    console.log('  AI Output (AFTER):');
    console.log('    nextAction: "' + (newJson.nextAction || 'N/A').substring(0, 50) + '"');
    console.log('    actionOwner: "' + (newJson.actionOwner || 'N/A') + '"  ← FROM TEMPLATE');
    console.log('    riskLevel: ' + (newJson.riskLevel || 'N/A'));

    // ========== COMPARISON ==========
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('  │ COMPARISON                                                                                     │');
    console.log('  ├─────────────────────────────────────────────────────────────────────────────────────────────────┤');

    const ownerMatch = Object.keys(byOwner).some(o =>
      (newJson.actionOwner || '').toLowerCase().includes(o.toLowerCase())
    );
    const oldOwnerMatch = Object.keys(byOwner).some(o =>
      (oldJson.actionOwner || '').toLowerCase().includes(o.toLowerCase())
    );

    console.log('  │ Owner (BEFORE): ' + (oldJson.actionOwner || 'N/A').padEnd(25) + (oldOwnerMatch ? '✓ Correct' : '✗ Wrong/Guessed').padEnd(30) + '│');
    console.log('  │ Owner (AFTER):  ' + (newJson.actionOwner || 'N/A').padEnd(25) + (ownerMatch ? '✓ Correct (from template)' : '? Check').padEnd(30) + '│');
    console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');

    // Brief pause to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY: The AFTER format gives AI explicit owner information from templates,');
  console.log('  eliminating guesswork and ensuring accurate team assignments.');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

function formatSimple(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'in ' + diff + ' days';
}

function formatDetailed(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const now = new Date();
  const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${formatted} (OVERDUE)`;
  if (diff === 0) return `${formatted} (TODAY)`;
  if (diff === 1) return `${formatted} (TOMORROW)`;
  return `${formatted} (in ${diff}d)`;
}

runMultipleExamples().catch(console.error);
