#!/usr/bin/env npx tsx
/**
 * Fill Shipment Data from Entity Extractions
 * Aggregates all extracted data for each shipment
 *
 * Matches shipments to entities by:
 * - booking_number (exact and normalized without HL- prefix)
 * - bl_number
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface EntityMap {
  [key: string]: string | string[];
}

async function fetchAllWithPagination<T>(
  table: string,
  select: string
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + pageSize - 1);

    if (error || !data || data.length === 0) break;
    results.push(...(data as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

async function main() {
  console.log('============================================================');
  console.log('FILL SHIPMENT DATA FROM ENTITY EXTRACTIONS');
  console.log('============================================================\n');

  // Step 1: Get all shipments with all relevant fields
  const shipments = await fetchAllWithPagination<any>(
    'shipments',
    'id, booking_number, bl_number, vessel_name, voyage_number, port_of_loading, port_of_discharge, etd, eta, shipper_name, consignee_name, container_numbers, commodity_description, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff'
  );
  console.log(`Total shipments: ${shipments.length}`);

  // Step 2: Get all entity extractions
  const extractions = await fetchAllWithPagination<any>('entity_extractions', 'email_id, entity_type, entity_value');
  console.log(`Total extractions: ${extractions.length}`);

  // Step 3: Group extractions by email_id
  const emailEntities = new Map<string, EntityMap>();
  for (const ext of extractions) {
    if (!emailEntities.has(ext.email_id)) {
      emailEntities.set(ext.email_id, {});
    }
    const entities = emailEntities.get(ext.email_id)!;

    // Handle multiple values
    if (entities[ext.entity_type]) {
      if (Array.isArray(entities[ext.entity_type])) {
        (entities[ext.entity_type] as string[]).push(ext.entity_value);
      } else {
        entities[ext.entity_type] = [entities[ext.entity_type] as string, ext.entity_value];
      }
    } else {
      entities[ext.entity_type] = ext.entity_value;
    }
  }
  console.log(`Emails with extractions: ${emailEntities.size}`);

  // Helper to normalize booking numbers (remove HL- prefix)
  const normalizeBooking = (booking: string): string =>
    booking.replace(/^HL-/i, '').trim();

  // Step 4: Build booking_number -> entities mapping
  const bookingToEntities = new Map<string, EntityMap[]>();
  const blToEntities = new Map<string, EntityMap[]>();

  for (const [emailId, entities] of emailEntities) {
    // Index by booking number (both original and normalized)
    if (entities.booking_number) {
      const bookings = Array.isArray(entities.booking_number)
        ? entities.booking_number
        : [entities.booking_number];
      for (const booking of bookings) {
        // Add original
        if (!bookingToEntities.has(booking)) {
          bookingToEntities.set(booking, []);
        }
        bookingToEntities.get(booking)!.push(entities);

        // Add normalized version if different
        const normalized = normalizeBooking(booking);
        if (normalized !== booking) {
          if (!bookingToEntities.has(normalized)) {
            bookingToEntities.set(normalized, []);
          }
          bookingToEntities.get(normalized)!.push(entities);
        }
      }
    }

    // Index by BL number
    if (entities.bl_number) {
      const bls = Array.isArray(entities.bl_number) ? entities.bl_number : [entities.bl_number];
      for (const bl of bls) {
        if (!blToEntities.has(bl)) {
          blToEntities.set(bl, []);
        }
        blToEntities.get(bl)!.push(entities);
      }
    }
  }

  console.log(`Unique booking numbers with data: ${bookingToEntities.size}`);
  console.log(`Unique BL numbers with data: ${blToEntities.size}`);

  // Step 5: Update each shipment
  let updated = 0;
  let fieldsUpdated = 0;

  for (const shipment of shipments) {
    // Get all entity sets for this shipment
    const entitySets: EntityMap[] = [];

    // Try exact booking number match
    if (shipment.booking_number && bookingToEntities.has(shipment.booking_number)) {
      entitySets.push(...bookingToEntities.get(shipment.booking_number)!);
    }

    // Try normalized booking number match
    if (shipment.booking_number) {
      const normalizedShipmentBooking = normalizeBooking(shipment.booking_number);
      if (normalizedShipmentBooking !== shipment.booking_number &&
          bookingToEntities.has(normalizedShipmentBooking)) {
        entitySets.push(...bookingToEntities.get(normalizedShipmentBooking)!);
      }
    }

    // Try BL number match
    if (shipment.bl_number && blToEntities.has(shipment.bl_number)) {
      entitySets.push(...blToEntities.get(shipment.bl_number)!);
    }

    if (entitySets.length === 0) continue;

    // Merge all entities (later values override earlier)
    const merged: EntityMap = {};
    for (const entities of entitySets) {
      for (const [key, value] of Object.entries(entities)) {
        if (value) merged[key] = value;
      }
    }

    // Map entity types to shipment columns
    const getValue = (key: string): string | null => {
      const val = merged[key];
      if (!val) return null;
      return Array.isArray(val) ? val[0] : val;
    };

    const getArray = (key: string): string[] | null => {
      const val = merged[key];
      if (!val) return null;
      return Array.isArray(val) ? val : [val];
    };

    const parseDate = (val: string | null): string | null => {
      if (!val) return null;
      try {
        const date = new Date(val);
        return isNaN(date.getTime()) ? null : date.toISOString();
      } catch {
        return null;
      }
    };

    // Build update object (only update NULL fields)
    const updateData: Record<string, any> = {};

    if (!shipment.bl_number && getValue('bl_number')) {
      updateData.bl_number = getValue('bl_number');
    }
    if (!shipment.vessel_name && getValue('vessel_name')) {
      updateData.vessel_name = getValue('vessel_name');
    }
    if (!shipment.voyage_number && getValue('voyage_number')) {
      updateData.voyage_number = getValue('voyage_number');
    }
    if (!shipment.port_of_loading && getValue('port_of_loading')) {
      updateData.port_of_loading = getValue('port_of_loading');
    }
    if (!shipment.port_of_discharge && getValue('port_of_discharge')) {
      updateData.port_of_discharge = getValue('port_of_discharge');
    }
    if (!shipment.etd && parseDate(getValue('etd'))) {
      updateData.etd = parseDate(getValue('etd'));
    }
    if (!shipment.eta && parseDate(getValue('eta'))) {
      updateData.eta = parseDate(getValue('eta'));
    }
    if (!shipment.shipper_name && getValue('shipper_name')) {
      updateData.shipper_name = getValue('shipper_name');
    }
    if (!shipment.consignee_name && getValue('consignee_name')) {
      updateData.consignee_name = getValue('consignee_name');
    }
    if (!shipment.container_numbers && getArray('container_numbers')) {
      updateData.container_numbers = getArray('container_numbers');
    }
    if (!shipment.commodity_description && getValue('commodity')) {
      updateData.commodity_description = getValue('commodity');
    }
    if (!shipment.si_cutoff && parseDate(getValue('si_cutoff'))) {
      updateData.si_cutoff = parseDate(getValue('si_cutoff'));
    }
    if (!shipment.vgm_cutoff && parseDate(getValue('vgm_cutoff'))) {
      updateData.vgm_cutoff = parseDate(getValue('vgm_cutoff'));
    }
    if (!shipment.cargo_cutoff && parseDate(getValue('cargo_cutoff'))) {
      updateData.cargo_cutoff = parseDate(getValue('cargo_cutoff'));
    }
    if (!shipment.gate_cutoff && parseDate(getValue('gate_cutoff'))) {
      updateData.gate_cutoff = parseDate(getValue('gate_cutoff'));
    }

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update(updateData)
        .eq('id', shipment.id);

      if (!error) {
        updated++;
        fieldsUpdated += Object.keys(updateData).length;
      }
    }
  }

  console.log(`\nShipments updated: ${updated}`);
  console.log(`Total fields updated: ${fieldsUpdated}`);

  // Final stats
  console.log('\n============================================================');
  console.log('FINAL DATA COMPLETENESS');
  console.log('============================================================');

  const { data: final } = await supabase.from('shipments').select('*');
  const fields = ['bl_number', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge', 'etd', 'eta', 'shipper_name', 'consignee_name', 'container_numbers'];

  for (const field of fields) {
    const filled = final?.filter(s => s[field] !== null && s[field] !== undefined && s[field] !== '').length || 0;
    const percent = ((filled / (final?.length || 1)) * 100).toFixed(1);
    console.log(`${field}: ${filled}/${final?.length} (${percent}%)`);
  }
}

main().catch(console.error);
