#!/usr/bin/env npx tsx
/**
 * Final coverage report by carrier with analysis notes
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // Get all shipments with carrier
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, si_cutoff, vgm_cutoff, cargo_cutoff');

  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL CUTOFF COVERAGE REPORT                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  const byCarrier: Record<string, { total: number; allThree: number; anyOne: number }> = {};

  for (const s of shipments || []) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!byCarrier[carrier]) {
      byCarrier[carrier] = { total: 0, allThree: 0, anyOne: 0 };
    }
    byCarrier[carrier].total++;
    if (s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) byCarrier[carrier].allThree++;
    if (s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff) byCarrier[carrier].anyOne++;
  }

  const notes: Record<string, string> = {
    'Maersk Line': '✅ PDF BCs with cutoffs',
    'Hapag-Lloyd': '✅ PDF BCs with cutoffs',
    'COSCO Shipping': '⚠️ Some "not confirmed"',
    'CMA CGM': '❌ Cutoffs in images, not text',
    'MSC': '✅ PDF BCs with cutoffs',
    'ONE': '⚠️ Limited data',
    'Unknown': 'Unclassified'
  };

  console.log('Carrier'.padEnd(20) + '| Total | All 3 | Any  | Rate  | Notes');
  console.log('─'.repeat(85));

  const sorted = Object.entries(byCarrier).sort((a, b) => b[1].total - a[1].total);
  for (const [carrier, stats] of sorted) {
    const rate = Math.round((stats.allThree / stats.total) * 100);
    console.log(
      carrier.substring(0, 19).padEnd(20) + '| ' +
      String(stats.total).padEnd(6) + '| ' +
      String(stats.allThree).padEnd(6) + '| ' +
      String(stats.anyOne).padEnd(5) + '| ' +
      (rate + '%').padEnd(6) + '| ' +
      (notes[carrier] || '')
    );
  }

  // Overall
  const total = shipments?.length || 0;
  const allThree = shipments?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length || 0;
  console.log('─'.repeat(85));
  console.log(
    'OVERALL'.padEnd(20) + '| ' +
    String(total).padEnd(6) + '| ' +
    String(allThree).padEnd(6) + '|      | ' +
    Math.round((allThree / total) * 100) + '%'
  );

  // Excluding CMA CGM (since they don't provide extractable cutoffs)
  const cmaId = [...carrierMap.entries()].find(([k, v]) => v.includes('CMA'))?.[0];
  const nonCma = shipments?.filter(s => s.carrier_id !== cmaId) || [];
  const nonCmaAll3 = nonCma.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;

  console.log('\n═══ ADJUSTED COVERAGE (Excluding carriers without extractable source) ═══');
  console.log('\nExcluding CMA CGM (cutoffs only in images, requires OCR):');
  console.log('  Shipments: ' + nonCma.length);
  console.log('  All 3 cutoffs: ' + nonCmaAll3 + ' (' + Math.round((nonCmaAll3 / nonCma.length) * 100) + '%)');

  // Only carriers with PDF-based cutoffs
  const goodCarriers = ['Maersk Line', 'Hapag-Lloyd', 'MSC'];
  const goodCarrierIds = [...carrierMap.entries()]
    .filter(([_, name]) => goodCarriers.includes(name))
    .map(([id, _]) => id);

  const pdfCarriers = shipments?.filter(s => goodCarrierIds.includes(s.carrier_id)) || [];
  const pdfAll3 = pdfCarriers.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;

  console.log('\nOnly PDF-based carriers (Maersk, Hapag-Lloyd, MSC):');
  console.log('  Shipments: ' + pdfCarriers.length);
  console.log('  All 3 cutoffs: ' + pdfAll3 + ' (' + Math.round((pdfAll3 / pdfCarriers.length) * 100) + '%)');

  console.log('\n═══ ROOT CAUSE ANALYSIS ═══');
  console.log('\n✅ WORKING WELL:');
  console.log('   - Maersk: PDF booking confirmations with all cutoffs');
  console.log('   - Hapag-Lloyd: PDF booking confirmations with all cutoffs');
  console.log('   - MSC: PDF booking confirmations with all cutoffs');

  console.log('\n⚠️ PARTIAL ISSUES:');
  console.log('   - COSCO: Some PDFs say "Cut-off yet not confirm"');
  console.log('   - Hapag: Some emails are invoices (INVP*.pdf) misclassified as BC');

  console.log('\n❌ REQUIRES ADDITIONAL INTEGRATION:');
  console.log('   - CMA CGM: Cutoffs sent as embedded images, requires OCR');
  console.log('   - CMA CGM: Or API integration to fetch from web portal');
}

main().catch(console.error);
