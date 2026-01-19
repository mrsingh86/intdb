import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

(async () => {
  // Get a shipment with booking 262775119 (one without dates) to check its entity data
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, etd, eta, vessel_name, port_of_loading, port_of_discharge')
    .eq('booking_number', '262775119')
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log(`Shipment ${shipment.booking_number}:`);
  console.log('  Email ID:', shipment.created_from_email_id);
  console.log('  ETD:', shipment.etd);
  console.log('  ETA:', shipment.eta);
  console.log('  Vessel:', shipment.vessel_name);
  console.log('  POL:', shipment.port_of_loading);
  console.log('  POD:', shipment.port_of_discharge);

  // Check what entities Layer 2 extracted for this email
  console.log('\nLayer 2 Entities for this email:');
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, confidence_score')
    .eq('email_id', shipment.created_from_email_id)
    .order('entity_type');

  if (!entities || entities.length === 0) {
    console.log('  NO ENTITIES FOUND IN LAYER 2!');
  } else {
    entities.forEach(e => {
      console.log(`  ${e.entity_type}: ${e.entity_value} (${e.confidence_score}%)`);
    });
  }

  // Check a shipment with NO dates to see why
  console.log('\n' + '='.repeat(80));
  const { data: noDateShipment } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, created_from_email_id, etd, vessel_name')
    .is('etd', null)
    .limit(1)
    .single();

  if (noDateShipment) {
    console.log(`\nShipment with NO dates (Booking: ${noDateShipment.booking_number || noDateShipment.bl_number}):`);
    console.log('  Email ID:', noDateShipment.created_from_email_id);

    const { data: noDateEntities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', noDateShipment.created_from_email_id)
      .order('entity_type');

    console.log(`  Total entities in Layer 2: ${noDateEntities?.length || 0}`);

    if (noDateEntities && noDateEntities.length > 0) {
      console.log('  Entity types available:');
      const types = [...new Set(noDateEntities.map(e => e.entity_type))];
      types.forEach(t => {
        const values = noDateEntities.filter(e => e.entity_type === t).map(e => e.entity_value);
        console.log(`    - ${t}: ${values.join(', ')}`);
      });
    } else {
      console.log('  NO ENTITIES in Layer 2 for this email!');
    }
  }
})();
