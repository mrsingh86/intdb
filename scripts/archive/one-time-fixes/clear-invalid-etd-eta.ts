/**
 * Clear Invalid ETD/ETA Values
 *
 * Problem: ETD/ETA values where:
 * - ETA is before ETD (impossible)
 * - Transit time < 7 days for international routes (impossible for ocean freight)
 *
 * These are likely cargo cutoff dates being misidentified as vessel dates.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function clearInvalidDates() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         CLEAR INVALID ETD/ETA VALUES                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipments with both ETD and ETA
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, port_of_loading, port_of_discharge')
    .not('etd', 'is', null)
    .not('eta', 'is', null);

  if (error || !shipments) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${shipments.length} shipments with ETD and ETA\n`);

  let invalid = 0;
  let cleared = 0;

  for (const s of shipments) {
    const etd = new Date(s.etd);
    const eta = new Date(s.eta);
    const transitDays = (eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24);

    // Invalid if transit < 7 days (international shipping takes longer)
    // Or if ETA is before ETD (impossible)
    if (transitDays < 7) {
      invalid++;
      console.log(`${s.booking_number}: ETD ${s.etd?.split('T')[0]} → ETA ${s.eta?.split('T')[0]} = ${transitDays.toFixed(0)} days [INVALID]`);
      console.log(`  Route: ${s.port_of_loading || '?'} → ${s.port_of_discharge || '?'}`);

      // Clear the ETA (keep ETD as it's likely correct)
      const { error: updateError } = await supabase
        .from('shipments')
        .update({ eta: null })
        .eq('id', s.id);

      if (updateError) {
        console.log(`  ❌ Error clearing: ${updateError.message}`);
      } else {
        console.log(`  ✓ Cleared ETA`);
        cleared++;
      }
    }
  }

  // Also clear entity_extractions with invalid ETA values
  console.log('\n\nClearing invalid ETA entities...\n');

  const { data: etaEntities } = await supabase
    .from('entity_extractions')
    .select('id, email_id, entity_value')
    .eq('entity_type', 'eta');

  const { data: etdEntities } = await supabase
    .from('entity_extractions')
    .select('id, email_id, entity_value')
    .eq('entity_type', 'etd');

  // Build ETD lookup by email_id
  const etdByEmail = new Map<string, string>();
  etdEntities?.forEach(e => etdByEmail.set(e.email_id, e.entity_value));

  let etaCleared = 0;
  for (const eta of etaEntities || []) {
    const etdValue = etdByEmail.get(eta.email_id);
    if (etdValue) {
      const etdDate = new Date(etdValue);
      const etaDate = new Date(eta.entity_value);
      const transitDays = (etaDate.getTime() - etdDate.getTime()) / (1000 * 60 * 60 * 24);

      if (transitDays < 7) {
        await supabase.from('entity_extractions').delete().eq('id', eta.id);
        etaCleared++;
      }
    }
  }

  console.log('\n════════════════════════════════════════════════════');
  console.log(`📊 Shipments with invalid transit: ${invalid}`);
  console.log(`✓ Shipment ETAs cleared: ${cleared}`);
  console.log(`✓ Entity ETAs cleared: ${etaCleared}`);
  console.log('\nNote: ETD values kept (likely cargo cutoff dates)');
  console.log('      ETA values cleared (were incorrect)');
}

clearInvalidDates().catch(console.error);
