/**
 * Fix Shipment Dates - Smart Selection
 *
 * Picks the ETD/ETA pair with reasonable ocean transit time (15-60 days)
 * instead of blindly taking the first pair.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const MIN_TRANSIT_DAYS = 15;
const MAX_TRANSIT_DAYS = 60;

interface DatePair {
  etd: string;
  eta: string;
  transitDays: number;
}

function findBestDatePair(entities: Array<{ entity_type: string; entity_value: string }>): DatePair | null {
  const etds = entities.filter(e => e.entity_type === 'etd').map(e => e.entity_value);
  const etas = entities.filter(e => e.entity_type === 'eta').map(e => e.entity_value);

  // Try to find a valid pair with reasonable transit
  const validPairs: DatePair[] = [];

  for (const etdStr of etds) {
    for (const etaStr of etas) {
      const etd = new Date(etdStr);
      const eta = new Date(etaStr);

      if (isNaN(etd.getTime()) || isNaN(eta.getTime())) continue;

      const transitDays = Math.round((eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24));

      // Must be positive and reasonable for ocean freight
      if (transitDays >= MIN_TRANSIT_DAYS && transitDays <= MAX_TRANSIT_DAYS) {
        validPairs.push({ etd: etdStr, eta: etaStr, transitDays });
      }
    }
  }

  // Return the pair with the shortest reasonable transit (likely main voyage, not longest routing)
  if (validPairs.length > 0) {
    validPairs.sort((a, b) => a.transitDays - b.transitDays);
    return validPairs[0];
  }

  // If no reasonable pair found, try to find any positive transit
  for (const etdStr of etds) {
    for (const etaStr of etas) {
      const etd = new Date(etdStr);
      const eta = new Date(etaStr);

      if (isNaN(etd.getTime()) || isNaN(eta.getTime())) continue;

      const transitDays = Math.round((eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24));

      if (transitDays > 0) {
        return { etd: etdStr, eta: etaStr, transitDays };
      }
    }
  }

  return null;
}

async function fixShipmentDatesSmart() {
  console.log('='.repeat(70));
  console.log('SMART FIX: Selecting ETD/ETA with reasonable transit (15-60 days)');
  console.log('='.repeat(70));

  const stats = {
    checked: 0,
    fixed: 0,
    stillBad: 0,
    noValidPair: 0,
  };

  // Get shipments with suspicious transit times
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, etd, eta')
    .not('etd', 'is', null)
    .not('eta', 'is', null);

  for (const shipment of shipments || []) {
    const etd = new Date(shipment.etd);
    const eta = new Date(shipment.eta);
    const currentTransit = Math.round((eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24));

    // Only fix if current transit is suspicious
    if (currentTransit >= MIN_TRANSIT_DAYS && currentTransit <= MAX_TRANSIT_DAYS) {
      continue; // Already good
    }

    stats.checked++;

    // Get all entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', shipment.created_from_email_id);

    if (!entities) continue;

    const bestPair = findBestDatePair(entities);

    if (!bestPair) {
      stats.noValidPair++;
      console.log(`${shipment.booking_number}: No valid pair found (current: ${currentTransit} days)`);
      continue;
    }

    // Update shipment
    const { error } = await supabase
      .from('shipments')
      .update({
        etd: new Date(bestPair.etd).toISOString(),
        eta: new Date(bestPair.eta).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipment.id);

    if (error) {
      console.log(`${shipment.booking_number}: Error - ${error.message}`);
    } else {
      stats.fixed++;
      console.log(`${shipment.booking_number}: ${currentTransit}d -> ${bestPair.transitDays}d (${bestPair.etd} -> ${bestPair.eta})`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Shipments with bad transit checked: ${stats.checked}`);
  console.log(`Fixed with valid pair: ${stats.fixed}`);
  console.log(`No valid pair found: ${stats.noValidPair}`);

  // Final verification
  console.log('\n' + '='.repeat(70));
  console.log('FINAL VERIFICATION');
  console.log('='.repeat(70));

  const { data: final } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta')
    .not('etd', 'is', null)
    .not('eta', 'is', null);

  let good = 0, bad = 0;
  const badList: string[] = [];

  for (const s of final || []) {
    const days = Math.round((new Date(s.eta).getTime() - new Date(s.etd).getTime()) / (1000 * 60 * 60 * 24));
    if (days >= MIN_TRANSIT_DAYS && days <= MAX_TRANSIT_DAYS) {
      good++;
    } else {
      bad++;
      badList.push(`${s.booking_number}: ${days} days`);
    }
  }

  console.log(`Good transit (15-60 days): ${good}`);
  console.log(`Still problematic: ${bad}`);

  if (badList.length > 0) {
    console.log('\nStill problematic:');
    badList.forEach(b => console.log(`  ${b}`));
  }
}

fixShipmentDatesSmart().catch(console.error);
