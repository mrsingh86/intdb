import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { parseEntityDate } from '../lib/utils/date-parser';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkDateEntities() {
  console.log('=== DATE ENTITIES ANALYSIS ===\n');

  // Get all date-type entities
  const { data: dateEntities } = await supabase
    .from('entity_extractions')
    .select('*')
    .in('entity_type', ['etd', 'eta', 'atd', 'ata', 'estimated_departure_date', 'estimated_arrival_date'])
    .limit(50);

  if (dateEntities) {
    console.log(`Found ${dateEntities.length} date entities\n`);

    // Group by type and test parsing
    const types = ['etd', 'eta', 'atd', 'ata', 'estimated_departure_date', 'estimated_arrival_date'];

    for (const type of types) {
      const entities = dateEntities.filter(e => e.entity_type === type);
      if (entities.length > 0) {
        console.log(`\n${type.toUpperCase()} (${entities.length} entities):`);

        // Show unique values and parsing results
        const uniqueValues = [...new Set(entities.map(e => e.entity_value))];
        uniqueValues.slice(0, 5).forEach(value => {
          const parsed = parseEntityDate(value);
          console.log(`  "${value}" -> ${parsed || 'PARSE FAILED'}`);
        });
      }
    }
  }

  // Check shipments with dates vs without dates
  console.log('\n=== SHIPMENT DATE COVERAGE ===\n');

  const { data: shipmentsWithDates } = await supabase
    .from('shipments')
    .select('id')
    .or('etd.not.is.null,eta.not.is.null,atd.not.is.null,ata.not.is.null');

  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`Shipments with at least one date: ${shipmentsWithDates?.length || 0} / ${totalShipments}`);

  // Sample shipments without dates but that should have them
  const { data: shipmentsWithoutDates } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id')
    .is('etd', null)
    .is('eta', null)
    .limit(5);

  if (shipmentsWithoutDates && shipmentsWithoutDates.length > 0) {
    console.log('\nShipments missing dates (but created from emails):');

    for (const shipment of shipmentsWithoutDates) {
      if (shipment.created_from_email_id) {
        // Check if that email has date entities
        const { data: entities } = await supabase
          .from('entity_extractions')
          .select('entity_type, entity_value')
          .eq('email_id', shipment.created_from_email_id)
          .in('entity_type', ['etd', 'eta', 'estimated_departure_date', 'estimated_arrival_date']);

        if (entities && entities.length > 0) {
          console.log(`\nShipment ${shipment.booking_number} (missing dates in DB):`);
          console.log(`  But email has these date entities:`);
          entities.forEach(e => {
            console.log(`    - ${e.entity_type}: "${e.entity_value}"`);
          });
        }
      }
    }
  }
}

checkDateEntities().then(() => process.exit(0)).catch(console.error);