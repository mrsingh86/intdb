/**
 * Check rate_request misclassifications
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

async function check() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  // Find the misclassified ones
  const { data: episodes } = await supabase
    .from('learning_episodes')
    .select('predicted_document_type, classification_strategy, thread_position, chronicle_id')
    .order('created_at', { ascending: false })
    .limit(50);

  // Get chronicle subjects
  const chronicleIds = episodes?.map(e => e.chronicle_id) || [];
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, subject')
    .in('id', chronicleIds);

  const chronicleMap = new Map(chronicles?.map(c => [c.id, c]) || []);

  console.log('Checking rate_request classifications:');
  console.log('='.repeat(90));

  let count = 0;
  for (const ep of episodes || []) {
    const c = chronicleMap.get(ep.chronicle_id);
    if (c === undefined) continue;

    if (ep.predicted_document_type === 'rate_request') {
      count++;
      console.log(`${count}. Subject: ${c.subject.substring(0, 70)}`);
      console.log(`   Strategy: ${ep.classification_strategy}, Thread Position: ${ep.thread_position}`);
      console.log('-'.repeat(90));
    }
  }

  console.log(`\nTotal rate_request: ${count}`);
}

check().catch(console.error);
