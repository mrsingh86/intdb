#!/usr/bin/env npx tsx
/**
 * Sync Entities to Shipments
 *
 * For each shipment with linked emails, pulls entity_extractions data
 * and updates the shipment fields that are currently null.
 *
 * Fields synced:
 * - etd, eta
 * - vessel_name, voyage_number
 * - port_of_loading, port_of_discharge
 * - si_cutoff, vgm_cutoff, cargo_cutoff
 * - shipper_name, consignee_name
 */

import { createClient } from '@supabase/supabase-js';
import { parseEntityDate } from '../lib/utils/date-parser';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Map entity_type → shipment field
const ENTITY_TO_FIELD: Record<string, string> = {
  'etd': 'etd',
  'eta': 'eta',
  'vessel_name': 'vessel_name',
  'voyage_number': 'voyage_number',
  'port_of_loading': 'port_of_loading',
  'port_of_discharge': 'port_of_discharge',
  'si_cutoff': 'si_cutoff',
  'vgm_cutoff': 'vgm_cutoff',
  'cargo_cutoff': 'cargo_cutoff',
  'gate_cutoff': 'gate_cutoff',
  'shipper': 'shipper_name',
  'shipper_name': 'shipper_name',
  'consignee': 'consignee_name',
  'consignee_name': 'consignee_name',
  'commodity': 'commodity_description',
  'commodity_description': 'commodity_description',
};

// Fields that are dates
const DATE_FIELDS = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

async function syncEntitiesToShipments() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SYNCING ENTITIES TO SHIPMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all shipments with their current field values
  const { data: shipments, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, vessel_name, voyage_number, port_of_loading, port_of_discharge, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, shipper_name, consignee_name, commodity_description');

  if (shipmentError || !shipments) {
    console.error('Failed to fetch shipments:', shipmentError);
    return;
  }

  console.log(`Total shipments: ${shipments.length}`);

  // 2. Get all shipment_documents links (with pagination)
  const linksByShipment = new Map<string, string[]>();
  let offset = 0;
  while (true) {
    const { data: links } = await supabase
      .from('shipment_documents')
      .select('shipment_id, email_id')
      .range(offset, offset + 999);

    if (!links || links.length === 0) break;

    for (const link of links) {
      if (!linksByShipment.has(link.shipment_id)) {
        linksByShipment.set(link.shipment_id, []);
      }
      linksByShipment.get(link.shipment_id)!.push(link.email_id);
    }

    offset += 1000;
    if (links.length < 1000) break;
  }

  console.log(`Shipments with linked emails: ${linksByShipment.size}`);

  // 3. Get all entity extractions (with pagination)
  const entitiesByEmail = new Map<string, Map<string, string>>();
  offset = 0;
  while (true) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .range(offset, offset + 999);

    if (!entities || entities.length === 0) break;

    for (const e of entities) {
      if (!entitiesByEmail.has(e.email_id)) {
        entitiesByEmail.set(e.email_id, new Map());
      }
      // Store latest value for each entity type per email
      entitiesByEmail.get(e.email_id)!.set(e.entity_type, e.entity_value);
    }

    offset += 1000;
    if (offset % 10000 === 0) {
      process.stdout.write(`\rLoading entities: ${offset}...`);
    }
    if (entities.length < 1000) break;
  }
  console.log(`\nEmails with entities: ${entitiesByEmail.size}`);
  console.log('');

  // 4. Sync each shipment
  const stats = {
    shipmentsProcessed: 0,
    shipmentsUpdated: 0,
    fieldsUpdated: 0,
    byField: {} as Record<string, number>,
  };

  console.log('SYNCING:');
  console.log('─'.repeat(60));

  for (const shipment of shipments) {
    const linkedEmails = linksByShipment.get(shipment.id) || [];

    if (linkedEmails.length === 0) continue;

    stats.shipmentsProcessed++;

    // Collect all entities from linked emails
    const aggregatedEntities = new Map<string, string>();

    for (const emailId of linkedEmails) {
      const emailEntities = entitiesByEmail.get(emailId);
      if (!emailEntities) continue;

      for (const [entityType, entityValue] of emailEntities) {
        // Only use if we don't already have this entity, or this is a "latest wins" update
        if (!aggregatedEntities.has(entityType) || entityType.includes('cutoff') || entityType === 'etd' || entityType === 'eta') {
          aggregatedEntities.set(entityType, entityValue);
        }
      }
    }

    // Build updates for null fields
    const updates: Record<string, any> = {};

    for (const [entityType, entityValue] of aggregatedEntities) {
      const fieldName = ENTITY_TO_FIELD[entityType];
      if (!fieldName) continue;

      // Skip if shipment already has this field
      if ((shipment as any)[fieldName]) continue;

      // Parse date if needed
      let value: any = entityValue;
      if (DATE_FIELDS.includes(fieldName) && entityValue) {
        const parsed = parseEntityDate(entityValue);
        if (parsed) {
          value = parsed;
        } else {
          continue; // Skip invalid dates
        }
      }

      if (value) {
        updates[fieldName] = value;
        stats.byField[fieldName] = (stats.byField[fieldName] || 0) + 1;
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', shipment.id);

      if (!error) {
        stats.shipmentsUpdated++;
        stats.fieldsUpdated += Object.keys(updates).length;

        if (stats.shipmentsUpdated <= 10 || stats.shipmentsUpdated % 50 === 0) {
          console.log(`  ✅ ${shipment.booking_number || shipment.id.substring(0, 8)}: ${Object.keys(updates).join(', ')}`);
        }
      }
    }
  }

  // 5. Print results
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SYNC RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Shipments processed:  ${stats.shipmentsProcessed}`);
  console.log(`Shipments updated:    ${stats.shipmentsUpdated}`);
  console.log(`Total fields updated: ${stats.fieldsUpdated}`);
  console.log('');
  console.log('BY FIELD:');
  console.log('─'.repeat(50));
  for (const [field, count] of Object.entries(stats.byField).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${field.padEnd(25)} ${count}`);
  }

  // 6. Show updated completeness
  console.log('');
  console.log('');
  console.log('UPDATED COMPLETENESS:');
  console.log('─'.repeat(50));

  const { data: updatedShipments } = await supabase
    .from('shipments')
    .select('etd, eta, vessel_name, port_of_loading, port_of_discharge, si_cutoff, vgm_cutoff, cargo_cutoff');

  const total = updatedShipments?.length || 1;
  const fields = ['etd', 'eta', 'vessel_name', 'port_of_loading', 'port_of_discharge', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff'];

  for (const field of fields) {
    const count = (updatedShipments || []).filter((s: any) => s[field] !== null).length;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${field.padEnd(20)} ${bar} ${pct}% (${count}/${total})`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

syncEntitiesToShipments().catch(console.error);
