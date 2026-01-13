/**
 * Diagnose action and cutoff extraction issues
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('=== DIAGNOSING ACTION REGISTRATION ISSUES ===\n');

  // 1. Check cutoff dates in shipments
  console.log('1. CUTOFF DATES IN SHIPMENTS TABLE:\n');
  const { data: shipmentCutoffs } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, etd')
    .not('status', 'eq', 'cancelled')
    .not('si_cutoff', 'is', null)
    .limit(5);

  console.log('Shipments with SI cutoff:', shipmentCutoffs?.length || 0);
  shipmentCutoffs?.forEach(s => {
    console.log(`  ${s.booking_number}: SI=${s.si_cutoff}, VGM=${s.vgm_cutoff}, Cargo=${s.cargo_cutoff}`);
  });

  // 2. Check cutoff dates in chronicle
  console.log('\n2. CUTOFF DATES IN CHRONICLE TABLE:\n');
  const { data: chronicleCutoffs, count: cutoffCount } = await supabase
    .from('chronicle')
    .select('id, document_type, si_cutoff, vgm_cutoff, cargo_cutoff, etd', { count: 'exact' })
    .not('si_cutoff', 'is', null)
    .limit(5);

  console.log('Chronicle entries with SI cutoff:', cutoffCount);
  chronicleCutoffs?.forEach(c => {
    console.log(`  ${c.document_type}: SI=${c.si_cutoff}, VGM=${c.vgm_cutoff}`);
  });

  // 3. Check action extraction quality
  console.log('\n3. ACTION EXTRACTION QUALITY:\n');
  const { count: totalActions } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .eq('has_action', true);

  const { count: actionsWithDesc } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .eq('has_action', true)
    .not('action_description', 'is', null);

  const { count: actionsWithDeadline } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .eq('has_action', true)
    .not('action_deadline', 'is', null);

  console.log(`Total has_action=true: ${totalActions}`);
  console.log(`With action_description: ${actionsWithDesc} (${((actionsWithDesc || 0) / (totalActions || 1) * 100).toFixed(1)}%)`);
  console.log(`With action_deadline: ${actionsWithDeadline} (${((actionsWithDeadline || 0) / (totalActions || 1) * 100).toFixed(1)}%)`);

  // 4. Sample of actions WITH descriptions
  console.log('\n4. SAMPLE ACTIONS WITH DESCRIPTIONS:\n');
  const { data: goodActions } = await supabase
    .from('chronicle')
    .select('document_type, action_description, action_deadline, action_priority')
    .eq('has_action', true)
    .not('action_description', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  goodActions?.forEach(a => {
    console.log(`  [${a.action_priority || 'medium'}] ${a.document_type}: ${a.action_description?.slice(0, 60)}`);
    if (a.action_deadline) console.log(`     Deadline: ${a.action_deadline}`);
  });

  // 5. Sample of actions WITHOUT descriptions (these are the problem)
  console.log('\n5. SAMPLE ACTIONS WITHOUT DESCRIPTIONS (PROBLEM):\n');
  const { data: badActions } = await supabase
    .from('chronicle')
    .select('id, document_type, summary, subject, has_action, action_description')
    .eq('has_action', true)
    .is('action_description', null)
    .order('created_at', { ascending: false })
    .limit(10);

  badActions?.forEach(a => {
    console.log(`  ${a.document_type}: "${a.subject?.slice(0, 50) || 'no subject'}"`);
    console.log(`     Summary: ${a.summary?.slice(0, 60) || 'no summary'}`);
    console.log(`     has_action=true but action_description=NULL`);
    console.log('');
  });

  // 6. Check AI summaries with narrative vs without
  console.log('\n6. AI SUMMARIES STATUS:\n');
  const { count: totalSummaries } = await supabase
    .from('shipment_ai_summaries')
    .select('id', { count: 'exact' });

  const { count: withNarrative } = await supabase
    .from('shipment_ai_summaries')
    .select('id', { count: 'exact' })
    .not('narrative', 'is', null);

  const { count: withKeyInsight } = await supabase
    .from('shipment_ai_summaries')
    .select('id', { count: 'exact' })
    .not('key_insight', 'is', null);

  console.log(`Total AI summaries: ${totalSummaries}`);
  console.log(`With narrative (V2 format): ${withNarrative}`);
  console.log(`With key_insight: ${withKeyInsight}`);
  console.log(`Without narrative (V1 only): ${(totalSummaries || 0) - (withNarrative || 0)}`);
}

diagnose().catch(console.error);
