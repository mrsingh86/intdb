/**
 * Verify Shipment Model
 *
 * Confirms the correct model is in place:
 * - 1 booking = 1 shipment
 * - Multiple documents linked per shipment
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function verifyModel() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         VERIFY SHIPMENT MODEL                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get shipments with document counts
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, status, carrier_id')
    .order('booking_number');

  console.log(`Total shipments: ${shipments?.length}\n`);

  // Check for duplicates
  const bookingNumbers = shipments?.map(s => s.booking_number) || [];
  const uniqueBookingNumbers = new Set(bookingNumbers);
  console.log(`Unique booking numbers: ${uniqueBookingNumbers.size}`);
  console.log(`Duplicates: ${bookingNumbers.length - uniqueBookingNumbers.size}\n`);

  // Show shipments with multiple documents
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('SHIPMENTS WITH MULTIPLE DOCUMENTS:');
  console.log('─────────────────────────────────────────────────────────────────────\n');

  let multiDocCount = 0;

  for (const shipment of (shipments || []).slice(0, 15)) {
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select(`
        id,
        document_type,
        is_primary,
        email_id
      `)
      .eq('shipment_id', shipment.id);

    const docCount = docs?.length || 0;

    if (docCount > 1) {
      multiDocCount++;
      console.log(`✅ ${shipment.booking_number} (${shipment.status})`);
      console.log(`   ETD: ${shipment.etd || 'NULL'}, ETA: ${shipment.eta || 'NULL'}, Cutoffs: ${shipment.si_cutoff ? 'YES' : 'NO'}`);
      console.log(`   Documents (${docCount}):`);

      for (const doc of (docs || [])) {
        // Get email subject
        const { data: email } = await supabase
          .from('raw_emails')
          .select('subject')
          .eq('id', doc.email_id)
          .single();

        const primary = doc.is_primary ? '★' : ' ';
        const subject = email?.subject?.substring(0, 50) || 'Unknown';
        console.log(`   ${primary} ${doc.document_type}: ${subject}...`);
      }
      console.log('');
    }
  }

  // Summary statistics
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('DATA QUALITY SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const total = shipments?.length || 0;
  const withETD = shipments?.filter(s => s.etd).length || 0;
  const withETA = shipments?.filter(s => s.eta).length || 0;
  const withCutoffs = shipments?.filter(s => s.si_cutoff).length || 0;

  // Get document stats
  const { data: allDocs } = await supabase.from('shipment_documents').select('shipment_id');
  const totalDocs = allDocs?.length || 0;

  // Count by document count
  const docCounts = new Map<string, number>();
  for (const doc of allDocs || []) {
    docCounts.set(doc.shipment_id, (docCounts.get(doc.shipment_id) || 0) + 1);
  }

  let one = 0, two = 0, three = 0, moreThanThree = 0;
  for (const count of docCounts.values()) {
    if (count === 1) one++;
    else if (count === 2) two++;
    else if (count === 3) three++;
    else moreThanThree++;
  }

  console.log('Shipment Statistics:');
  console.log(`  Total:        ${total}`);
  console.log(`  With ETD:     ${withETD} (${(withETD/total*100).toFixed(0)}%)`);
  console.log(`  With ETA:     ${withETA} (${(withETA/total*100).toFixed(0)}%)`);
  console.log(`  With Cutoffs: ${withCutoffs} (${(withCutoffs/total*100).toFixed(0)}%)`);
  console.log('');
  console.log('Document Linking:');
  console.log(`  Total docs:   ${totalDocs}`);
  console.log(`  Avg/shipment: ${(totalDocs/total).toFixed(1)}`);
  console.log(`  1 doc:        ${one} shipments`);
  console.log(`  2 docs:       ${two} shipments`);
  console.log(`  3 docs:       ${three} shipments`);
  console.log(`  4+ docs:      ${moreThanThree} shipments`);
  console.log('');

  // Show by carrier
  console.log('By Carrier:');
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_code');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_code]) || []);

  const byCarrier = new Map<string, { total: number; withCutoffs: number }>();
  for (const s of shipments || []) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!byCarrier.has(carrier)) byCarrier.set(carrier, { total: 0, withCutoffs: 0 });
    byCarrier.get(carrier)!.total++;
    if (s.si_cutoff) byCarrier.get(carrier)!.withCutoffs++;
  }

  for (const [carrier, stats] of byCarrier) {
    console.log(`  ${carrier}: ${stats.total} shipments (${stats.withCutoffs} with cutoffs)`);
  }

  console.log('\n✅ MODEL VERIFICATION COMPLETE\n');
}

verifyModel().catch(console.error);
