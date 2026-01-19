#!/usr/bin/env npx tsx
/**
 * Verify successful extraction cases for each shipping line
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     SUCCESSFUL EXTRACTION VERIFICATION BY SHIPPING LINE           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name, carrier_code');

  // Get all shipments with carrier info
  const { data: shipments } = await supabase.from('shipments').select('*');

  console.log('CARRIER EXTRACTION SUCCESS RATES:\n');
  console.log('Carrier'.padEnd(20) + '| Total | With All 3 | With Any | Success Rate');
  console.log('─'.repeat(75));

  const carrierStats: any[] = [];

  for (const carrier of carriers || []) {
    const carrierShipments = shipments?.filter(s => s.carrier_id === carrier.id) || [];
    const total = carrierShipments.length;

    if (total === 0) continue;

    const withAllCutoffs = carrierShipments.filter(s =>
      s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff
    ).length;

    const withAnyCutoff = carrierShipments.filter(s =>
      s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff
    ).length;

    const successRate = Math.round((withAllCutoffs / total) * 100);

    carrierStats.push({
      name: carrier.carrier_name,
      total,
      withAll: withAllCutoffs,
      withAny: withAnyCutoff,
      rate: successRate
    });

    console.log(
      carrier.carrier_name.substring(0, 19).padEnd(20) + '| ' +
      total.toString().padEnd(6) + '| ' +
      withAllCutoffs.toString().padEnd(11) + '| ' +
      withAnyCutoff.toString().padEnd(9) + '| ' +
      successRate + '%'
    );
  }

  // Unknown carrier
  const unknownShipments = shipments?.filter(s => s.carrier_id === null) || [];
  if (unknownShipments.length > 0) {
    const withAll = unknownShipments.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;
    const withAny = unknownShipments.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff).length;
    console.log(
      'Unknown'.padEnd(20) + '| ' +
      unknownShipments.length.toString().padEnd(6) + '| ' +
      withAll.toString().padEnd(11) + '| ' +
      withAny.toString().padEnd(9) + '| ' +
      Math.round((withAll / unknownShipments.length) * 100) + '%'
    );
  }

  // Now show SAMPLE successful extractions for each carrier
  console.log('\n\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          SAMPLE SUCCESSFUL EXTRACTIONS BY CARRIER                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  for (const carrier of carriers || []) {
    // Get a shipment with all 3 cutoffs for this carrier
    const { data: successSample } = await supabase
      .from('shipments')
      .select('booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, etd, eta, vessel_name')
      .eq('carrier_id', carrier.id)
      .not('si_cutoff', 'is', null)
      .not('vgm_cutoff', 'is', null)
      .not('cargo_cutoff', 'is', null)
      .limit(1);

    if (successSample && successSample.length > 0) {
      const s = successSample[0];
      console.log(`✅ ${carrier.carrier_name}`);
      console.log(`   Booking: ${s.booking_number}`);
      console.log(`   SI Cutoff: ${s.si_cutoff}`);
      console.log(`   VGM Cutoff: ${s.vgm_cutoff}`);
      console.log(`   Cargo Cutoff: ${s.cargo_cutoff}`);
      console.log(`   ETD: ${s.etd || 'N/A'} | ETA: ${s.eta || 'N/A'}`);
      console.log(`   Vessel: ${s.vessel_name || 'N/A'}`);
      console.log('');
    } else {
      // Check if there's any with partial cutoffs
      const { data: partialSample } = await supabase
        .from('shipments')
        .select('booking_number, si_cutoff, vgm_cutoff, cargo_cutoff')
        .eq('carrier_id', carrier.id)
        .or('si_cutoff.not.is.null,vgm_cutoff.not.is.null,cargo_cutoff.not.is.null')
        .limit(1);

      if (partialSample && partialSample.length > 0) {
        const s = partialSample[0];
        console.log(`⚠️ ${carrier.carrier_name} (Partial extraction only)`);
        console.log(`   Booking: ${s.booking_number}`);
        console.log(`   SI: ${s.si_cutoff || '❌'} | VGM: ${s.vgm_cutoff || '❌'} | Cargo: ${s.cargo_cutoff || '❌'}`);
        console.log('');
      } else {
        console.log(`❌ ${carrier.carrier_name} - NO successful cutoff extractions`);
        console.log('');
      }
    }
  }

  // Summary
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                           SUMMARY                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const carriersWithSuccess = carrierStats.filter(c => c.withAll > 0);
  const carriersWithPartial = carrierStats.filter(c => c.withAll === 0 && c.withAny > 0);
  const carriersWithNone = carrierStats.filter(c => c.withAny === 0);

  console.log(`Carriers with FULL extraction success: ${carriersWithSuccess.length}`);
  carriersWithSuccess.forEach(c => console.log(`  ✅ ${c.name}: ${c.withAll}/${c.total} shipments`));

  if (carriersWithPartial.length > 0) {
    console.log(`\nCarriers with PARTIAL extraction only: ${carriersWithPartial.length}`);
    carriersWithPartial.forEach(c => console.log(`  ⚠️ ${c.name}: ${c.withAny}/${c.total} have some cutoffs`));
  }

  if (carriersWithNone.length > 0) {
    console.log(`\nCarriers with NO extractions: ${carriersWithNone.length}`);
    carriersWithNone.forEach(c => console.log(`  ❌ ${c.name}: 0/${c.total} shipments`));
  }
}

verify().catch(console.error);
