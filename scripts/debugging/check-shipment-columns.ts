import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get one shipment with all columns
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .limit(1)
    .single();

  console.log('All columns in shipments table:');
  const columns = Object.keys(shipment || {}).sort();
  for (const col of columns) {
    console.log(`  ${col}`);
  }

  // Check for carrier-related columns
  console.log('\nCarrier-related values:');
  console.log(`  carrier_id: ${shipment?.carrier_id}`);
  console.log(`  carrier_name: ${shipment?.carrier_name}`);
}

main().catch(console.error);
