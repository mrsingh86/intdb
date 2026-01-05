import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═'.repeat(70));
  console.log('INVESTIGATING DUPLICATE: 263368698 vs MAEU263368698');
  console.log('═'.repeat(70));

  // Get both shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .or('booking_number.eq.263368698,booking_number.eq.MAEU263368698');

  if (!shipments || shipments.length < 2) {
    console.log('Did not find both duplicates');
    return;
  }

  for (const s of shipments) {
    console.log(`\n─── ${s.booking_number} ───`);
    console.log(`  ID: ${s.id}`);
    console.log(`  Created: ${s.created_at}`);
    console.log(`  Vessel: ${s.vessel_name} / ${s.voyage_number}`);
    console.log(`  POL: ${s.port_of_loading} (${s.port_of_loading_code})`);
    console.log(`  POD: ${s.port_of_discharge} (${s.port_of_discharge_code})`);
    console.log(`  ETD: ${s.etd}, ETA: ${s.eta}`);
    console.log(`  SI Cutoff: ${s.si_cutoff}`);
    console.log(`  Gate Cutoff: ${s.gate_cutoff}`);
    console.log(`  Source Email: ${s.created_from_email_id || 'None'}`);
    console.log(`  Place of Receipt: ${s.place_of_receipt || 'null'}`);
    console.log(`  Place of Delivery: ${s.place_of_delivery || 'null'}`);
  }

  // Determine which to keep
  // Prefer: more data, correct booking format (9-digit for Maersk)
  const s1 = shipments.find(s => s.booking_number === '263368698');
  const s2 = shipments.find(s => s.booking_number === 'MAEU263368698');

  console.log('\n' + '═'.repeat(70));
  console.log('ANALYSIS:');
  console.log('═'.repeat(70));
  console.log('- Maersk booking numbers are 9 digits without prefix');
  console.log('- MAEU is container prefix, not booking prefix');
  console.log('- Will keep: 263368698 (correct format)');
  console.log('- Will delete: MAEU263368698 (incorrect format)');

  // Check if they have the same data
  if (s1 && s2) {
    const same = s1.vessel_name === s2.vessel_name &&
                 s1.etd === s2.etd &&
                 s1.port_of_loading_code === s2.port_of_loading_code;
    console.log(`\nData is ${same ? 'identical' : 'different'}`);
  }

  // Delete the duplicate
  console.log('\n' + '═'.repeat(70));
  console.log('DELETING MAEU263368698...');
  console.log('═'.repeat(70));

  const { error } = await supabase
    .from('shipments')
    .delete()
    .eq('booking_number', 'MAEU263368698');

  if (error) {
    console.log(`❌ Error: ${error.message}`);
  } else {
    console.log('✅ Deleted MAEU263368698');
  }

  // Verify
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal shipments now: ${count}`);
}

main().catch(console.error);
