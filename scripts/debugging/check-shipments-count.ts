import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Count shipments
  const { count, error } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log('Total shipments count:', count);
  if (error) console.log('Error:', error.message);

  // Get raw data
  const { data, error: err2 } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_name, etd, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\nRecent shipments:');
  console.log(JSON.stringify(data, null, 2));
  if (err2) console.log('Error:', err2.message);
}

main().catch(console.error);
