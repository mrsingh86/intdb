/**
 * Check how well populated the linking fields are
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('LINKING IDENTIFIER COVERAGE CHECK');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Shipments table coverage
  console.log('\n1. SHIPMENTS TABLE COVERAGE:');
  console.log('─'.repeat(60));

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, mbl_number, container_number_primary');

  let withBooking = 0, withBl = 0, withMbl = 0, withContainer = 0;
  for (const s of shipments || []) {
    if (s.booking_number) withBooking++;
    if (s.bl_number) withBl++;
    if (s.mbl_number) withMbl++;
    if (s.container_number_primary) withContainer++;
  }

  console.log(`   Total shipments: ${shipments?.length}`);
  console.log(`   With booking_number: ${withBooking} (${Math.round(withBooking / (shipments?.length || 1) * 100)}%)`);
  console.log(`   With bl_number: ${withBl} (${Math.round(withBl / (shipments?.length || 1) * 100)}%)`);
  console.log(`   With mbl_number: ${withMbl} (${Math.round(withMbl / (shipments?.length || 1) * 100)}%)`);
  console.log(`   With container_number_primary: ${withContainer} (${Math.round(withContainer / (shipments?.length || 1) * 100)}%)`);

  // 2. Shipment containers table
  console.log('\n2. SHIPMENT_CONTAINERS TABLE:');
  console.log('─'.repeat(60));

  const { count: containerCount } = await supabase
    .from('shipment_containers')
    .select('*', { count: 'exact', head: true });

  console.log(`   Total container records: ${containerCount}`);

  // 3. Entity extractions by type
  console.log('\n3. ENTITY EXTRACTIONS BY TYPE:');
  console.log('─'.repeat(60));

  const identifierTypes = ['booking_number', 'bl_number', 'mbl_number', 'hbl_number', 'container_number'];
  for (const type of identifierTypes) {
    const { count } = await supabase
      .from('entity_extractions')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', type);
    console.log(`   ${type.padEnd(20)}: ${count}`);
  }

  // 4. Check what's blocking linking
  console.log('\n4. LINKING GAP ANALYSIS:');
  console.log('─'.repeat(60));

  // Get all entity extractions for linking identifiers
  const { data: blExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'bl_number');

  const { data: mblExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'mbl_number');

  const { data: containerExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'container_number');

  // Build shipment lookup maps
  const shipmentByBl = new Map(shipments?.filter(s => s.bl_number).map(s => [s.bl_number, s.id]));
  const shipmentByMbl = new Map(shipments?.filter(s => s.mbl_number).map(s => [s.mbl_number, s.id]));
  const shipmentByContainer = new Map(shipments?.filter(s => s.container_number_primary).map(s => [s.container_number_primary, s.id]));

  // Check matches
  let blMatches = 0, mblMatches = 0, containerMatches = 0;
  const unmatchedBls: string[] = [];
  const unmatchedMbls: string[] = [];

  for (const e of blExtractions || []) {
    if (shipmentByBl.has(e.entity_value)) {
      blMatches++;
    } else if (unmatchedBls.length < 5) {
      unmatchedBls.push(e.entity_value);
    }
  }

  for (const e of mblExtractions || []) {
    if (shipmentByMbl.has(e.entity_value)) {
      mblMatches++;
    } else if (unmatchedMbls.length < 5) {
      unmatchedMbls.push(e.entity_value);
    }
  }

  for (const e of containerExtractions || []) {
    if (shipmentByContainer.has(e.entity_value)) {
      containerMatches++;
    }
  }

  console.log(`   BL number matches: ${blMatches} / ${blExtractions?.length} (${Math.round(blMatches / (blExtractions?.length || 1) * 100)}%)`);
  console.log(`   MBL number matches: ${mblMatches} / ${mblExtractions?.length} (${Math.round(mblMatches / (mblExtractions?.length || 1) * 100)}%)`);
  console.log(`   Container matches: ${containerMatches} / ${containerExtractions?.length} (${Math.round(containerMatches / (containerExtractions?.length || 1) * 100)}%)`);

  if (unmatchedBls.length > 0) {
    console.log('\n   Sample unmatched BL numbers:');
    unmatchedBls.forEach(bl => console.log(`     - ${bl}`));
  }

  // 5. Recommendations
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  if (withBl < shipments?.length! * 0.5) {
    console.log('\n   ⚠️  bl_number is only populated in ' + withBl + ' shipments');
    console.log('      Consider: Extract BL from linked documents and populate shipments.bl_number');
  }

  if (withMbl < shipments?.length! * 0.5) {
    console.log('\n   ⚠️  mbl_number is only populated in ' + withMbl + ' shipments');
    console.log('      Consider: Same as BL - extract from documents');
  }

  if (withContainer < shipments?.length! * 0.5) {
    console.log('\n   ⚠️  container_number_primary is only populated in ' + withContainer + ' shipments');
    console.log('      Consider: Extract from arrival notices, container releases');
  }
}

main().catch(console.error);
