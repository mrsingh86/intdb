require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function showDiverseExamples() {
  // Get diverse document types with template actions
  const documentTypes = [
    'booking_request',
    'booking_amendment',
    'draft_bl',
    'rate_request',
    'invoice',
    'request'
  ];

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    DIVERSE ACTION EXAMPLES: Different Document Types                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  for (const docType of documentTypes) {
    const { data } = await supabase
      .from('chronicle')
      .select(`
        subject, document_type, from_party, from_address,
        action_type, action_verb, action_description, action_owner,
        action_priority, action_priority_score, action_deadline, action_deadline_source,
        action_auto_resolve_on, action_source
      `)
      .eq('document_type', docType)
      .eq('action_source', 'template')
      .eq('has_action', true)
      .limit(1)
      .single();

    if (data) {
      console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
      console.log('  Document Type: ' + data.document_type.toUpperCase());
      console.log('────────────────────────────────────────────────────────────────────────────────────────────────────');
      console.log('');
      console.log('  Subject: "' + (data.subject || '').substring(0, 70) + '..."');
      console.log('  From: ' + data.from_party + ' (' + (data.from_address || 'N/A') + ')');
      console.log('');
      console.log('  ┌─ PRECISE ACTION FIELDS ─────────────────────────────────────────────────────────┐');
      console.log('  │');
      console.log('  │  action_type: ' + (data.action_type || 'N/A').padEnd(20) + '← What kind of action');
      console.log('  │  action_verb: ' + (data.action_verb || 'N/A').padEnd(20) + '← Short label for UI');
      console.log('  │  action_description: ' + (data.action_description || 'N/A').substring(0, 45));
      console.log('  │  action_owner: ' + (data.action_owner || 'N/A').padEnd(20) + '← Which team');
      console.log('  │  action_priority: ' + (data.action_priority || 'N/A').padEnd(10) + ' (score: ' + (data.action_priority_score || 'N/A') + ')');
      console.log('  │  action_deadline: ' + (data.action_deadline ? new Date(data.action_deadline).toLocaleDateString() : 'N/A'));
      console.log('  │  deadline_source: ' + (data.action_deadline_source || 'N/A').padEnd(30) + '← WHY this deadline');

      if (data.action_auto_resolve_on && data.action_auto_resolve_on.length > 0) {
        console.log('  │  auto_resolve_on: ' + data.action_auto_resolve_on.join(', '));
      }
      console.log('  │');
      console.log('  └──────────────────────────────────────────────────────────────────────────────────┘');
      console.log('');
    }
  }

  // Show how this flows into AI prompt
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    HOW THIS DATA FLOWS INTO AI SUMMARY PROMPT                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  When generating an AI summary for a shipment, the enhanced prompt now includes:');
  console.log('');
  console.log('  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ ## PENDING ACTIONS BY OWNER                                                                  │');
  console.log('  │                                                                                              │');
  console.log('  │ ### OPERATIONS TEAM (2 actions)                                                              │');
  console.log('  │   - [HIGH] Process Booking: Process booking request from ocean_carrier                       │');
  console.log('  │     Type: process | Deadline: Jan 18 (TOMORROW) (1 day(s) from receipt)                      │');
  console.log('  │     Contact: booking@maersk.com                                                              │');
  console.log('  │     Auto-resolves when: booking_confirmation                                                 │');
  console.log('  │                                                                                              │');
  console.log('  │   - [MEDIUM] Review Draft: Review and approve draft BL from customer                         │');
  console.log('  │     Type: review | Deadline: Jan 20 (in 3 days) (3 day(s) from receipt)                      │');
  console.log('  │     Contact: exports@shipper.com                                                             │');
  console.log('  │     Auto-resolves when: final_bl, telex_release                                              │');
  console.log('  │                                                                                              │');
  console.log('  │ ### FINANCE TEAM (1 action)                                                                  │');
  console.log('  │   - [MEDIUM] Review Invoice: Review invoice from customer and verify charges                 │');
  console.log('  │     Type: review | Deadline: Jan 22 (in 5 days) (3 day(s) from receipt)                      │');
  console.log('  │     Contact: accounts@customer.com                                                           │');
  console.log('  │                                                                                              │');
  console.log('  │ ### SALES TEAM (1 action)                                                                    │');
  console.log('  │   - [MEDIUM] Provide Rate: Prepare rate quotation for trucker                                │');
  console.log('  │     Type: respond | Deadline: Jan 18 (TOMORROW) (1 day(s) from receipt)                      │');
  console.log('  │     Contact: dispatch@trucker.com                                                            │');
  console.log('  └───────────────────────────────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  This rich context allows the AI to generate summaries like:');
  console.log('');
  console.log('  {');
  console.log('    "narrative": "Shipment has 4 pending actions across 3 teams. URGENT: Operations');
  console.log('                  must process the Maersk booking request by tomorrow. Sales also');
  console.log('                  needs to respond to the trucker rate request by end of day..."');
  console.log('    "next_action": "Process Booking: Process booking request from ocean_carrier",');
  console.log('    "action_owner": "operations",  ← Correctly identified from template');
  console.log('    "action_priority": "HIGH",     ← Based on deadline urgency');
  console.log('    "risk_level": "MEDIUM"         ← Multiple time-sensitive actions');
  console.log('  }');
  console.log('');
}

showDiverseExamples().catch(console.error);
