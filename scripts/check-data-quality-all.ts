import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get all shipments
  const { data: shipments, error, count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact' });

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('═'.repeat(80));
  console.log('=== DATA QUALITY REPORT FOR ALL SHIPMENTS ===');
  console.log('═'.repeat(80));
  console.log(`Total shipments: ${shipments?.length || 0}\n`);

  // Define field categories
  const coreFields = ['booking_number', 'carrier_id', 'vessel_name', 'voyage_number'];
  const routeFields = ['port_of_loading', 'port_of_loading_code', 'port_of_discharge', 'port_of_discharge_code'];
  const inlandFields = ['place_of_receipt', 'place_of_delivery', 'final_destination'];
  const dateFields = ['etd', 'eta'];
  const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff'];
  const customsFields = ['it_number', 'entry_number', 'hs_code_customs'];
  const partyFields = ['shipper_name', 'consignee_name'];

  // Count populated fields
  const stats: Record<string, { populated: number; total: number }> = {};

  const allFields = [...coreFields, ...routeFields, ...inlandFields, ...dateFields, ...cutoffFields, ...customsFields, ...partyFields];

  for (const field of allFields) {
    stats[field] = { populated: 0, total: shipments?.length || 0 };
  }

  // Count hallucinated dates
  let hallucinatedShipments: string[] = [];

  for (const s of shipments || []) {
    for (const field of allFields) {
      if (s[field] !== null && s[field] !== undefined && s[field] !== '') {
        stats[field].populated++;
      }
    }

    // Check for hallucinated dates (before 2024)
    const dateFieldsToCheck = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff'];
    for (const df of dateFieldsToCheck) {
      if (s[df]) {
        const year = parseInt(String(s[df]).substring(0, 4));
        if (year < 2024) {
          hallucinatedShipments.push(`${s.booking_number} (${df}: ${s[df]})`);
          break;
        }
      }
    }
  }

  // Print report by category
  const printCategory = (name: string, fields: string[]) => {
    console.log(`\n─── ${name} ───`);
    for (const field of fields) {
      const s = stats[field];
      const pct = Math.round((s.populated / s.total) * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      console.log(`  ${field.padEnd(25)} ${bar} ${s.populated}/${s.total} (${pct}%)`);
    }
  };

  printCategory('CORE FIELDS', coreFields);
  printCategory('ROUTE FIELDS', routeFields);
  printCategory('INLAND LOCATIONS', inlandFields);
  printCategory('DATES', dateFields);
  printCategory('CUTOFFS', cutoffFields);
  printCategory('CUSTOMS/AN FIELDS', customsFields);
  printCategory('PARTIES', partyFields);

  // Overall score
  const totalPopulated = Object.values(stats).reduce((sum, s) => sum + s.populated, 0);
  const totalPossible = Object.values(stats).reduce((sum, s) => sum + s.total, 0);
  const overallPct = Math.round((totalPopulated / totalPossible) * 100);

  console.log('\n' + '═'.repeat(80));
  console.log(`OVERALL DATA COMPLETENESS: ${overallPct}%`);
  console.log('═'.repeat(80));

  // Hallucinated dates
  if (hallucinatedShipments.length > 0) {
    console.log(`\n⚠️  SHIPMENTS WITH HALLUCINATED DATES (${hallucinatedShipments.length}):`);
    for (const h of hallucinatedShipments) {
      console.log(`   - ${h}`);
    }
  } else {
    console.log('\n✅ No hallucinated dates detected');
  }

  // Find shipments with minimal data
  console.log('\n─── SHIPMENTS WITH MINIMAL DATA ───');
  let minimalCount = 0;
  for (const s of shipments || []) {
    let fieldsPopulated = 0;
    for (const field of allFields) {
      if (s[field] !== null && s[field] !== undefined && s[field] !== '') {
        fieldsPopulated++;
      }
    }
    if (fieldsPopulated < 5) {
      console.log(`  ${s.booking_number}: ${fieldsPopulated}/${allFields.length} fields`);
      minimalCount++;
    }
  }
  if (minimalCount === 0) {
    console.log('  None found');
  }

  // Find duplicate bookings
  console.log('\n─── POTENTIAL DUPLICATES ───');
  const bookingNumbers = (shipments || []).map(s => s.booking_number);
  const duplicates = bookingNumbers.filter((bn, i) => {
    // Check for exact duplicates or prefix variations
    return bookingNumbers.some((other, j) => {
      if (i === j) return false;
      return bn === other || bn?.includes(other) || other?.includes(bn);
    });
  });
  const uniqueDuplicates = [...new Set(duplicates)];
  if (uniqueDuplicates.length > 0) {
    for (const d of uniqueDuplicates) {
      console.log(`  - ${d}`);
    }
  } else {
    console.log('  None found');
  }

  // Carriers breakdown
  console.log('\n─── SHIPMENTS BY CARRIER ───');
  const { data: carriers } = await supabase
    .from('carrier_configs')
    .select('id, carrier_name');

  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]) || []);
  const carrierCounts: Record<string, number> = {};

  for (const s of shipments || []) {
    const carrierName = carrierMap.get(s.carrier_id) || s.carrier_id || 'Unknown';
    carrierCounts[carrierName] = (carrierCounts[carrierName] || 0) + 1;
  }

  for (const [carrier, count] of Object.entries(carrierCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${carrier}: ${count}`);
  }
}

main().catch(console.error);
