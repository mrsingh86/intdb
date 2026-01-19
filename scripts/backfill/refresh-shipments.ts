/**
 * Refresh Shipments Script
 *
 * Re-processes all shipments to apply the fixed date parsing and entity mapping.
 * This will update existing shipments with missing data from their source emails.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { ShipmentRepository } from '../lib/repositories/shipment-repository';
import { EntityRepository } from '../lib/repositories/entity-repository';
import { parseEntityDate } from '../lib/utils/date-parser';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const shipmentRepo = new ShipmentRepository(supabase);
const entityRepo = new EntityRepository(supabase);

async function refreshShipment(shipmentId: string, emailId: string | null) {
  if (!emailId) {
    console.log(`  Skipping shipment ${shipmentId} - no source email`);
    return { updated: false, fields: [] };
  }

  // Get current shipment data
  const shipment = await shipmentRepo.findById(shipmentId);

  // Get entities from source email
  const entities = await entityRepo.findByEmailId(emailId);

  const findEntity = (type: string) =>
    entities.find(e => e.entity_type === type)?.entity_value;

  const findEntityWithFallback = (primaryType: string, fallbackType: string) =>
    findEntity(primaryType) || findEntity(fallbackType);

  // Build updates for missing fields only
  const updates: any = {};
  const updatedFields: string[] = [];

  // Check and update dates with improved parsing
  const etdValue = findEntityWithFallback('etd', 'estimated_departure_date');
  if (!shipment.etd && etdValue) {
    const parsed = parseEntityDate(etdValue);
    if (parsed) {
      updates.etd = parsed;
      updatedFields.push(`ETD: ${etdValue} -> ${parsed}`);
    }
  }

  const etaValue = findEntityWithFallback('eta', 'estimated_arrival_date');
  if (!shipment.eta && etaValue) {
    const parsed = parseEntityDate(etaValue);
    if (parsed) {
      updates.eta = parsed;
      updatedFields.push(`ETA: ${etaValue} -> ${parsed}`);
    }
  }

  const atdValue = findEntity('atd');
  if (!shipment.atd && atdValue) {
    const parsed = parseEntityDate(atdValue);
    if (parsed) {
      updates.atd = parsed;
      updatedFields.push(`ATD: ${atdValue} -> ${parsed}`);
    }
  }

  const ataValue = findEntity('ata');
  if (!shipment.ata && ataValue) {
    const parsed = parseEntityDate(ataValue);
    if (parsed) {
      updates.ata = parsed;
      updatedFields.push(`ATA: ${ataValue} -> ${parsed}`);
    }
  }

  // Update ports
  if (!shipment.port_of_loading && findEntity('port_of_loading')) {
    updates.port_of_loading = findEntity('port_of_loading');
    updatedFields.push(`POL: ${updates.port_of_loading}`);
  }

  if (!shipment.port_of_loading_code && findEntity('port_of_loading_code')) {
    updates.port_of_loading_code = findEntity('port_of_loading_code');
    updatedFields.push(`POL Code: ${updates.port_of_loading_code}`);
  }

  if (!shipment.port_of_discharge && findEntity('port_of_discharge')) {
    updates.port_of_discharge = findEntity('port_of_discharge');
    updatedFields.push(`POD: ${updates.port_of_discharge}`);
  }

  if (!shipment.port_of_discharge_code && findEntity('port_of_discharge_code')) {
    updates.port_of_discharge_code = findEntity('port_of_discharge_code');
    updatedFields.push(`POD Code: ${updates.port_of_discharge_code}`);
  }

  // Update vessel info
  if (!shipment.vessel_name && findEntity('vessel_name')) {
    updates.vessel_name = findEntity('vessel_name');
    updatedFields.push(`Vessel: ${updates.vessel_name}`);
  }

  if (!shipment.voyage_number && findEntity('voyage_number')) {
    updates.voyage_number = findEntity('voyage_number');
    updatedFields.push(`Voyage: ${updates.voyage_number}`);
  }

  // Update BL if missing
  if (!shipment.bl_number && findEntity('bl_number')) {
    updates.bl_number = findEntity('bl_number');
    updatedFields.push(`BL: ${updates.bl_number}`);
  }

  // Update commodity
  const commodityValue = findEntity('commodity') || findEntity('commodity_description');
  if (!shipment.commodity_description && commodityValue) {
    updates.commodity_description = commodityValue;
    updatedFields.push(`Commodity: ${commodityValue.substring(0, 50)}...`);
  }

  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    await shipmentRepo.update(shipmentId, updates);
    return { updated: true, fields: updatedFields };
  }

  return { updated: false, fields: [] };
}

async function main() {
  console.log('=== REFRESHING SHIPMENTS WITH ENTITY DATA ===\n');

  // Get all shipments that were created from emails
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id')
    .not('created_from_email_id', 'is', null)
    .order('created_at', { ascending: false });

  if (!shipments || shipments.length === 0) {
    console.log('No shipments found with source emails');
    return;
  }

  console.log(`Found ${shipments.length} shipments to refresh\n`);

  let totalUpdated = 0;
  let totalFieldsUpdated = 0;

  for (const shipment of shipments) {
    console.log(`\nProcessing shipment: ${shipment.booking_number || shipment.id}`);

    const result = await refreshShipment(shipment.id, shipment.created_from_email_id);

    if (result.updated) {
      totalUpdated++;
      totalFieldsUpdated += result.fields.length;
      console.log(`  ✓ Updated ${result.fields.length} fields:`);
      result.fields.forEach(field => console.log(`    - ${field}`));
    } else {
      console.log('  - No updates needed');
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total shipments processed: ${shipments.length}`);
  console.log(`Shipments updated: ${totalUpdated}`);
  console.log(`Total fields updated: ${totalFieldsUpdated}`);

  // Show sample of updated shipments
  if (totalUpdated > 0) {
    console.log('\n=== SAMPLE UPDATED SHIPMENTS ===');

    const { data: updatedShipments } = await supabase
      .from('shipments')
      .select('booking_number, etd, eta, port_of_loading, port_of_discharge, vessel_name')
      .not('etd', 'is', null)
      .limit(5);

    updatedShipments?.forEach(s => {
      console.log(`\nBooking #${s.booking_number}:`);
      console.log(`  ETD: ${s.etd}, ETA: ${s.eta || '-'}`);
      console.log(`  POL: ${s.port_of_loading || '-'}, POD: ${s.port_of_discharge || '-'}`);
      console.log(`  Vessel: ${s.vessel_name || '-'}`);
    });
  }

  process.exit(0);
}

main().catch(console.error);