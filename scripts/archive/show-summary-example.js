require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function showBeforeAfter() {
  // Find shipments with both chronicle actions AND AI summary
  const { data: shipments } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .eq('has_action', true)
    .eq('action_source', 'template')
    .not('shipment_id', 'is', null)
    .limit(100);

  if (!shipments || shipments.length === 0) {
    console.log('No shipments with template actions found');
    return;
  }

  const shipmentIds = [...new Set(shipments.map(s => s.shipment_id))];

  // Find one with an AI summary
  const { data: summary } = await supabase
    .from('shipment_ai_summaries')
    .select('*')
    .in('shipment_id', shipmentIds)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (!summary) {
    console.log('No AI summary found for shipments with actions');
    return;
  }

  // Get chronicle actions for this shipment
  const { data: actions } = await supabase
    .from('chronicle')
    .select('subject, document_type, action_type, action_verb, action_description, action_owner, action_priority, action_priority_score, action_deadline, action_deadline_source, action_source')
    .eq('shipment_id', summary.shipment_id)
    .eq('has_action', true)
    .order('occurred_at', { ascending: false })
    .limit(3);

  console.log('');
  console.log('╔═════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              BEFORE vs AFTER: PreciseActionService Impact                   ║');
  console.log('╚═════════════════════════════════════════════════════════════════════════════╝');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  BEFORE (without PreciseActionService)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Chronicle stored only basic classification:');
  console.log('    document_type: invoice');
  console.log('    from_party: ocean_carrier');
  console.log('    has_action: NULL (unknown if action needed)');
  console.log('    action_description: NULL');
  console.log('    action_deadline: NULL');
  console.log('    action_owner: NULL');
  console.log('    action_priority: NULL');
  console.log('');
  console.log('  → AI Summary had to GUESS actions from raw email text (less accurate)');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  AFTER (with PreciseActionService)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Chronicle now has PRECISE action data:');

  if (actions && actions.length > 0) {
    actions.forEach((a, i) => {
      const subj = (a.subject || '').substring(0, 45);
      console.log('');
      console.log('  Email ' + (i+1) + ': "' + subj + '..."');
      console.log('    document_type:', a.document_type);
      console.log('    action_type:', a.action_type);
      console.log('    action_verb:', a.action_verb);
      console.log('    action_description:', a.action_description);
      console.log('    action_owner:', a.action_owner);
      console.log('    action_priority:', a.action_priority, '(score:', a.action_priority_score, ')');
      const deadline = a.action_deadline ? new Date(a.action_deadline).toLocaleDateString() : 'N/A';
      console.log('    action_deadline:', deadline);
      console.log('    action_deadline_source:', a.action_deadline_source || 'N/A');
      console.log('    action_source:', a.action_source);
    });
  } else {
    console.log('  (No actions found)');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  AI SUMMARY OUTPUT (synthesizes the precise action data)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  NARRATIVE:', summary.narrative || summary.story);
  console.log('');
  console.log('  NEXT ACTION:', summary.next_action);
  console.log('  ACTION OWNER:', summary.action_owner);
  console.log('  ACTION PRIORITY:', summary.action_priority);
  console.log('  RISK LEVEL:', summary.risk_level);

  if (summary.current_blocker) {
    console.log('');
    console.log('  BLOCKER:', summary.current_blocker);
    console.log('  BLOCKER OWNER:', summary.blocker_owner);
  }
  console.log('');
}

showBeforeAfter().catch(console.error);
