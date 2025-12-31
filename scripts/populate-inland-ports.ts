/**
 * Populate Inland Ports (POR/POFD)
 *
 * Maps place_of_receipt and place_of_delivery from entity_extractions to shipments
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function populateInlandPorts() {
  console.log('='.repeat(70));
  console.log('POPULATING INLAND PORTS (POR / POFD)');
  console.log('='.repeat(70));

  const stats = { porAdded: 0, pofdAdded: 0, errors: 0 };

  // Get all shipments with their source email
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, place_of_receipt, place_of_delivery');

  console.log(`\nProcessing ${shipments?.length || 0} shipments...\n`);

  for (const shipment of shipments || []) {
    if (!shipment.created_from_email_id) continue;

    const updates: Record<string, any> = {};

    // Get entities for this email
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', shipment.created_from_email_id)
      .in('entity_type', ['place_of_receipt', 'place_of_delivery'])
      .order('created_at', { ascending: true });

    // Get FIRST place_of_receipt (origin inland location)
    if (!shipment.place_of_receipt) {
      const por = entities?.find(e => e.entity_type === 'place_of_receipt');
      if (por?.entity_value) {
        updates.place_of_receipt = por.entity_value;
        stats.porAdded++;
      }
    }

    // Get FIRST place_of_delivery (destination inland location)
    if (!shipment.place_of_delivery) {
      const pofd = entities?.find(e => e.entity_type === 'place_of_delivery');
      if (pofd?.entity_value) {
        updates.place_of_delivery = pofd.entity_value;
        stats.pofdAdded++;
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (error) {
        stats.errors++;
        console.log(`${shipment.booking_number}: Error - ${error.message}`);
      } else {
        console.log(`${shipment.booking_number}: ${Object.keys(updates).filter(k => k !== 'updated_at').join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`POR (Place of Receipt) added: ${stats.porAdded}`);
  console.log(`POFD (Place of Delivery) added: ${stats.pofdAdded}`);
  console.log(`Errors: ${stats.errors}`);

  // Final coverage
  const { data: final } = await supabase
    .from('shipments')
    .select('place_of_receipt, place_of_delivery');

  const withPor = final?.filter(s => s.place_of_receipt).length || 0;
  const withPofd = final?.filter(s => s.place_of_delivery).length || 0;

  console.log(`\nFinal coverage:`);
  console.log(`  With POR: ${withPor}/${final?.length} (${Math.round(withPor/(final?.length || 1)*100)}%)`);
  console.log(`  With POFD: ${withPofd}/${final?.length} (${Math.round(withPofd/(final?.length || 1)*100)}%)`);

  // Sample data
  console.log('\nSample shipments with inland ports:');
  const { data: samples } = await supabase
    .from('shipments')
    .select('booking_number, place_of_receipt, port_of_loading, port_of_discharge, place_of_delivery')
    .not('place_of_receipt', 'is', null)
    .limit(5);

  samples?.forEach(s => {
    console.log(`\n  ${s.booking_number}:`);
    console.log(`    Origin:  ${s.place_of_receipt} → ${s.port_of_loading}`);
    console.log(`    Dest:    ${s.port_of_discharge} → ${s.place_of_delivery || 'N/A'}`);
  });
}

populateInlandPorts().catch(console.error);
