/**
 * Fix SI and VGM Tracking Issues
 *
 * Problems identified:
 * 1. SI submission emails marked as has_action=true (should be false - submission is DONE)
 * 2. Shipment stages not updated when SI/VGM submitted
 * 3. VGM submission emails not properly tracked
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSiVgmTracking() {
  console.log('=== FIXING SI/VGM TRACKING ISSUES ===\n');

  // Step 1: Fix has_action for SI submission emails
  // SI submission = DONE, not an action to do
  console.log('Step 1: Fixing has_action for SI submissions...');

  const { data: siSubmissions, error: siError } = await supabase
    .from('chronicle')
    .update({
      has_action: false,
      action_description: null,
      action_deadline: null,
      action_priority: null
    })
    .or('subject.ilike.SI submitted%,subject.ilike.Internet SI Submitted%')
    .eq('has_action', true)
    .select('id');

  console.log(`  Fixed ${siSubmissions?.length || 0} SI submission emails (has_action → false)`);

  // Step 2: Fix has_action for VGM submission emails
  console.log('\nStep 2: Fixing has_action for VGM submissions...');

  const { data: vgmSubmissions } = await supabase
    .from('chronicle')
    .update({
      has_action: false,
      action_description: null,
      action_deadline: null,
      action_priority: null
    })
    .or('subject.ilike.VGM submitted%,subject.ilike.%VGM confirmation%,subject.ilike.%VGM filed%')
    .eq('has_action', true)
    .select('id');

  console.log(`  Fixed ${vgmSubmissions?.length || 0} VGM submission emails (has_action → false)`);

  // Step 3: Update shipment stages based on SI submissions
  console.log('\nStep 3: Updating shipment stages from SI submissions...');

  // Get all SI submission emails with their shipment IDs
  const { data: siEmails } = await supabase
    .from('chronicle')
    .select('shipment_id, occurred_at, subject')
    .or('subject.ilike.SI submitted%,subject.ilike.Internet SI Submitted%')
    .not('shipment_id', 'is', null)
    .order('occurred_at', { ascending: false });

  // Group by shipment_id (keep most recent)
  const shipmentSiMap = new Map<string, { occurred_at: string; subject: string }>();
  for (const email of siEmails || []) {
    if (!shipmentSiMap.has(email.shipment_id)) {
      shipmentSiMap.set(email.shipment_id, { occurred_at: email.occurred_at, subject: email.subject });
    }
  }

  console.log(`  Found ${shipmentSiMap.size} shipments with SI submissions`);

  // Update stages for shipments that are still in early stages
  let stageUpdates = 0;
  for (const [shipmentId, siData] of shipmentSiMap) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, booking_number, stage')
      .eq('id', shipmentId)
      .single();

    if (!shipment) continue;

    // Only update if stage is before SI_SUBMITTED
    const earlyStages = ['PENDING', 'BOOKED', 'REQUESTED', 'SI_STAGE'];
    if (earlyStages.includes(shipment.stage || '')) {
      const { error } = await supabase
        .from('shipments')
        .update({ stage: 'SI_SUBMITTED' })
        .eq('id', shipmentId);

      if (!error) {
        console.log(`    ✓ ${shipment.booking_number}: ${shipment.stage} → SI_SUBMITTED`);
        stageUpdates++;
      }
    }
  }

  console.log(`  Updated ${stageUpdates} shipment stages to SI_SUBMITTED`);

  // Step 4: Check for VGM submissions and update summary
  console.log('\nStep 4: Checking VGM submission patterns...');

  const { data: vgmEmails } = await supabase
    .from('chronicle')
    .select('subject, document_type, shipment_id')
    .or('subject.ilike.%VGM%')
    .limit(20);

  console.log(`  Found ${vgmEmails?.length || 0} VGM-related emails`);

  // Show sample VGM patterns
  const vgmPatterns = new Set<string>();
  for (const email of vgmEmails || []) {
    if (email.subject?.toLowerCase().includes('vgm')) {
      // Extract pattern
      const pattern = email.subject.replace(/\d+/g, 'X').slice(0, 60);
      vgmPatterns.add(pattern);
    }
  }
  console.log('  VGM email patterns found:');
  for (const pattern of Array.from(vgmPatterns).slice(0, 10)) {
    console.log(`    - ${pattern}`);
  }

  // Step 5: Summary of current state
  console.log('\n=== CURRENT STATE SUMMARY ===\n');

  const { data: stageCounts } = await supabase
    .from('shipments')
    .select('stage')
    .not('status', 'eq', 'cancelled');

  const stageMap = new Map<string, number>();
  for (const s of stageCounts || []) {
    stageMap.set(s.stage || 'NULL', (stageMap.get(s.stage || 'NULL') || 0) + 1);
  }

  console.log('Shipment stages:');
  for (const [stage, count] of Array.from(stageMap.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stage}: ${count}`);
  }

  // Check pending actions that shouldn't be actions
  const { count: wrongActions } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .eq('has_action', true)
    .is('action_completed_at', null)
    .or('subject.ilike.SI submitted%,subject.ilike.%confirmation%,subject.ilike.%confirmed%');

  console.log(`\nPotentially wrong has_action=true (submissions/confirmations): ${wrongActions}`);

  console.log('\n=== DONE ===');
}

fixSiVgmTracking().catch(console.error);
