import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get one shipment to see columns
  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .limit(1)
    .single();

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('=== SHIPMENT COLUMNS ===');
  const columns = Object.keys(data || {});
  columns.sort();
  for (const col of columns) {
    const val = data[col];
    const type = val === null ? 'null' : typeof val;
    console.log(`${col}: ${type} = ${JSON.stringify(val)?.substring(0, 50)}`);
  }
}

main().catch(console.error);
