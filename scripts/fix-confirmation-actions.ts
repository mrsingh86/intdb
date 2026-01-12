/**
 * Fix Confirmation Actions
 *
 * This script fixes two issues:
 * 1. Confirmation documents (vgm_confirmation, si_confirmation, etc.) incorrectly have has_action=true
 * 2. Related pending actions need to be marked as completed
 *
 * Root cause: AI was extracting action language from confirmation emails
 * (e.g., "submit VGM on portal within 48 hours" appears in VGM confirmations)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Confirmation document types that should NOT create new actions
const CONFIRMATION_TYPES = [
  'vgm_confirmation',
  'si_confirmation',
  'sob_confirmation',
  'booking_confirmation',
  'approval',
  'acknowledgement',
];

// Map of confirmation types to keywords they resolve
const RESOLUTION_MAP: Record<string, string[]> = {
  vgm_confirmation: ['vgm', 'verified gross mass'],
  si_confirmation: ['si', 'shipping instruction'],
  sob_confirmation: ['shipped', 'on board', 'sob'],
  booking_confirmation: ['booking', 'book'],
  draft_bl: ['bl draft', 'draft bl'],
  final_bl: ['bl', 'bill of lading'],
  arrival_notice: ['arrival', 'arrive'],
};

async function main() {
  console.log('═'.repeat(70));
  console.log('FIX CONFIRMATION ACTIONS');
  console.log('═'.repeat(70));

  // Step 1: Find all confirmation documents with has_action = true
  console.log('\nStep 1: Finding confirmations with false has_action...\n');

  const { data: falseActions, error: fetchError } = await supabase
    .from('chronicle')
    .select('id, shipment_id, document_type, action_description, occurred_at')
    .in('document_type', CONFIRMATION_TYPES)
    .eq('has_action', true);

  if (fetchError) {
    console.error('Error fetching:', fetchError);
    return;
  }

  console.log(`Found ${falseActions?.length || 0} confirmation documents with has_action=true\n`);

  // Step 2: Clear has_action for confirmations
  if (falseActions && falseActions.length > 0) {
    console.log('Step 2: Clearing has_action for confirmation documents...\n');

    const { error: updateError } = await supabase
      .from('chronicle')
      .update({
        has_action: false,
        action_description: null,
        action_owner: null,
        action_deadline: null,
        action_priority: null,
      })
      .in('document_type', CONFIRMATION_TYPES)
      .eq('has_action', true);

    if (updateError) {
      console.error('Error updating:', updateError);
      return;
    }

    console.log(`✅ Cleared has_action for ${falseActions.length} confirmations\n`);
  }

  // Step 3: Find all confirmations with shipment_id and resolve related actions
  console.log('Step 3: Resolving related pending actions...\n');

  const { data: confirmations, error: confError } = await supabase
    .from('chronicle')
    .select('id, shipment_id, document_type, occurred_at')
    .in('document_type', Object.keys(RESOLUTION_MAP))
    .not('shipment_id', 'is', null)
    .order('occurred_at', { ascending: true });

  if (confError) {
    console.error('Error fetching confirmations:', confError);
    return;
  }

  console.log(`Found ${confirmations?.length || 0} confirmation documents linked to shipments\n`);

  let totalResolved = 0;
  const shipmentsSeen = new Map<string, string>(); // shipment_id -> earliest confirmation date

  for (const conf of confirmations || []) {
    const keywords = RESOLUTION_MAP[conf.document_type];
    if (!keywords || keywords.length === 0) continue;

    // Track earliest confirmation per shipment
    const key = `${conf.shipment_id}-${conf.document_type}`;
    if (shipmentsSeen.has(key)) continue;
    shipmentsSeen.set(key, conf.occurred_at);

    // Build keyword match condition for action_description
    const keywordConditions = keywords
      .map(kw => `action_description.ilike.%${kw}%`)
      .join(',');

    // Update pending actions that match keywords
    const { data: resolved, error: resolveError } = await supabase
      .from('chronicle')
      .update({ action_completed_at: conf.occurred_at })
      .eq('shipment_id', conf.shipment_id)
      .eq('has_action', true)
      .is('action_completed_at', null)
      .lt('occurred_at', conf.occurred_at) // Only resolve actions from BEFORE the confirmation
      .or(keywordConditions)
      .select('id');

    if (resolveError) {
      console.error(`Error resolving for ${conf.shipment_id}:`, resolveError);
      continue;
    }

    if (resolved && resolved.length > 0) {
      console.log(`  ${conf.document_type} resolved ${resolved.length} action(s) for shipment`);
      totalResolved += resolved.length;
    }
  }

  console.log(`\n✅ Resolved ${totalResolved} pending actions\n`);

  // Step 4: Summary report
  console.log('═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Confirmations with has_action cleared: ${falseActions?.length || 0}`);
  console.log(`Pending actions resolved: ${totalResolved}`);

  // Step 5: Check shipment 41498257 specifically
  console.log('\n' + '═'.repeat(70));
  console.log('VERIFICATION: Shipment 41498257');
  console.log('═'.repeat(70));

  const { data: shipment41498257 } = await supabase
    .from('shipments')
    .select('id')
    .eq('booking_number', '41498257')
    .single();

  if (shipment41498257) {
    const { data: actions } = await supabase
      .from('chronicle')
      .select('document_type, has_action, action_description, action_completed_at')
      .eq('shipment_id', shipment41498257.id)
      .eq('has_action', true);

    console.log(`\nPending actions for 41498257: ${actions?.filter(a => !a.action_completed_at).length || 0}`);
    console.log(`Completed actions: ${actions?.filter(a => a.action_completed_at).length || 0}`);

    const pending = actions?.filter(a => !a.action_completed_at) || [];
    if (pending.length > 0) {
      console.log('\nRemaining pending actions:');
      for (const a of pending) {
        console.log(`  - [${a.document_type}] ${a.action_description?.substring(0, 60)}`);
      }
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
