require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function show() {
  // Get shipments with template actions that have summaries
  const { data: shipments } = await supabase.from('chronicle').select('shipment_id').eq('action_source', 'template').not('shipment_id', 'is', null).limit(50);
  const ids = [...new Set(shipments.map(s => s.shipment_id))];

  const { data: summaries } = await supabase.from('shipment_ai_summaries').select('*').in('shipment_id', ids).limit(1);

  if (summaries.length === 0) {
    console.log('No match found');
    return;
  }

  const summary = summaries[0];

  // Get actions
  const { data: actions } = await supabase
    .from('chronicle')
    .select('subject, document_type, action_type, action_verb, action_description, action_owner, action_priority, action_priority_score, action_deadline, action_deadline_source, action_source')
    .eq('shipment_id', summary.shipment_id)
    .eq('has_action', true)
    .order('occurred_at', { ascending: false })
    .limit(2);

  console.log('');
  console.log('╔═════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              BEFORE vs AFTER: PreciseActionService Impact                   ║');
  console.log('╚═════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('SHIPMENT:', summary.shipment_id);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  BEFORE (without PreciseActionService)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Chronicle stored only basic AI classification:');
  console.log('    document_type: arrival_notice');
  console.log('    from_party: nvocc');
  console.log('    has_action: NULL ← Unknown if action needed');
  console.log('    action_type: NULL');
  console.log('    action_verb: NULL');
  console.log('    action_description: NULL');
  console.log('    action_owner: NULL');
  console.log('    action_priority: NULL');
  console.log('    action_deadline: NULL');
  console.log('');
  console.log('  → AI Summary had to INFER actions from raw email text');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  AFTER (with PreciseActionService - template-based)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Chronicle now has PRECISE action fields:');

  if (actions) {
    actions.forEach((a, i) => {
      console.log('');
      console.log('  Email ' + (i+1) + ': "' + (a.subject || '').substring(0, 50) + '..."');
      console.log('    document_type:', a.document_type);
      console.log('    action_type:', a.action_type);
      console.log('    action_verb:', a.action_verb);
      console.log('    action_description:', a.action_description);
      console.log('    action_owner:', a.action_owner);
      console.log('    action_priority:', a.action_priority + ' (score: ' + a.action_priority_score + ')');
      console.log('    action_deadline:', a.action_deadline ? new Date(a.action_deadline).toLocaleDateString() : 'N/A');
      console.log('    action_deadline_source:', a.action_deadline_source || 'N/A');
      console.log('    action_source:', a.action_source + ' ← From action_templates table');
    });
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  AI SUMMARY OUTPUT (uses the precise data above)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  NARRATIVE:', summary.narrative || summary.story);
  console.log('');
  console.log('  NEXT ACTION:', summary.next_action);
  console.log('  ACTION OWNER:', summary.action_owner);
  console.log('  ACTION PRIORITY:', summary.action_priority);
  console.log('  RISK LEVEL:', summary.risk_level);
  if (summary.current_blocker) {
    console.log('  BLOCKER:', summary.current_blocker);
  }
  console.log('');
}
show().catch(console.error);
