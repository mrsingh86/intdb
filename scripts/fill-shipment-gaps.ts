#!/usr/bin/env npx tsx
/**
 * Fill Shipment Data Gaps from Entity Extractions
 *
 * For each shipment, finds all linked entity extractions and fills
 * in any missing fields. This helps recover data that was extracted
 * but not propagated to shipments.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Map entity_type to shipment field
const ENTITY_TO_SHIPMENT_FIELD: Record<string, string> = {
  'booking_number': 'booking_number',
  'bl_number': 'bl_number',
  'vessel_name': 'vessel_name',
  'voyage_number': 'voyage_number',
  'port_of_loading': 'port_of_loading',
  'port_of_discharge': 'port_of_discharge',
  'etd': 'etd',
  'eta': 'eta',
  'si_cutoff': 'si_cutoff',
  'vgm_cutoff': 'vgm_cutoff',
  'cargo_cutoff': 'cargo_cutoff',
  'gate_cutoff': 'gate_cutoff',
  'shipper_name': 'shipper_name',
  'consignee_name': 'consignee_name',
  'commodity': 'commodity_description',
  'commodity_description': 'commodity_description',
  'container_numbers': 'container_number_primary',
  'container_number': 'container_number_primary',
  'weight_kg': 'total_weight',
  'notify_party': 'notify_party',
};

interface ShipmentRow {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  etd: string | null;
  eta: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  shipper_name: string | null;
  consignee_name: string | null;
  commodity_description: string | null;
  container_number_primary: string | null;
  total_weight: number | null;
  notify_party: string | null;
}

async function fillShipmentGaps() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('FILL SHIPMENT DATA GAPS FROM ENTITY EXTRACTIONS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all shipments with their current data
  const { data: shipments, error: shipmentError } = await supabase
    .from('shipments')
    .select('*');

  if (shipmentError) {
    console.error('Failed to fetch shipments:', shipmentError.message);
    process.exit(1);
  }

  console.log(`Found ${shipments?.length || 0} shipments to check`);

  const stats = {
    shipmentsChecked: 0,
    shipmentsUpdated: 0,
    fieldsUpdated: 0,
    fieldUpdates: {} as Record<string, number>,
  };

  for (const shipment of (shipments || []) as ShipmentRow[]) {
    stats.shipmentsChecked++;

    // Find all entity extractions linked to this shipment
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('shipment_id', shipment.id);

    if (!entities || entities.length === 0) continue;

    // Build updates from entities
    const updates: Record<string, string | number> = {};

    for (const entity of entities) {
      const shipmentField = ENTITY_TO_SHIPMENT_FIELD[entity.entity_type];
      if (!shipmentField) continue;

      // Only update if current value is null/empty
      const currentValue = (shipment as Record<string, unknown>)[shipmentField];
      if (currentValue !== null && currentValue !== undefined && currentValue !== '') continue;

      // Skip if entity value is empty
      if (!entity.entity_value || entity.entity_value.trim() === '') continue;

      // Handle special cases
      if (shipmentField === 'total_weight') {
        const weight = parseFloat(entity.entity_value);
        if (!isNaN(weight)) {
          updates[shipmentField] = weight;
        }
      } else if (shipmentField === 'container_number_primary' && entity.entity_type === 'container_numbers') {
        // Take first container from array if stored as JSON
        try {
          const containers = JSON.parse(entity.entity_value);
          if (Array.isArray(containers) && containers.length > 0) {
            updates[shipmentField] = containers[0];
          }
        } catch {
          // Not JSON, use as-is
          updates[shipmentField] = entity.entity_value;
        }
      } else {
        updates[shipmentField] = entity.entity_value;
      }
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('shipments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', shipment.id);

      if (!updateError) {
        stats.shipmentsUpdated++;
        stats.fieldsUpdated += Object.keys(updates).length;

        for (const field of Object.keys(updates)) {
          stats.fieldUpdates[field] = (stats.fieldUpdates[field] || 0) + 1;
        }
      }
    }

    // Progress
    if (stats.shipmentsChecked % 50 === 0) {
      console.log(`  Processed ${stats.shipmentsChecked}/${shipments?.length} shipments...`);
    }
  }

  // Print results
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Shipments checked:  ${stats.shipmentsChecked}`);
  console.log(`Shipments updated:  ${stats.shipmentsUpdated}`);
  console.log(`Total fields filled: ${stats.fieldsUpdated}`);
  console.log('');
  console.log('Fields updated by type:');
  console.log('─'.repeat(50));

  for (const [field, count] of Object.entries(stats.fieldUpdates).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${field.padEnd(30)} ${count}`);
  }

  // Show updated coverage
  console.log('');
  await showUpdatedCoverage();
}

async function showUpdatedCoverage() {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*');

  const total = shipments?.length || 1;

  const fields = [
    'booking_number', 'bl_number', 'vessel_name', 'voyage_number',
    'port_of_loading', 'port_of_discharge', 'etd', 'eta',
    'si_cutoff', 'vgm_cutoff', 'cargo_cutoff',
    'shipper_name', 'consignee_name', 'commodity_description'
  ];

  console.log('UPDATED FIELD COVERAGE:');
  console.log('─'.repeat(60));

  for (const field of fields) {
    const filled = shipments?.filter(s => (s as Record<string, unknown>)[field] != null && (s as Record<string, unknown>)[field] !== '').length || 0;
    const pct = Math.round(filled / total * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${field.padEnd(25)} │ ${bar} ${String(pct).padStart(3)}% (${filled})`);
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

fillShipmentGaps().catch(console.error);
