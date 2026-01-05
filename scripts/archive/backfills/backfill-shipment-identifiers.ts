/**
 * Backfill shipment identifiers from linked documents
 *
 * Problem: BL/MBL/container numbers are extracted but not propagated to shipments table
 * Solution: For each shipment, find linked emails and copy identifiers to shipment record
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('BACKFILLING SHIPMENT IDENTIFIERS FROM LINKED DOCUMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, mbl_number, container_number_primary');

  console.log('\n1. Found', shipments?.length, 'shipments');

  let updatedBl = 0, updatedMbl = 0, updatedContainer = 0;
  const updates: { shipmentId: string; field: string; value: string }[] = [];

  for (const shipment of shipments || []) {
    // 2. Get linked documents for this shipment
    const { data: links } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipment.id);

    if (!links || links.length === 0) continue;

    const emailIds = links.map(l => l.email_id).filter(Boolean);
    if (emailIds.length === 0) continue;

    // 3. Get entity extractions for linked emails
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .in('email_id', emailIds)
      .in('entity_type', ['bl_number', 'mbl_number', 'container_number']);

    if (!entities || entities.length === 0) continue;

    // 4. Build update object for missing fields
    const updateData: Record<string, string> = {};

    // BL number
    if (!shipment.bl_number) {
      const blEntity = entities.find(e => e.entity_type === 'bl_number');
      if (blEntity?.entity_value) {
        updateData.bl_number = blEntity.entity_value;
        updates.push({ shipmentId: shipment.id, field: 'bl_number', value: blEntity.entity_value });
      }
    }

    // MBL number
    if (!shipment.mbl_number) {
      const mblEntity = entities.find(e => e.entity_type === 'mbl_number');
      if (mblEntity?.entity_value) {
        updateData.mbl_number = mblEntity.entity_value;
        updates.push({ shipmentId: shipment.id, field: 'mbl_number', value: mblEntity.entity_value });
      }
    }

    // Container number
    if (!shipment.container_number_primary) {
      const containerEntity = entities.find(e => e.entity_type === 'container_number');
      if (containerEntity?.entity_value) {
        updateData.container_number_primary = containerEntity.entity_value;
        updates.push({ shipmentId: shipment.id, field: 'container_number_primary', value: containerEntity.entity_value });
      }
    }

    // 5. Apply updates
    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update(updateData)
        .eq('id', shipment.id);

      if (!error) {
        if (updateData.bl_number) updatedBl++;
        if (updateData.mbl_number) updatedMbl++;
        if (updateData.container_number_primary) updatedContainer++;
      }
    }
  }

  console.log('\n2. BACKFILL RESULTS:');
  console.log('─'.repeat(60));
  console.log('   bl_number updated:', updatedBl);
  console.log('   mbl_number updated:', updatedMbl);
  console.log('   container_number_primary updated:', updatedContainer);

  if (updates.length > 0) {
    console.log('\n3. SAMPLE UPDATES:');
    for (const u of updates.slice(0, 10)) {
      console.log(`   ${u.field}: ${u.value}`);
    }
  }

  // 4. Verify final counts
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const { data: finalShipments } = await supabase
    .from('shipments')
    .select('id, bl_number, mbl_number, container_number_primary');

  let withBl = 0, withMbl = 0, withContainer = 0;
  for (const s of finalShipments || []) {
    if (s.bl_number) withBl++;
    if (s.mbl_number) withMbl++;
    if (s.container_number_primary) withContainer++;
  }

  console.log('\n   Final shipment identifier coverage:');
  console.log(`   With bl_number: ${withBl} (${Math.round(withBl / (finalShipments?.length || 1) * 100)}%)`);
  console.log(`   With mbl_number: ${withMbl} (${Math.round(withMbl / (finalShipments?.length || 1) * 100)}%)`);
  console.log(`   With container_number_primary: ${withContainer} (${Math.round(withContainer / (finalShipments?.length || 1) * 100)}%)`);
}

main().catch(console.error);
