#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function check() {
  // Get sample shipments
  const { data: shipments } = await supabase.from('shipments').select('*').limit(5);

  console.log('=== SAMPLE SHIPMENT DATA ===');
  shipments?.forEach((s, i) => {
    console.log(`\nShipment ${i+1} - Booking: ${s.booking_number}`);
    console.log(`  BL: ${s.bl_number || 'NULL'}`);
    console.log(`  Vessel: ${s.vessel_name || 'NULL'}`);
    console.log(`  Voyage: ${s.voyage_number || 'NULL'}`);
    console.log(`  POL: ${s.port_of_loading || 'NULL'}`);
    console.log(`  POD: ${s.port_of_discharge || 'NULL'}`);
    console.log(`  ETD: ${s.etd || 'NULL'}`);
    console.log(`  ETA: ${s.eta || 'NULL'}`);
    console.log(`  Shipper: ${s.shipper_name || 'NULL'}`);
    console.log(`  Consignee: ${s.consignee_name || 'NULL'}`);
    console.log(`  Containers: ${s.container_numbers || 'NULL'}`);
  });

  // Count nulls
  console.log('\n=== NULL COUNTS ===');
  const { data: all } = await supabase.from('shipments').select('*');

  const fields = ['bl_number', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge', 'etd', 'eta', 'shipper_name', 'consignee_name', 'container_numbers'];

  fields.forEach(field => {
    const nullCount = all?.filter(s => s[field] === null || s[field] === undefined || s[field] === '').length || 0;
    const percent = ((nullCount / (all?.length || 1)) * 100).toFixed(1);
    console.log(`${field}: ${nullCount} nulls (${percent}%)`);
  });

  // Check entity extraction data available
  console.log('\n=== ENTITY EXTRACTION COUNTS ===');
  const entityTypes = ['booking_number', 'bl_number', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge', 'etd', 'eta', 'shipper_name', 'consignee_name', 'container_numbers'];

  for (const type of entityTypes) {
    const { count } = await supabase
      .from('entity_extractions')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', type);
    console.log(`${type}: ${count} extractions`);
  }
}

check();
