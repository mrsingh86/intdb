import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function traceEntityMapping() {
  // Get a shipment that was created from an email
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('booking_number', '20262609')
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('=== TRACING ENTITY MAPPING ===\n');
  console.log('Shipment ID:', shipment.id);
  console.log('Created from email:', shipment.created_from_email_id);

  // Get ALL entities for this email
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('*')
    .eq('email_id', shipment.created_from_email_id);

  console.log('\n--- ALL ENTITIES FROM EMAIL ---');
  entities?.forEach(e => {
    console.log(`${e.entity_type}: "${e.entity_value}" (confidence: ${e.confidence_score})`);
  });

  // Check what's actually in the shipment
  console.log('\n--- WHAT GOT SAVED IN SHIPMENT ---');
  console.log('booking_number:', shipment.booking_number);
  console.log('bl_number:', shipment.bl_number);
  console.log('container_number_primary:', shipment.container_number_primary);
  console.log('ETD:', shipment.etd);
  console.log('ETA:', shipment.eta);
  console.log('ATD:', shipment.atd);
  console.log('ATA:', shipment.ata);
  console.log('port_of_loading:', shipment.port_of_loading);
  console.log('port_of_discharge:', shipment.port_of_discharge);
  console.log('vessel_name:', shipment.vessel_name);
  console.log('voyage_number:', shipment.voyage_number);
  console.log('commodity_description:', shipment.commodity_description);

  // The issue is clear: estimated_departure_date exists but ETD is not mapped!
  console.log('\n--- ISSUE IDENTIFIED ---');
  const etdEntity = entities?.find(e => e.entity_type === 'etd');
  const estimatedDepartureEntity = entities?.find(e => e.entity_type === 'estimated_departure_date');
  
  if (!etdEntity && estimatedDepartureEntity) {
    console.log('❌ No "etd" entity but has "estimated_departure_date"');
    console.log('   The code only looks for "etd" not "estimated_departure_date"!');
  }

  if (etdEntity && !shipment.etd) {
    console.log('❌ Has "etd" entity but ETD not saved to shipment');
    console.log('   Date parsing might be failing!');
  }
}

traceEntityMapping().then(() => process.exit(0)).catch(console.error);
