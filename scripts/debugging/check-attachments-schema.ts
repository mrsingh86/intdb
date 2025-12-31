import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkSchema() {
  // Get a sample row
  const { data, error } = await supabase
    .from('raw_attachments')
    .select('*')
    .limit(1);

  console.log('Sample row:', data);
  if (error) console.error('Error:', error);

  // Get count
  const { count } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });

  console.log('Total attachments in DB:', count);
}

checkSchema().catch(console.error);
