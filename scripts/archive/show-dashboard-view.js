require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function showDashboard() {
  // Get recent AI summaries
  const { data: summaries } = await supabase
    .from('shipment_ai_summaries')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(3);

  if (!summaries || summaries.length === 0) {
    console.log('No AI summaries found');
    return;
  }

  for (let i = 0; i < Math.min(2, summaries.length); i++) {
    const summary = summaries[i];

    // Get shipment details
    const { data: shipment } = await supabase
      .from('shipments')
      .select('booking_number, stage, carrier_name, port_of_loading, port_of_discharge, etd, eta')
      .eq('id', summary.shipment_id)
      .single();

    // Get pending actions for this shipment
    const { data: pendingActions } = await supabase
      .from('chronicle')
      .select('action_verb, action_description, action_owner, action_priority, action_deadline, action_deadline_source, from_address')
      .eq('shipment_id', summary.shipment_id)
      .eq('has_action', true)
      .is('action_completed_at', null)
      .order('action_deadline', { ascending: true, nullsLast: true })
      .limit(5);

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SHIPMENT DASHBOARD VIEW                                                           ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    // Header
    console.log('┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  📦 SHIPMENT: ' + (shipment?.booking_number || summary.shipment_id.substring(0, 8)).padEnd(90) + '│');
    console.log('├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│  Stage: ' + (shipment?.stage || 'N/A').padEnd(20) + 'Carrier: ' + (shipment?.carrier_name || 'N/A').padEnd(25) + 'Route: ' + ((shipment?.port_of_loading || '?') + ' → ' + (shipment?.port_of_discharge || '?')).padEnd(25) + '│');
    if (shipment?.etd || shipment?.eta) {
      const etd = shipment?.etd ? new Date(shipment.etd).toLocaleDateString() : 'N/A';
      const eta = shipment?.eta ? new Date(shipment.eta).toLocaleDateString() : 'N/A';
      console.log('│  ETD: ' + etd.padEnd(22) + 'ETA: ' + eta.padEnd(67) + '│');
    }
    console.log('└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');

    // Risk Level Card
    const riskEmoji = summary.risk_level === 'red' ? '🔴' : summary.risk_level === 'amber' ? '🟡' : '🟢';
    const riskBg = summary.risk_level === 'red' ? 'CRITICAL' : summary.risk_level === 'amber' ? 'WARNING' : 'HEALTHY';
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  ' + riskEmoji + ' RISK: ' + riskBg.padEnd(15) + (summary.risk_reason ? '│ ' + summary.risk_reason.substring(0, 70) : '').padEnd(82) + '│');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');

    // AI Summary Card
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  📝 AI SUMMARY                                                                                                 │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    const story = summary.story || summary.narrative || 'No summary available';
    const storyLines = wrapText(story, 100);
    storyLines.forEach(line => {
      console.log('│  ' + line.padEnd(105) + '│');
    });
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');

    // Blocker Card (if exists)
    if (summary.current_blocker) {
      console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
      console.log('│  ⚠️  BLOCKER                                                                                                    │');
      console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
      console.log('│  ' + summary.current_blocker.substring(0, 100).padEnd(105) + '│');
      console.log('│  Owner: ' + (summary.blocker_owner || 'N/A').padEnd(30) + 'Type: ' + (summary.blocker_type || 'N/A').padEnd(60) + '│');
      console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
      console.log('');
    }

    // Next Action Card
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  ▶️  NEXT ACTION                                                                                                │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│  ' + (summary.next_action || 'No immediate action required').substring(0, 100).padEnd(105) + '│');
    console.log('│                                                                                                                 │');
    const ownerLine = '  Owner: ' + (summary.action_owner || 'N/A').padEnd(20) + 'Priority: ' + (summary.action_priority || 'N/A').toUpperCase().padEnd(15);
    const contactLine = summary.action_contact ? 'Contact: ' + summary.action_contact : '';
    console.log('│' + ownerLine + contactLine.padEnd(60) + '│');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');

    // Pending Actions Card (from chronicle with new fields)
    if (pendingActions && pendingActions.length > 0) {
      console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
      console.log('│  📋 PENDING ACTIONS (' + pendingActions.length + ')                                                                                       │');
      console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');

      // Group by owner
      const byOwner = {};
      for (const a of pendingActions) {
        const owner = a.action_owner || 'operations';
        if (!byOwner[owner]) byOwner[owner] = [];
        byOwner[owner].push(a);
      }

      for (const [owner, actions] of Object.entries(byOwner)) {
        console.log('│                                                                                                                 │');
        console.log('│  👥 ' + owner.toUpperCase() + ' TEAM                                                                                              │'.substring(0, 110));

        for (const a of actions.slice(0, 2)) {
          const priorityIcon = a.action_priority === 'URGENT' ? '🔴' : a.action_priority === 'HIGH' ? '🟠' : '🟡';
          const verb = a.action_verb || 'Review';
          const desc = a.action_description ? a.action_description.substring(0, 50) : '';
          const deadline = a.action_deadline ? new Date(a.action_deadline).toLocaleDateString() : 'No deadline';
          const reason = a.action_deadline_source ? ' (' + a.action_deadline_source + ')' : '';

          console.log('│     ' + priorityIcon + ' ' + verb + ': ' + desc.padEnd(85) + '│'.substring(0, 110));
          console.log('│        Deadline: ' + deadline + reason.padEnd(80) + '│'.substring(0, 110));
          if (a.from_address) {
            console.log('│        Contact: ' + a.from_address.padEnd(85) + '│'.substring(0, 110));
          }
        }
      }
      console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
      console.log('');
    }

    // Intelligence Signals Card
    const hasSignals = summary.escalation_count || summary.issue_count || summary.urgent_message_count || summary.days_since_activity;
    if (hasSignals) {
      console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
      console.log('│  📊 INTELLIGENCE SIGNALS                                                                                        │');
      console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
      let signals = [];
      if (summary.escalation_count) signals.push('Escalations: ' + summary.escalation_count);
      if (summary.issue_count) signals.push('Issues: ' + summary.issue_count);
      if (summary.urgent_message_count) signals.push('Urgent Messages: ' + summary.urgent_message_count);
      if (summary.days_since_activity !== null && summary.days_since_activity !== undefined) signals.push('Days Since Activity: ' + summary.days_since_activity);
      console.log('│  ' + signals.join('   │   ').padEnd(105) + '│');
      if (summary.carrier_performance) {
        console.log('│  Carrier: ' + summary.carrier_performance.padEnd(95) + '│');
      }
      console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    }

    console.log('');
    console.log('  ════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('  Generated: ' + (summary.updated_at ? new Date(summary.updated_at).toLocaleString() : 'N/A'));
    console.log('  Model: ' + (summary.model_used || 'claude-3-5-haiku') + ' | Cost: $' + (summary.generation_cost_usd || 0).toFixed(6) + ' | Chronicles: ' + (summary.chronicle_count || 'N/A'));
    console.log('');
  }
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
  return lines.length > 0 ? lines : [''];
}

showDashboard().catch(console.error);
