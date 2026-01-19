/**
 * Verify Shipment Data Quality
 *
 * This script checks the quality of shipment data after the fixes
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function verifyDataQuality() {
  console.log('=== SHIPMENT DATA QUALITY VERIFICATION ===\n');

  // Get overall statistics
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: shipmentsWithETD } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('etd', 'is', null);

  const { count: shipmentsWithETA } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('eta', 'is', null);

  const { count: shipmentsWithPOL } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('port_of_loading', 'is', null);

  const { count: shipmentsWithPOD } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('port_of_discharge', 'is', null);

  const { count: shipmentsWithVessel } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('vessel_name', 'is', null);

  const { count: shipmentsWithBooking } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('booking_number', 'is', null);

  const { count: shipmentsWithBL } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('bl_number', 'is', null);

  console.log('📊 OVERALL DATA COVERAGE');
  console.log('========================');
  console.log(`Total Shipments: ${totalShipments}`);
  console.log(`\n📅 Date Fields:`);
  console.log(`  ETD: ${shipmentsWithETD}/${totalShipments} (${Math.round((shipmentsWithETD! / totalShipments!) * 100)}%)`);
  console.log(`  ETA: ${shipmentsWithETA}/${totalShipments} (${Math.round((shipmentsWithETA! / totalShipments!) * 100)}%)`);
  console.log(`\n📍 Location Fields:`);
  console.log(`  Port of Loading: ${shipmentsWithPOL}/${totalShipments} (${Math.round((shipmentsWithPOL! / totalShipments!) * 100)}%)`);
  console.log(`  Port of Discharge: ${shipmentsWithPOD}/${totalShipments} (${Math.round((shipmentsWithPOD! / totalShipments!) * 100)}%)`);
  console.log(`\n🚢 Vessel Info:`);
  console.log(`  Vessel Name: ${shipmentsWithVessel}/${totalShipments} (${Math.round((shipmentsWithVessel! / totalShipments!) * 100)}%)`);
  console.log(`\n📋 Identifiers:`);
  console.log(`  Booking Number: ${shipmentsWithBooking}/${totalShipments} (${Math.round((shipmentsWithBooking! / totalShipments!) * 100)}%)`);
  console.log(`  BL Number: ${shipmentsWithBL}/${totalShipments} (${Math.round((shipmentsWithBL! / totalShipments!) * 100)}%)`);

  // Sample some shipments to show data quality
  console.log('\n\n📝 SAMPLE SHIPMENTS WITH COMPLETE DATA');
  console.log('=======================================');

  const { data: completeShipments } = await supabase
    .from('shipments')
    .select('*')
    .not('etd', 'is', null)
    .not('port_of_loading', 'is', null)
    .not('port_of_discharge', 'is', null)
    .limit(5);

  completeShipments?.forEach((s, i) => {
    console.log(`\n${i + 1}. Booking #${s.booking_number || 'N/A'}`);
    console.log(`   BL #: ${s.bl_number || '-'}`);
    console.log(`   ETD: ${s.etd || '-'} | ETA: ${s.eta || '-'}`);
    console.log(`   Route: ${s.port_of_loading || '-'} → ${s.port_of_discharge || '-'}`);
    console.log(`   Vessel: ${s.vessel_name || '-'} | Voyage: ${s.voyage_number || '-'}`);
    console.log(`   Container: ${s.container_number_primary || '-'}`);
    console.log(`   Status: ${s.status}`);
  });

  // Check for data issues
  console.log('\n\n⚠️  DATA ISSUES TO ADDRESS');
  console.log('===========================');

  // Check for shipments missing critical data but have email source
  const { data: incompleteShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id')
    .not('created_from_email_id', 'is', null)
    .is('etd', null)
    .limit(5);

  if (incompleteShipments && incompleteShipments.length > 0) {
    console.log(`\n❌ ${incompleteShipments.length} shipments missing ETD despite having source email:`);

    for (const shipment of incompleteShipments.slice(0, 3)) {
      // Check if entities exist for this email
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', shipment.created_from_email_id)
        .in('entity_type', ['etd', 'eta', 'estimated_departure_date']);

      console.log(`   - Booking #${shipment.booking_number || shipment.id}`);
      if (entities && entities.length > 0) {
        console.log(`     Has entities: ${entities.map(e => `${e.entity_type}="${e.entity_value}"`).join(', ')}`);
        console.log(`     ⚠️  Entity exists but not mapped to shipment!`);
      } else {
        console.log(`     No date entities found in Layer 2`);
      }
    }
  }

  // Check for future dates that might be wrong
  const { data: futureDates } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta')
    .or('etd.gt.2026-06-01,eta.gt.2026-06-01');

  if (futureDates && futureDates.length > 0) {
    console.log(`\n⚠️  ${futureDates.length} shipments with dates far in the future (might be wrong):`);
    futureDates.slice(0, 3).forEach(s => {
      console.log(`   - Booking #${s.booking_number}: ETD=${s.etd}, ETA=${s.eta}`);
    });
  }

  // Summary recommendations
  console.log('\n\n💡 RECOMMENDATIONS');
  console.log('==================');

  const etdCoverage = Math.round((shipmentsWithETD! / totalShipments!) * 100);
  const polCoverage = Math.round((shipmentsWithPOL! / totalShipments!) * 100);
  const podCoverage = Math.round((shipmentsWithPOD! / totalShipments!) * 100);

  if (etdCoverage < 50) {
    console.log('1. ❗ Low ETD coverage - Check if Layer 2 extraction is missing date entities');
  } else if (etdCoverage < 80) {
    console.log('1. ⚠️  Moderate ETD coverage - Some emails may not contain departure dates');
  } else {
    console.log('1. ✅ Good ETD coverage');
  }

  if (polCoverage < 50) {
    console.log('2. ❗ Low Port of Loading coverage - Check entity extraction for port names');
  } else {
    console.log('2. ✅ Good Port of Loading coverage');
  }

  if (podCoverage < 50) {
    console.log('3. ❗ Low Port of Discharge coverage - Check entity extraction for port names');
  } else {
    console.log('3. ✅ Good Port of Discharge coverage');
  }

  const { count: shipmentsFromEmails } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('created_from_email_id', 'is', null);

  console.log(`\n📧 ${shipmentsFromEmails} of ${totalShipments} shipments were created from emails`);
  console.log(`   The rest may have been created manually or from other sources`);
}

verifyDataQuality().then(() => process.exit(0)).catch(console.error);