require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function investigate() {
  // Get the shipment we saw
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('booking_number', '263814897')
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    INVESTIGATING: Is AI Summary Accurate?                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Shipment:', shipment.booking_number);
  console.log('  Stage:', shipment.stage);
  console.log('  SI Cutoff:', shipment.si_cutoff || 'N/A');
  console.log('  Cargo Cutoff:', shipment.cargo_cutoff || 'N/A');
  console.log('');

  // Get ALL chronicle entries for this shipment
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('occurred_at, document_type, from_party, summary, has_action, action_completed_at, action_description')
    .eq('shipment_id', shipment.id)
    .order('occurred_at', { ascending: true });

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  ACTUAL CHRONICLE DATA (What really happened)');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Check for key milestones
  const milestones = {
    si_submitted: false,
    si_confirmation: false,
    vgm_confirmation: false,
    booking_confirmation: false,
    draft_bl: false,
    final_bl: false
  };

  for (const c of chronicles || []) {
    const date = new Date(c.occurred_at).toLocaleDateString();
    const docType = c.document_type || 'unknown';
    const actionStatus = c.has_action ? (c.action_completed_at ? '✅ DONE' : '⏳ PENDING') : '';

    // Track milestones
    if (docType.includes('si_') || docType === 'shipping_instructions') milestones.si_submitted = true;
    if (docType === 'si_confirmation') milestones.si_confirmation = true;
    if (docType === 'vgm_confirmation') milestones.vgm_confirmation = true;
    if (docType === 'booking_confirmation') milestones.booking_confirmation = true;
    if (docType === 'draft_bl') milestones.draft_bl = true;
    if (docType === 'final_bl' || docType === 'bl_final') milestones.final_bl = true;

    console.log('  ' + date + ' | ' + docType.padEnd(25) + ' | ' + (c.from_party || '').padEnd(15) + ' | ' + actionStatus);
    console.log('           ' + (c.summary || '').substring(0, 80));
    console.log('');
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  MILESTONE STATUS');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Booking Confirmation:', milestones.booking_confirmation ? '✅ YES' : '❌ NO');
  console.log('  SI Submitted:', milestones.si_submitted ? '✅ YES' : '❌ NO');
  console.log('  SI Confirmation:', milestones.si_confirmation ? '✅ YES' : '❌ NO');
  console.log('  VGM Confirmation:', milestones.vgm_confirmation ? '✅ YES' : '❌ NO');
  console.log('  Draft BL:', milestones.draft_bl ? '✅ YES' : '❌ NO');
  console.log('  Final BL:', milestones.final_bl ? '✅ YES' : '❌ NO');
  console.log('');

  // Check pending vs completed actions
  const pendingActions = chronicles.filter(c => c.has_action && !c.action_completed_at);
  const completedActions = chronicles.filter(c => c.has_action && c.action_completed_at);

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  ACTION STATUS');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Completed Actions:', completedActions.length);
  console.log('  Pending Actions:', pendingActions.length);
  console.log('');

  if (pendingActions.length > 0) {
    console.log('  PENDING:');
    pendingActions.slice(0, 5).forEach(a => {
      console.log('    - ' + (a.action_description || 'Review').substring(0, 70));
    });
  }
  console.log('');

  // Get the AI summary
  const { data: summary } = await supabase
    .from('shipment_ai_summaries')
    .select('story, narrative, next_action, current_blocker')
    .eq('shipment_id', shipment.id)
    .single();

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  AI SUMMARY (What AI said)');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Story:', summary?.story || 'N/A');
  console.log('');
  console.log('  Narrative:', summary?.narrative || 'N/A');
  console.log('');
  console.log('  Next Action:', summary?.next_action || 'N/A');
  console.log('  Blocker:', summary?.current_blocker || 'N/A');
  console.log('');

  // Analysis
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  ANALYSIS: Is AI Summary Accurate?');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  if (milestones.si_confirmation && summary?.story?.includes('SI')) {
    console.log('  ⚠️  ISSUE: AI says SI cutoff passed, but SI CONFIRMATION was received!');
    console.log('     AI should say "SI submitted and confirmed" not "cutoff passed"');
  }

  if (shipment.stage === 'BL_ISSUED' && summary?.story?.includes('documentation verification')) {
    console.log('  ⚠️  ISSUE: Stage is BL_ISSUED but AI talks about pending documentation');
    console.log('     If BL is issued, most documentation should be complete');
  }

  console.log('');
  console.log('  The AI summary may not be correctly reading the COMPLETED milestones.');
  console.log('  It sees pending ACTIONS but may not see that SI/VGM were already CONFIRMED.');
  console.log('');
}

investigate().catch(console.error);
