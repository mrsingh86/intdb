/**
 * Check if API returns AI summaries correctly
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('=== CHECKING AI SUMMARIES ===\n');

  // Check shipment_ai_summaries table directly
  const { data: summaries, count } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, narrative, story, key_insight, owner, risk_level', { count: 'exact' })
    .limit(5);

  console.log('Total AI summaries in database:', count);
  console.log('\nSample summaries:');

  for (const s of summaries || []) {
    console.log('\n---');
    console.log('shipment_id:', s.shipment_id);
    console.log('has narrative:', s.narrative ? 'YES' : 'NO');
    console.log('has story:', s.story ? 'YES' : 'NO');
    console.log('key_insight:', s.key_insight || 'NULL');
    console.log('owner:', s.owner || 'NULL');
    console.log('risk_level:', s.risk_level);
    if (s.narrative) {
      console.log('narrative preview:', s.narrative.slice(0, 100) + '...');
    }
  }

  // Check if these shipments exist in shipments table
  console.log('\n\n=== CHECKING SHIPMENTS WITH SUMMARIES ===\n');

  const shipmentIds = (summaries || []).map(s => s.shipment_id);
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status')
    .in('id', shipmentIds);

  console.log('Matching shipments found:', shipments?.length);
  shipments?.forEach(s => {
    console.log(`  - ${s.booking_number || s.id}: status=${s.status}`);
  });

  // Check chronicle entries for actions
  console.log('\n\n=== CHECKING ACTION REGISTRATION (VGM, SI, etc) ===\n');

  const { data: actions, count: actionCount } = await supabase
    .from('chronicle')
    .select('id, document_type, has_action, action_description, action_deadline, action_completed_at', { count: 'exact' })
    .eq('has_action', true)
    .is('action_completed_at', null)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('Total pending actions in chronicle:', actionCount);
  console.log('\nRecent pending actions:');

  for (const a of actions || []) {
    console.log(`\n- Type: ${a.document_type}`);
    console.log(`  Action: ${a.action_description?.slice(0, 80) || 'NULL'}`);
    console.log(`  Deadline: ${a.action_deadline || 'NULL'}`);
  }

  // Check for VGM/SI specific actions
  console.log('\n\n=== VGM/SI SPECIFIC ACTIONS ===\n');

  const { data: vgmSi } = await supabase
    .from('chronicle')
    .select('id, document_type, action_description, action_deadline')
    .eq('has_action', true)
    .is('action_completed_at', null)
    .or('action_description.ilike.%VGM%,action_description.ilike.%SI%,action_description.ilike.%shipping instruction%')
    .limit(10);

  console.log('VGM/SI related actions:', vgmSi?.length || 0);
  vgmSi?.forEach(a => {
    console.log(`  - ${a.action_description?.slice(0, 60)}`);
  });
}

check().catch(console.error);
