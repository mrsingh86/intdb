import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fix() {
  console.log('Fixing shipment 24926645 with correct vessel ETD/ETA...\n');

  // Find the shipment
  const { data: shipment, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('booking_number', '24926645')
    .single();

  if (error || !shipment) {
    console.log('Shipment not found:', error?.message);
    return;
  }

  console.log('Current values:');
  console.log('  ETD:', shipment.etd);
  console.log('  ETA:', shipment.eta);
  console.log('  POL:', shipment.port_of_loading);
  console.log('  POD:', shipment.port_of_discharge);

  // Update with correct vessel dates
  // From email: Vessel ETD 31-Dec-2025, ETA 31-Jan-2026 at USNYC
  const { error: updateError } = await supabase
    .from('shipments')
    .update({
      etd: '2025-12-31',
      eta: '2026-01-31',
      port_of_loading: 'MUNDRA',
      port_of_loading_code: 'INMUN',
      port_of_discharge: 'NEW YORK',
      port_of_discharge_code: 'USNYC'
    })
    .eq('id', shipment.id);

  if (updateError) {
    console.log('\nError updating:', updateError.message);
  } else {
    console.log('\n✓ Updated with correct vessel dates:');
    console.log('  ETD: 2025-12-31 (vessel departs MUNDRA)');
    console.log('  ETA: 2026-01-31 (vessel arrives NEW YORK)');
    console.log('  Transit: 31 days');
  }
}

fix().catch(console.error);
