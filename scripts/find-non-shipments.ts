import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function findNonShipments() {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, port_of_loading, port_of_discharge, created_from_email_id');

  console.log('=== IDENTIFYING NON-SHIPMENT RECORDS ===\n');

  const nonShipments: any[] = [];

  for (const s of shipments || []) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', s.created_from_email_id);

    const hasVoyage = entities?.some(e => ['etd', 'eta', 'vessel_name', 'voyage_number'].includes(e.entity_type));
    const hasPorts = entities?.some(e => ['port_of_loading', 'port_of_discharge'].includes(e.entity_type));

    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', s.created_from_email_id)
      .single();

    const isFmcFiling = email?.subject?.includes('FMC Filing') || email?.sender_email?.includes('fmcspot');
    const isSobConfirmation = email?.subject?.includes('SOB CONFIRMATION');

    // If no voyage data and no ports - likely not a real shipment
    const isNonShipment = (!hasVoyage && !hasPorts) || isFmcFiling || isSobConfirmation;

    if (isNonShipment) {
      nonShipments.push({
        id: s.id,
        booking: s.booking_number,
        subject: email?.subject?.substring(0, 60),
        sender: email?.sender_email,
        hasVoyage,
        hasPorts,
        entityCount: entities?.length || 0,
      });
    }
  }

  console.log(`Found ${nonShipments.length} non-shipment records:\n`);
  nonShipments.forEach(n => {
    console.log(`${n.booking}:`);
    console.log(`  Subject: ${n.subject}`);
    console.log(`  Sender: ${n.sender}`);
    console.log(`  Entities: ${n.entityCount} | hasVoyage: ${n.hasVoyage} | hasPorts: ${n.hasPorts}`);
    console.log('');
  });

  console.log('\nIDs to remove:');
  console.log(nonShipments.map(n => `'${n.id}'`).join(', '));

  // Ask before deleting
  console.log(`\nTo delete these ${nonShipments.length} records, run:`);
  console.log(`DELETE FROM shipments WHERE id IN (${nonShipments.map(n => `'${n.id}'`).join(', ')});`);
}

findNonShipments().catch(console.error);
