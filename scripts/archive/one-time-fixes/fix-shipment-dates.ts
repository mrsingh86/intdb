/**
 * Fix Shipment Dates
 *
 * Corrects ETD/ETA/cutoffs by picking the FIRST extracted values
 * (main voyage) instead of the last (feeder legs).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Fields to fix - take FIRST value, not last
const DATE_FIELDS = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];
const TEXT_FIELDS = ['port_of_loading', 'port_of_discharge', 'vessel_name', 'voyage_number'];

interface FixResult {
  bookingNumber: string;
  fieldsFixed: string[];
  oldValues: Record<string, any>;
  newValues: Record<string, any>;
}

async function fixShipmentDates() {
  console.log('='.repeat(70));
  console.log('FIXING SHIPMENT DATES (Using FIRST extracted values)');
  console.log('='.repeat(70));

  const stats = {
    shipmentsChecked: 0,
    shipmentsFixed: 0,
    fieldsFixed: 0,
    errors: [] as string[],
  };

  // Get all shipments with their source email
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, port_of_loading, port_of_discharge, vessel_name, voyage_number');

  console.log(`\nChecking ${shipments?.length || 0} shipments...\n`);

  const fixes: FixResult[] = [];

  for (const shipment of shipments || []) {
    if (!shipment.created_from_email_id) continue;
    stats.shipmentsChecked++;

    // Get ALL entities for this email, ordered by creation (first = main voyage)
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, created_at')
      .eq('email_id', shipment.created_from_email_id)
      .order('created_at', { ascending: true });

    if (!entities || entities.length === 0) continue;

    // Build map of FIRST value for each entity type
    const firstValues: Record<string, string> = {};
    for (const entity of entities) {
      if (!firstValues[entity.entity_type]) {
        firstValues[entity.entity_type] = entity.entity_value;
      }
    }

    // Check what needs fixing
    const updates: Record<string, any> = {};
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    // Fix date fields
    for (const field of DATE_FIELDS) {
      const correctValue = firstValues[field];
      const currentValue = shipment[field as keyof typeof shipment];

      if (correctValue && correctValue !== currentValue) {
        // Validate it's a proper date
        const date = new Date(correctValue);
        if (!isNaN(date.getTime())) {
          updates[field] = date.toISOString();
          oldValues[field] = currentValue;
          newValues[field] = correctValue;
        }
      }
    }

    // Fix text fields (POL, POD, vessel, voyage)
    for (const field of TEXT_FIELDS) {
      const correctValue = firstValues[field];
      const currentValue = shipment[field as keyof typeof shipment];

      // Only update if current is null/empty and we have a value
      if (correctValue && !currentValue) {
        updates[field] = correctValue;
        oldValues[field] = currentValue;
        newValues[field] = correctValue;
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
        stats.errors.push(`${shipment.booking_number}: ${error.message}`);
      } else {
        stats.shipmentsFixed++;
        stats.fieldsFixed += Object.keys(updates).length - 1; // -1 for updated_at

        fixes.push({
          bookingNumber: shipment.booking_number,
          fieldsFixed: Object.keys(newValues),
          oldValues,
          newValues,
        });
      }
    }
  }

  // Print results
  console.log('='.repeat(70));
  console.log('FIX SUMMARY');
  console.log('='.repeat(70));
  console.log(`Shipments checked: ${stats.shipmentsChecked}`);
  console.log(`Shipments fixed: ${stats.shipmentsFixed}`);
  console.log(`Fields fixed: ${stats.fieldsFixed}`);

  if (fixes.length > 0) {
    console.log('\nSample fixes:');
    fixes.slice(0, 10).forEach(fix => {
      console.log(`\n  ${fix.bookingNumber}:`);
      fix.fieldsFixed.forEach(field => {
        console.log(`    ${field}: ${fix.oldValues[field]} → ${fix.newValues[field]}`);
      });
    });
  }

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
  }

  // Verify fix - check transit times
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION - Transit Time Check');
  console.log('='.repeat(70));

  const { data: updated } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta')
    .not('etd', 'is', null)
    .not('eta', 'is', null);

  let suspicious = 0;
  let reasonable = 0;

  for (const s of updated || []) {
    const etd = new Date(s.etd);
    const eta = new Date(s.eta);
    const days = Math.round((eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24));

    if (days < 10 || days > 90) {
      suspicious++;
    } else {
      reasonable++;
    }
  }

  console.log(`Reasonable transit (10-90 days): ${reasonable}`);
  console.log(`Still suspicious: ${suspicious}`);
}

fixShipmentDates().catch(console.error);
