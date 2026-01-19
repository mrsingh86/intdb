/**
 * Test the improved AI summary with COMPLETION STATUS section
 * Testing on shipment 263814897 that previously showed incorrect "cutoffs passed" message
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).
Transform shipment data into clear, actionable narrative.
Return JSON with: story, narrative, currentBlocker, blockerOwner, blockerType, nextAction, actionOwner, actionContact, actionPriority, financialImpact, customerImpact, customerActionRequired, riskLevel, riskReason`;

async function testImprovedSummary() {
  // Get the problematic shipment
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
  console.log('║                     TESTING IMPROVED AI SUMMARY WITH COMPLETION STATUS                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Shipment:', shipment.booking_number);
  console.log('  Stage:', shipment.stage);
  console.log('  Carrier:', shipment.carrier_name);
  console.log('');

  // Get chronicle data
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select(`
      occurred_at, direction, from_party, document_type, summary,
      has_action, action_description, action_priority, action_deadline, action_completed_at,
      action_owner, action_verb, action_type
    `)
    .eq('shipment_id', shipment.id)
    .order('occurred_at', { ascending: false })
    .limit(20);

  // Check what milestones exist
  const docTypes = new Set((chronicles || []).map(c => c.document_type?.toLowerCase()).filter(Boolean));

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  ACTUAL MILESTONES IN DATA');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Document types found:', Array.from(docTypes).join(', '));
  console.log('');
  console.log('  Key Milestones:');
  console.log('    Booking Confirmation:', docTypes.has('booking_confirmation') ? '✅ YES' : '❌ NO');
  console.log('    SI Submitted:', (docTypes.has('shipping_instructions') || docTypes.has('si_confirmation') || docTypes.has('si_submitted')) ? '✅ YES' : '❌ NO');
  console.log('    SI Confirmed:', docTypes.has('si_confirmation') ? '✅ YES' : '❌ NO');
  console.log('    VGM Confirmed:', docTypes.has('vgm_confirmation') ? '✅ YES' : '❌ NO');
  console.log('    Draft BL:', (docTypes.has('draft_bl') || docTypes.has('bl_draft')) ? '✅ YES' : '❌ NO');
  console.log('    Final BL:', (docTypes.has('final_bl') || docTypes.has('bl_final') || docTypes.has('sea_waybill')) ? '✅ YES' : '❌ NO');
  console.log('');

  // Build completion status section (same logic as HaikuSummaryService)
  const completedMilestones = [];
  const pendingMilestones = [];

  if (docTypes.has('booking_confirmation')) completedMilestones.push('✅ Booking Confirmed');
  else pendingMilestones.push('⏳ Booking Confirmation');

  if (docTypes.has('shipping_instructions') || docTypes.has('si_confirmation') || docTypes.has('si_submitted')) {
    completedMilestones.push('✅ SI Submitted');
  } else {
    pendingMilestones.push('⏳ SI Submission');
  }

  if (docTypes.has('si_confirmation')) completedMilestones.push('✅ SI Confirmed');
  if (docTypes.has('vgm_confirmation')) completedMilestones.push('✅ VGM Confirmed');
  else pendingMilestones.push('⏳ VGM Submission');

  if (docTypes.has('draft_bl') || docTypes.has('bl_draft')) completedMilestones.push('✅ Draft BL Received');
  if (docTypes.has('final_bl') || docTypes.has('bl_final') || docTypes.has('sea_waybill')) {
    completedMilestones.push('✅ Final BL/SWB Issued');
  }

  const completionStatusSection = `
## COMPLETION STATUS (What is DONE vs PENDING)
COMPLETED: ${completedMilestones.length > 0 ? completedMilestones.join(' | ') : 'None yet'}
STILL NEEDED: ${pendingMilestones.length > 0 ? pendingMilestones.join(' | ') : 'All complete'}

IMPORTANT: Do NOT say cutoffs "passed" if the required document was submitted BEFORE the cutoff.
If SI is submitted/confirmed, the SI cutoff was MET, not missed.`;

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  NEW COMPLETION STATUS SECTION (Added to Prompt)');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(completionStatusSection);
  console.log('');

  // Get pending actions count
  const pendingActions = chronicles.filter(c => c.has_action && !c.action_completed_at);
  const completedActions = chronicles.filter(c => c.has_action && c.action_completed_at);

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  ACTION STATUS (After Backfill)');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Pending Actions:', pendingActions.length);
  console.log('  Completed Actions:', completedActions.length);
  console.log('');

  // Build prompt with new completion status
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const prompt = `
## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment.booking_number}
Stage: ${shipment.stage}
Carrier: ${shipment.carrier_name}
SI Cutoff: ${shipment.si_cutoff || 'N/A'}
Cargo Cutoff: ${shipment.cargo_cutoff || 'N/A'}
${completionStatusSection}

## PENDING ACTIONS: ${pendingActions.length}
${pendingActions.length > 0 ? pendingActions.slice(0, 5).map(a => `- ${a.action_description || 'Review'}`).join('\n') : 'None'}

Return JSON summary. Focus on COMPLETED milestones when describing status.`;

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  CALLING AI WITH NEW PROMPT');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const jsonMatch = (response.content[0].text || '').match(/\{[\s\S]*\}/);
  const json = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  AI OUTPUT (WITH COMPLETION STATUS)');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  STORY:');
  console.log('  ' + (json.story || 'N/A'));
  console.log('');
  console.log('  NARRATIVE:');
  console.log('  ' + (json.narrative || 'N/A'));
  console.log('');
  console.log('  NEXT ACTION:', json.nextAction || 'N/A');
  console.log('  ACTION OWNER:', json.actionOwner || 'N/A');
  console.log('  RISK LEVEL:', json.riskLevel || 'N/A');
  console.log('  RISK REASON:', json.riskReason || 'N/A');
  console.log('');

  // Check if it correctly mentions SI/VGM completed
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  VALIDATION');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const story = (json.story || '').toLowerCase();
  const narrative = (json.narrative || '').toLowerCase();

  if (story.includes('cutoff') && story.includes('passed') && !story.includes('met')) {
    console.log('  ⚠️  ISSUE: AI still says cutoffs "passed" - may need prompt adjustment');
  } else if (story.includes('confirmed') || story.includes('submitted') || story.includes('complete')) {
    console.log('  ✅ GOOD: AI correctly mentions completed milestones');
  }

  if (docTypes.has('vgm_confirmation') && !story.includes('vgm') && !narrative.includes('vgm')) {
    console.log('  ⚠️  ISSUE: VGM is confirmed but not mentioned');
  }

  if (docTypes.has('si_confirmation') && !story.includes('si') && !narrative.includes('si')) {
    console.log('  ⚠️  ISSUE: SI is confirmed but not mentioned');
  }

  console.log('');
}

testImprovedSummary().catch(console.error);
