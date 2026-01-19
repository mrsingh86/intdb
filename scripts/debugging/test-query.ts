import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function test() {
  console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

  // Test 1: Get ALL attachments with null extracted_text
  const { data: all, error: err1 } = await supabase
    .from('raw_attachments')
    .select('id, filename, mime_type')
    .is('extracted_text', null)
    .limit(10);

  console.log('\nQuery 1 - extracted_text IS NULL:');
  console.log('  Error:', err1?.message || 'none');
  console.log('  Count:', all?.length || 0);
  if (all?.length) console.log('  Sample:', all[0]);

  // Test 2: Count all
  const { count, error: err2 } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .is('extracted_text', null);

  console.log('\nQuery 2 - Count with extracted_text IS NULL:');
  console.log('  Error:', err2?.message || 'none');
  console.log('  Count:', count);
}

test().catch(console.error);
