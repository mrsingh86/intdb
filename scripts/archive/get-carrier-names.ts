import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const { data, error } = await supabase
    .from('carrier_configs')
    .select('*');

  console.log('Carrier configs:');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
