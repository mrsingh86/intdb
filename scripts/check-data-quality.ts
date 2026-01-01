import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get all shipments with key fields
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, port_of_loading, port_of_discharge, etd, eta, vessel_name, created_at')
    .order('created_at', { ascending: false });

  // Split by date (Dec 30 was original 95, Jan 1 is new)
  const cutoffDate = new Date('2025-12-31');
  
  const oldShipments = shipments?.filter(s => new Date(s.created_at) < cutoffDate) || [];
  const newShipments = shipments?.filter(s => new Date(s.created_at) >= cutoffDate) || [];

  console.log('=== OLD SHIPMENTS (original 95) ===');
  console.log('Count:', oldShipments.length);
  console.log('With POL:', oldShipments.filter(s => s.port_of_loading).length);
  console.log('With POD:', oldShipments.filter(s => s.port_of_discharge).length);
  console.log('With ETD:', oldShipments.filter(s => s.etd).length);
  console.log('With ETA:', oldShipments.filter(s => s.eta).length);
  console.log('With Vessel:', oldShipments.filter(s => s.vessel_name).length);

  console.log('\n=== NEW SHIPMENTS (added today) ===');
  console.log('Count:', newShipments.length);
  console.log('With POL:', newShipments.filter(s => s.port_of_loading).length);
  console.log('With POD:', newShipments.filter(s => s.port_of_discharge).length);
  console.log('With ETD:', newShipments.filter(s => s.etd).length);
  console.log('With ETA:', newShipments.filter(s => s.eta).length);
  console.log('With Vessel:', newShipments.filter(s => s.vessel_name).length);

  console.log('\n=== NEW SHIPMENTS DETAIL ===');
  for (const s of newShipments.slice(0, 10)) {
    console.log('\n' + s.booking_number + ':');
    console.log('  POL:', s.port_of_loading || 'MISSING');
    console.log('  POD:', s.port_of_discharge || 'MISSING');
    console.log('  ETD:', s.etd || 'MISSING');
    console.log('  ETA:', s.eta || 'MISSING');
    console.log('  Vessel:', s.vessel_name || 'MISSING');
  }
}
main().catch(console.error);
