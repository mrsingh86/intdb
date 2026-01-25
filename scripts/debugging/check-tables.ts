import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('URL:', url.substring(0, 30) + '...');
console.log('Key set:', key.length > 0);

const supabase = createClient(url, key);

async function main() {
  const tables = ['email_notifications', 'emails', 'chronicle', 'shipments', 'ai_shipment_summaries'];

  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    console.log(table + ':', error ? error.message : count);
  }

  const { data: sample } = await supabase
    .from('email_notifications')
    .select('shipment_id')
    .not('shipment_id', 'is', null)
    .limit(5);

  console.log('\nSample shipment_ids from email_notifications:', sample);
}

main().catch(console.error);
