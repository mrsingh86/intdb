/**
 * Fix Shipment Dates - Origin to Destination Logic
 *
 * ETD = FIRST ETD (departure from Asian origin)
 * ETA = LAST ETA (arrival at North American destination)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fixDatesOriginDestination() {
  console.log('='.repeat(70));
  console.log('FIX: ETD=First (Asia departure), ETA=Last (NA arrival)');
  console.log('='.repeat(70));

  const stats = { checked: 0, fixed: 0, errors: 0 };

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, etd, eta');

  for (const shipment of shipments || []) {
    if (!shipment.created_from_email_id) continue;
    stats.checked++;

    // Get all ETD/ETA entities ordered by position
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', shipment.created_from_email_id)
      .in('entity_type', ['etd', 'eta'])
      .order('created_at', { ascending: true });

    if (!entities || entities.length === 0) continue;

    // Get FIRST valid ETD and LAST valid ETA
    const etds = entities
      .filter(e => e.entity_type === 'etd')
      .map(e => e.entity_value)
      .filter(v => !isNaN(new Date(v).getTime()));

    const etas = entities
      .filter(e => e.entity_type === 'eta')
      .map(e => e.entity_value)
      .filter(v => !isNaN(new Date(v).getTime()));

    if (etds.length === 0 || etas.length === 0) continue;

    const firstEtd = etds[0];
    const lastEta = etas[etas.length - 1];

    // Calculate transit
    const transit = Math.round(
      (new Date(lastEta).getTime() - new Date(firstEtd).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Only update if different from current
    const currentEtd = shipment.etd?.split('T')[0];
    const currentEta = shipment.eta?.split('T')[0];
    const newEtd = firstEtd.split('T')[0];
    const newEta = lastEta.split('T')[0];

    if (currentEtd !== newEtd || currentEta !== newEta) {
      const { error } = await supabase
        .from('shipments')
        .update({
          etd: new Date(firstEtd).toISOString(),
          eta: new Date(lastEta).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', shipment.id);

      if (error) {
        stats.errors++;
      } else {
        stats.fixed++;
        const oldTransit = currentEtd && currentEta
          ? Math.round((new Date(currentEta).getTime() - new Date(currentEtd).getTime()) / (1000 * 60 * 60 * 24))
          : '?';
        console.log(`${shipment.booking_number}: ${currentEtd} → ${currentEta} (${oldTransit}d)  =>  ${newEtd} → ${newEta} (${transit}d)`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Checked: ${stats.checked}`);
  console.log(`Fixed: ${stats.fixed}`);
  console.log(`Errors: ${stats.errors}`);

  // Verify
  console.log('\n=== VERIFICATION ===\n');
  const { data: final } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta')
    .not('etd', 'is', null)
    .not('eta', 'is', null);

  let good = 0, bad = 0;
  for (const s of final || []) {
    const days = Math.round((new Date(s.eta).getTime() - new Date(s.etd).getTime()) / (1000 * 60 * 60 * 24));
    if (days >= 15 && days <= 60) good++;
    else {
      bad++;
      console.log(`Still bad: ${s.booking_number} - ${days} days (${s.etd} → ${s.eta})`);
    }
  }
  console.log(`\nGood (15-60 days): ${good}`);
  console.log(`Bad: ${bad}`);
}

fixDatesOriginDestination().catch(console.error);
