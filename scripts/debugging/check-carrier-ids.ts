import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get distinct carrier_ids from shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('carrier_id, booking_number')
    .limit(5);

  console.log('Sample shipments with carrier_id:');
  console.log(JSON.stringify(shipments, null, 2));

  // Get unique carrier IDs
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('carrier_id');

  const uniqueCarrierIds = [...new Set((allShipments || []).map(s => s.carrier_id))];
  console.log('\nUnique carrier_ids in shipments:');
  for (const id of uniqueCarrierIds) {
    const count = (allShipments || []).filter(s => s.carrier_id === id).length;
    console.log(`  ${id}: ${count} shipments`);
  }

  // Check if there's a lookup table
  console.log('\nLet me check for carrier lookup tables...');

  // Try orion_carriers
  const { data: orionCarriers, error } = await supabase
    .from('orion_carriers')
    .select('*');

  if (orionCarriers) {
    console.log('\norion_carriers table:');
    console.log(JSON.stringify(orionCarriers, null, 2));
  } else if (error) {
    console.log('orion_carriers not found:', error.message);
  }
}

main().catch(console.error);
