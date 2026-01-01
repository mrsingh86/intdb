import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const bookings = ['CAD0850107', '263805268'];

  console.log('═'.repeat(70));
  console.log('NULLING HALLUCINATED DATES');
  console.log('═'.repeat(70));
  console.log('These shipments have 2023 dates but emails were received in 2025/2026.');
  console.log('No PDF content available to re-extract, so nulling out bad data.\n');

  for (const bookingNumber of bookings) {
    console.log(`Processing ${bookingNumber}...`);

    // Get current data
    const { data: before } = await supabase
      .from('shipments')
      .select('etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, doc_cutoff')
      .eq('booking_number', bookingNumber)
      .single();

    console.log('  Before:');
    console.log(`    ETD: ${before?.etd}`);
    console.log(`    ETA: ${before?.eta}`);
    console.log(`    SI: ${before?.si_cutoff}`);
    console.log(`    VGM: ${before?.vgm_cutoff}`);
    console.log(`    Cargo: ${before?.cargo_cutoff}`);
    console.log(`    Gate: ${before?.gate_cutoff}`);
    console.log(`    Doc: ${before?.doc_cutoff}`);

    // Null out all date fields that are hallucinated (before 2024)
    const updates: Record<string, null> = {};

    if (before?.etd && String(before.etd).startsWith('2023')) updates.etd = null;
    if (before?.eta && String(before.eta).startsWith('2023')) updates.eta = null;
    if (before?.si_cutoff && String(before.si_cutoff).startsWith('2023')) updates.si_cutoff = null;
    if (before?.vgm_cutoff && String(before.vgm_cutoff).startsWith('2023')) updates.vgm_cutoff = null;
    if (before?.cargo_cutoff && String(before.cargo_cutoff).startsWith('2023')) updates.cargo_cutoff = null;
    if (before?.gate_cutoff && String(before.gate_cutoff).startsWith('2023')) updates.gate_cutoff = null;
    if (before?.doc_cutoff && String(before.doc_cutoff).startsWith('2023')) updates.doc_cutoff = null;

    if (Object.keys(updates).length === 0) {
      console.log('  No hallucinated dates to fix\n');
      continue;
    }

    const { error } = await supabase
      .from('shipments')
      .update(updates)
      .eq('booking_number', bookingNumber);

    if (error) {
      console.log(`  ❌ Error: ${error.message}\n`);
      continue;
    }

    console.log(`  ✅ Nulled ${Object.keys(updates).length} fields: ${Object.keys(updates).join(', ')}\n`);
  }

  console.log('═'.repeat(70));
  console.log('DONE - Hallucinated dates have been nulled');
  console.log('═'.repeat(70));
}

main().catch(console.error);
