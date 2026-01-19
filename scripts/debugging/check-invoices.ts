import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { createClient } from '@supabase/supabase-js';

async function check() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  // Check learning episodes for recent invoices
  const { data: episodes } = await supabase
    .from('learning_episodes')
    .select('predicted_document_type, chronicle_id')
    .eq('predicted_document_type', 'invoice')
    .order('created_at', { ascending: false })
    .limit(5);

  if (episodes && episodes.length > 0) {
    const ids = episodes.map(e => e.chronicle_id);
    const { data: chronicles } = await supabase
      .from('chronicle')
      .select('subject, document_type, has_attachment, summary')
      .in('id', ids);

    console.log('Recent invoice classifications (with learning episodes):');
    console.log('='.repeat(80));
    chronicles?.forEach((c, i) => {
      console.log(`${i + 1}. ${c.subject.substring(0, 65)}`);
      console.log(`   Type: ${c.document_type}, Has Attachment: ${c.has_attachment}`);
      console.log(`   Summary: ${(c.summary || 'N/A').substring(0, 70)}`);
      console.log('');
    });
  } else {
    console.log('No invoice learning episodes found');
  }

  // Check rate_request count in recent episodes
  const { data: rateReqs } = await supabase
    .from('learning_episodes')
    .select('predicted_document_type, chronicle_id')
    .eq('predicted_document_type', 'rate_request')
    .order('created_at', { ascending: false })
    .limit(49);

  if (rateReqs) {
    console.log(`\nrate_request count in recent 49 episodes: ${rateReqs.length}`);

    if (rateReqs.length > 0) {
      const ids = rateReqs.map(e => e.chronicle_id);
      const { data: chronicles } = await supabase
        .from('chronicle')
        .select('subject')
        .in('id', ids);

      console.log('\nrate_request subjects:');
      chronicles?.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.subject.substring(0, 70)}`);
      });
    }
  }
}

check().catch(console.error);
