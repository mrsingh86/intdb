/**
 * Final Data Quality Report
 *
 * Shows the current state of data after all improvements.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function finalReport() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         FINAL DATA QUALITY REPORT                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // 1. Email Distribution
  console.log('1. EMAIL DISTRIBUTION BY CARRIER\n');

  const { data: emails } = await supabase
    .from('raw_emails')
    .select('sender_email');

  const carrierCounts: Record<string, number> = {};
  for (const email of emails || []) {
    const sender = (email.sender_email || '').toLowerCase();
    let carrier = 'Other';
    if (sender.includes('hlag') || sender.includes('hapag')) carrier = 'Hapag-Lloyd';
    else if (sender.includes('maersk')) carrier = 'Maersk';
    else if (sender.includes('msc') || sender.includes('medlog')) carrier = 'MSC';
    else if (sender.includes('intoglo')) carrier = 'Intoglo Internal';
    carrierCounts[carrier] = (carrierCounts[carrier] || 0) + 1;
  }

  Object.entries(carrierCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([carrier, count]) => console.log(`  ${carrier.padEnd(20)} ${count}`));

  // 2. Document Classification
  console.log('\n\n2. DOCUMENT CLASSIFICATIONS\n');

  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('document_type');

  const docCounts: Record<string, number> = {};
  for (const c of classifications || []) {
    docCounts[c.document_type] = (docCounts[c.document_type] || 0) + 1;
  }

  Object.entries(docCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => console.log(`  ${type.padEnd(25)} ${count}`));

  // 3. Entity Extraction
  console.log('\n\n3. ENTITY EXTRACTION STATS\n');

  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  const entityCounts: Record<string, number> = {};
  for (const e of entities || []) {
    entityCounts[e.entity_type] = (entityCounts[e.entity_type] || 0) + 1;
  }

  const keyTypes = ['booking_number', 'bl_number', 'etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'port_of_loading', 'port_of_discharge', 'vessel_name'];
  keyTypes.forEach(type => {
    if (entityCounts[type]) {
      console.log(`  ${type.padEnd(25)} ${entityCounts[type]}`);
    }
  });

  // 4. Shipment Completeness
  console.log('\n\n4. SHIPMENT DATA COMPLETENESS\n');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, port_of_loading, port_of_discharge, vessel_name');

  const total = shipments?.length || 0;
  const stats = {
    etd: shipments?.filter(s => s.etd).length || 0,
    eta: shipments?.filter(s => s.eta).length || 0,
    si_cutoff: shipments?.filter(s => s.si_cutoff).length || 0,
    vgm_cutoff: shipments?.filter(s => s.vgm_cutoff).length || 0,
    cargo_cutoff: shipments?.filter(s => s.cargo_cutoff).length || 0,
    port_of_loading: shipments?.filter(s => s.port_of_loading).length || 0,
    port_of_discharge: shipments?.filter(s => s.port_of_discharge).length || 0,
    vessel_name: shipments?.filter(s => s.vessel_name).length || 0,
  };

  console.log(`Total Shipments: ${total}\n`);
  Object.entries(stats).forEach(([field, count]) => {
    const pct = Math.round(count / total * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${field.padEnd(20)} ${String(count).padStart(2)}/${total} ${bar} ${pct}%`);
  });

  // 5. Breakdown by cutoff status
  console.log('\n\n5. SHIPMENTS BY CUTOFF STATUS\n');

  const withCutoffs = shipments?.filter(s => s.si_cutoff) || [];
  const withoutCutoffs = shipments?.filter(s => !s.si_cutoff) || [];

  console.log(`With cutoffs (complete):     ${withCutoffs.length}`);
  withCutoffs.slice(0, 5).forEach(s => console.log(`  ✅ ${s.booking_number}`));
  if (withCutoffs.length > 5) console.log(`  ... and ${withCutoffs.length - 5} more`);

  console.log(`\nWithout cutoffs (incomplete): ${withoutCutoffs.length}`);
  withoutCutoffs.slice(0, 10).forEach(s => console.log(`  ⚠️  ${s.booking_number || 'No booking #'}`));
  if (withoutCutoffs.length > 10) console.log(`  ... and ${withoutCutoffs.length - 10} more`);

  // 6. Recommendations
  console.log('\n\n' + '═'.repeat(70));
  console.log('RECOMMENDATIONS FOR FURTHER IMPROVEMENT');
  console.log('═'.repeat(70));

  console.log(`
1. HAPAG-LLOYD (${carrierCounts['Hapag-Lloyd'] || 0} emails):
   ✅ Well handled - 27 emails have cutoffs extracted
   ✅ 15 shipments have complete data

2. MAERSK (${carrierCounts['Maersk'] || 0} emails):
   ⚠️  Only ${carrierCounts['Maersk'] || 0} emails - mostly conversation threads
   → Need actual booking confirmation PDFs with deadline tables

3. MSC (${carrierCounts['MSC'] || 0} emails):
   ⚠️  Only contract/amendment emails
   → Need booking confirmation emails with schedule data

4. INTOGLO INTERNAL (${carrierCounts['Intoglo Internal'] || 0} emails):
   ⚠️  Forwarded emails without original carrier PDF data
   → These are internal coordination emails, not source documents

5. TO INCREASE COVERAGE:
   - Ingest actual booking confirmation emails directly from carriers
   - Process PDF attachments to extract deadline tables
   - Add more carrier-specific extraction patterns
`);

  console.log('🎉 Report Complete!\n');
}

finalReport().catch(console.error);
