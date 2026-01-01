import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get recent shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, vessel_name, etd, eta, port_of_loading, port_of_discharge, created_at, created_from_email_id')
    .gt('created_at', '2024-12-29')
    .order('created_at', { ascending: false });

  console.log('=== RECENT SHIPMENTS ===');
  console.log(`Found ${shipments?.length || 0} shipments since Dec 29\n`);

  for (const s of shipments || []) {
    console.log('---');
    console.log('Booking:', s.booking_number);
    console.log('Vessel:', s.vessel_name);
    console.log('ETD:', s.etd);
    console.log('ETA:', s.eta);
    console.log('POL:', s.port_of_loading);
    console.log('POD:', s.port_of_discharge);
    console.log('Created:', s.created_at);

    // Check if dates look wrong (before 2024)
    const etdYear = s.etd ? parseInt(s.etd.substring(0, 4)) : null;
    const etaYear = s.eta ? parseInt(s.eta.substring(0, 4)) : null;

    if ((etdYear && etdYear < 2024) || (etaYear && etaYear < 2024)) {
      console.log('⚠️ BAD DATA: Dates are from before 2024!');
    }
  }
}
main().catch(console.error);
