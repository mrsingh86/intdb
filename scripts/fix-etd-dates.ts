/**
 * Fix incorrect ETD dates in shipments table
 *
 * Problem: Dates like "23/11/25" (DD/MM/YY) were parsed as 2023-11-25 instead of 2025-11-23
 * Solution: NULL out clearly wrong dates, update stage for historical shipments
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixETDDates() {
  console.log('=== FIXING INCORRECT ETD DATES ===\n');

  // Step 1: Find shipments with ETD in 2023 (clearly wrong - system created in 2026)
  const { data: wrongYear } = await supabase
    .from('shipments')
    .select('id, booking_number, etd')
    .lt('etd', '2024-01-01')
    .not('status', 'eq', 'cancelled');

  console.log(`Found ${wrongYear?.length || 0} shipments with ETD in 2023 (wrong year)\n`);

  // NULL out these ETD dates
  if (wrongYear && wrongYear.length > 0) {
    for (const s of wrongYear) {
      console.log(`  Fixing ${s.booking_number || s.id}: ETD ${s.etd} → NULL`);
      await supabase
        .from('shipments')
        .update({ etd: null })
        .eq('id', s.id);
    }
    console.log(`\n✓ Fixed ${wrongYear.length} shipments with 2023 ETD dates\n`);
  }

  // Step 2: Find shipments with ETD significantly in the past (> 60 days before today)
  // that are still in early stages (PENDING, BOOKED, SI_*, DRAFT_BL)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 60);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const { data: staleShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, stage, eta')
    .lt('etd', cutoffStr)
    .in('stage', ['PENDING', 'BOOKED', 'SI_SUBMITTED', 'SI_CONFIRMED', 'SI_STAGE', 'DRAFT_BL', 'REQUESTED'])
    .not('status', 'eq', 'cancelled');

  console.log(`Found ${staleShipments?.length || 0} shipments with ETD > 60 days past but early stage\n`);

  // Update stage based on whether they have ETA and when
  if (staleShipments && staleShipments.length > 0) {
    for (const s of staleShipments) {
      let newStage = 'BL_ISSUED'; // Default: assume BL was issued if vessel departed

      // If ETA exists and is in the past, mark as ARRIVED
      if (s.eta) {
        const eta = new Date(s.eta);
        if (eta < new Date()) {
          newStage = 'ARRIVED';
        } else {
          newStage = 'DEPARTED';
        }
      }

      console.log(`  Updating ${s.booking_number || s.id}: ${s.stage} → ${newStage} (ETD: ${s.etd})`);
      await supabase
        .from('shipments')
        .update({ stage: newStage })
        .eq('id', s.id);
    }
    console.log(`\n✓ Updated ${staleShipments.length} shipments to appropriate stages\n`);
  }

  // Step 3: Also fix chronicle entries with wrong ETD dates
  console.log('Fixing chronicle entries with 2023 ETD dates...');

  const { error: chronicleError } = await supabase
    .from('chronicle')
    .update({ etd: null })
    .lt('etd', '2024-01-01');

  if (chronicleError) {
    console.log('Error fixing chronicle:', chronicleError.message);
  } else {
    console.log('✓ Fixed chronicle entries with 2023 ETD dates\n');
  }

  console.log('=== DONE ===');
}

fixETDDates().catch(console.error);
