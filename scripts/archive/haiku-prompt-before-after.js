require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function showPromptChanges() {
  // Get some real pending actions with precise action data
  const { data: actions } = await supabase
    .from('chronicle')
    .select(`
      subject, document_type, from_party, from_address,
      has_action, action_description, action_priority, action_deadline,
      action_type, action_verb, action_owner, action_deadline_source, action_auto_resolve_on,
      action_source
    `)
    .eq('has_action', true)
    .eq('action_source', 'template')
    .is('action_completed_at', null)
    .not('action_deadline', 'is', null)
    .order('action_deadline', { ascending: true })
    .limit(5);

  if (!actions || actions.length === 0) {
    console.log('No pending template actions found');
    return;
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    HAIKU SUMMARY SERVICE: BEFORE vs AFTER                                         ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  The AI prompt now includes RICH action data for better narrative generation                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Show before format
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  BEFORE: Simple pending actions in AI prompt');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  ## PENDING ACTIONS');
  actions.forEach((a, i) => {
    const priority = a.action_priority || 'MEDIUM';
    const deadline = a.action_deadline ? formatDeadline(a.action_deadline) : 'no deadline';
    console.log('  - [' + priority + '] ' + (a.action_description || 'Review document') + ' (' + deadline + ')');
  });
  console.log('');
  console.log('  → AI had to GUESS: Who should do this? Why this deadline? What exactly to do?');
  console.log('');

  // Show after format
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  AFTER: Rich action data grouped by owner');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Group by owner
  const byOwner = {};
  for (const a of actions) {
    const owner = a.action_owner || 'operations';
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(a);
  }

  console.log('  ## PENDING ACTIONS BY OWNER');
  console.log('');

  for (const [owner, ownerActions] of Object.entries(byOwner)) {
    console.log('  ### ' + owner.toUpperCase() + ' TEAM (' + ownerActions.length + ' action' + (ownerActions.length > 1 ? 's' : '') + ')');

    for (const a of ownerActions) {
      const priority = a.action_priority || 'MEDIUM';
      const actionType = a.action_type || 'review';
      const verb = a.action_verb || 'Review';
      const deadline = a.action_deadline ? formatDeadlineWithDays(a.action_deadline) : 'no deadline';
      const deadlineReason = a.action_deadline_source ? ' (' + a.action_deadline_source + ')' : '';
      const contact = a.from_address ? '\n      Contact: ' + a.from_address : '';
      const autoResolve = a.action_auto_resolve_on && a.action_auto_resolve_on.length > 0
        ? '\n      Auto-resolves when: ' + a.action_auto_resolve_on.join(', ')
        : '';

      console.log('    - [' + priority + '] ' + verb + ': ' + a.action_description);
      console.log('      Type: ' + actionType + ' | Deadline: ' + deadline + deadlineReason + contact + autoResolve);
      console.log('');
    }
  }

  console.log('');
  console.log('  → AI now KNOWS: Exact owner, action type, deadline reason, contact info, auto-resolution');
  console.log('');

  // Show example AI output difference
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  IMPACT ON AI SUMMARY OUTPUT');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  BEFORE AI might generate:');
  console.log('  ─────────────────────────');
  console.log('  next_action: "Review pending documents"');
  console.log('  action_owner: "operations"  ← Always defaulted to operations');
  console.log('  action_priority: "MEDIUM"   ← Generic priority');
  console.log('');
  console.log('  AFTER AI generates:');
  console.log('  ──────────────────');

  // Find the most urgent action
  const urgent = actions.sort((a, b) => {
    const scoreA = getPriorityScore(a.action_priority);
    const scoreB = getPriorityScore(b.action_priority);
    return scoreB - scoreA;
  })[0];

  if (urgent) {
    console.log('  next_action: "' + urgent.action_verb + ': ' + (urgent.action_description || '').substring(0, 50) + '"');
    console.log('  action_owner: "' + (urgent.action_owner || 'operations') + '"  ← From template');
    console.log('  action_priority: "' + (urgent.action_priority || 'MEDIUM') + '"  ← From template');
    if (urgent.action_deadline_source) {
      console.log('  deadline_reason: "' + urgent.action_deadline_source + '"');
    }
  }
  console.log('');

  // Show real data examples
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  REAL DATA: Sample actions with new fields');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  for (let i = 0; i < Math.min(3, actions.length); i++) {
    const a = actions[i];
    console.log('  ' + (i+1) + '. "' + (a.subject || '').substring(0, 60) + '..."');
    console.log('     document_type: ' + a.document_type);
    console.log('     from_party: ' + a.from_party);
    console.log('     ');
    console.log('     action_type: ' + (a.action_type || 'N/A'));
    console.log('     action_verb: ' + (a.action_verb || 'N/A'));
    console.log('     action_owner: ' + (a.action_owner || 'N/A'));
    console.log('     action_priority: ' + (a.action_priority || 'N/A'));
    console.log('     action_deadline: ' + (a.action_deadline ? new Date(a.action_deadline).toLocaleDateString() : 'N/A'));
    console.log('     action_deadline_source: ' + (a.action_deadline_source || 'N/A'));
    console.log('     action_auto_resolve_on: ' + (a.action_auto_resolve_on ? a.action_auto_resolve_on.join(', ') : 'N/A'));
    console.log('');
  }
}

function formatDeadline(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return 'in ' + diffDays + ' days';
}

function formatDeadlineWithDays(dateStr) {
  const date = new Date(dateStr);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const now = new Date();
  const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return formatted + ' (OVERDUE by ' + Math.abs(diffDays) + ' days)';
  if (diffDays === 0) return formatted + ' (TODAY)';
  if (diffDays === 1) return formatted + ' (TOMORROW)';
  return formatted + ' (in ' + diffDays + ' days)';
}

function getPriorityScore(priority) {
  const scores = { 'URGENT': 100, 'HIGH': 80, 'MEDIUM': 50, 'LOW': 20 };
  return scores[priority] || 50;
}

showPromptChanges().catch(console.error);
