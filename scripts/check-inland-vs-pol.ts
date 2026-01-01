import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get shipments with inland locations
  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, place_of_receipt, port_of_loading, port_of_loading_code, place_of_delivery, port_of_discharge, port_of_discharge_code')
    .not('place_of_receipt', 'is', null)
    .limit(10);

  console.log('═'.repeat(80));
  console.log('SHIPMENTS WITH INLAND LOCATIONS - CHECKING POL/POD');
  console.log('═'.repeat(80));

  for (const s of shipments || []) {
    console.log(`\n${s.booking_number}:`);
    console.log(`  Inland Origin: ${s.place_of_receipt || 'null'}`);
    console.log(`  POL: ${s.port_of_loading} (${s.port_of_loading_code || 'NO CODE'})`);
    console.log(`  Inland Dest: ${s.place_of_delivery || 'null'}`);
    console.log(`  POD: ${s.port_of_discharge} (${s.port_of_discharge_code || 'NO CODE'})`);

    // Check if POL/POD looks like inland location (not a seaport)
    const polLooksInland = s.port_of_loading && (
      s.port_of_loading.toLowerCase().includes('icd') ||
      s.port_of_loading.toLowerCase().includes('terminal') ||
      s.port_of_loading.toLowerCase().includes('depot') ||
      s.port_of_loading.toLowerCase().includes('ludhiana') ||
      s.port_of_loading.toLowerCase().includes('gurgaon')
    );

    if (polLooksInland) {
      console.log(`  ⚠️ POL looks like inland location, not seaport!`);
    }
  }
}

main().catch(console.error);
