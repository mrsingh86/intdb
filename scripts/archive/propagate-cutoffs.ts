/**
 * Propagate cutoff dates from chronicle to shipments table
 *
 * Problem: Cutoffs extracted to chronicle (1,188 entries) but only 5 in shipments
 * Solution: For each shipment, find the most recent cutoff dates from its chronicle entries
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function propagateCutoffs() {
  console.log('=== PROPAGATING CUTOFFS FROM CHRONICLE TO SHIPMENTS ===\n');

  // Step 1: Get all shipments that need cutoff dates
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff')
    .not('status', 'eq', 'cancelled');

  console.log(`Found ${shipments?.length || 0} active shipments\n`);

  let updated = 0;
  let skipped = 0;

  for (const shipment of shipments || []) {
    // Get the most recent cutoff dates from chronicle for this shipment
    const { data: chronicleCutoffs } = await supabase
      .from('chronicle')
      .select('si_cutoff, vgm_cutoff, cargo_cutoff, occurred_at')
      .eq('shipment_id', shipment.id)
      .or('si_cutoff.not.is.null,vgm_cutoff.not.is.null,cargo_cutoff.not.is.null')
      .order('occurred_at', { ascending: false })
      .limit(10);

    if (!chronicleCutoffs || chronicleCutoffs.length === 0) {
      skipped++;
      continue;
    }

    // Find the most recent non-null value for each cutoff type
    let siCutoff: string | null = null;
    let vgmCutoff: string | null = null;
    let cargoCutoff: string | null = null;

    for (const entry of chronicleCutoffs) {
      if (!siCutoff && entry.si_cutoff) siCutoff = entry.si_cutoff;
      if (!vgmCutoff && entry.vgm_cutoff) vgmCutoff = entry.vgm_cutoff;
      if (!cargoCutoff && entry.cargo_cutoff) cargoCutoff = entry.cargo_cutoff;

      // Stop if we have all values
      if (siCutoff && vgmCutoff && cargoCutoff) break;
    }

    // Check if we have anything new to update
    const needsUpdate =
      (siCutoff && !shipment.si_cutoff) ||
      (vgmCutoff && !shipment.vgm_cutoff) ||
      (cargoCutoff && !shipment.cargo_cutoff);

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    // Build update object (only update fields that are currently null)
    const updateData: Record<string, string> = {};
    if (siCutoff && !shipment.si_cutoff) updateData.si_cutoff = siCutoff;
    if (vgmCutoff && !shipment.vgm_cutoff) updateData.vgm_cutoff = vgmCutoff;
    if (cargoCutoff && !shipment.cargo_cutoff) updateData.cargo_cutoff = cargoCutoff;

    const { error } = await supabase
      .from('shipments')
      .update(updateData)
      .eq('id', shipment.id);

    if (error) {
      console.log(`  Error updating ${shipment.booking_number}: ${error.message}`);
    } else {
      console.log(`  ✓ ${shipment.booking_number}: SI=${updateData.si_cutoff || 'kept'}, VGM=${updateData.vgm_cutoff || 'kept'}, Cargo=${updateData.cargo_cutoff || 'kept'}`);
      updated++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Updated: ${updated} shipments`);
  console.log(`Skipped: ${skipped} shipments (no new cutoffs found)`);
}

propagateCutoffs().catch(console.error);
