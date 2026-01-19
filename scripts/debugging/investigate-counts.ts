/**
 * Investigate document counts per shipment
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get active shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status')
    .not('status', 'in', '(cancelled,completed,delivered)');

  const shipmentIds = shipments?.map(s => s.id) || [];
  console.log('Active shipments:', shipmentIds.length);

  // Get all documents for these shipments
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type, email_id')
    .in('shipment_id', shipmentIds);

  // Count documents per shipment
  const docsPerShipment: Record<string, number> = {};
  docs?.forEach(d => {
    docsPerShipment[d.shipment_id] = (docsPerShipment[d.shipment_id] || 0) + 1;
  });

  const counts = Object.values(docsPerShipment);
  console.log('\nDocs per shipment:');
  console.log('  Min:', Math.min(...counts));
  console.log('  Max:', Math.max(...counts));
  console.log('  Avg:', (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1));
  console.log('  Total docs:', docs?.length);

  // Count unique shipments with each doc type
  const shipmentsWithDocType: Record<string, Set<string>> = {};
  docs?.forEach(d => {
    if (shipmentsWithDocType[d.document_type] === undefined) {
      shipmentsWithDocType[d.document_type] = new Set();
    }
    shipmentsWithDocType[d.document_type].add(d.shipment_id);
  });

  console.log('\nUNIQUE SHIPMENTS with each doc type:');
  console.log('─'.repeat(60));
  console.log('DocType'.padEnd(35) + 'Shipments'.padStart(10) + 'Docs'.padStart(10));
  console.log('─'.repeat(60));

  // Get doc counts too
  const docTypeCounts: Record<string, number> = {};
  docs?.forEach(d => {
    docTypeCounts[d.document_type] = (docTypeCounts[d.document_type] || 0) + 1;
  });

  Object.entries(shipmentsWithDocType)
    .sort((a, b) => b[1].size - a[1].size)
    .forEach(([type, shipmentSet]) => {
      const docCount = docTypeCounts[type] || 0;
      console.log(type.padEnd(35) + shipmentSet.size.toString().padStart(10) + docCount.toString().padStart(10));
    });

  // Specifically check SI and BL coverage
  console.log('\n\nCOVERAGE ANALYSIS:');
  console.log('═'.repeat(60));

  const siTypes = ['shipping_instruction', 'si_submission'];
  const blTypes = ['bill_of_lading'];
  const bookingTypes = ['booking_confirmation', 'booking_amendment'];
  const sobTypes = ['sob_confirmation'];

  const shipmentsWithSI = new Set<string>();
  const shipmentsWithBL = new Set<string>();
  const shipmentsWithBooking = new Set<string>();
  const shipmentsWithSOB = new Set<string>();

  docs?.forEach(d => {
    if (siTypes.includes(d.document_type)) shipmentsWithSI.add(d.shipment_id);
    if (blTypes.includes(d.document_type)) shipmentsWithBL.add(d.shipment_id);
    if (bookingTypes.includes(d.document_type)) shipmentsWithBooking.add(d.shipment_id);
    if (sobTypes.includes(d.document_type)) shipmentsWithSOB.add(d.shipment_id);
  });

  console.log('Shipments with BOOKING docs:', shipmentsWithBooking.size, '/', shipmentIds.length, `(${(shipmentsWithBooking.size / shipmentIds.length * 100).toFixed(0)}%)`);
  console.log('Shipments with SI docs:', shipmentsWithSI.size, '/', shipmentIds.length, `(${(shipmentsWithSI.size / shipmentIds.length * 100).toFixed(0)}%)`);
  console.log('Shipments with BL docs:', shipmentsWithBL.size, '/', shipmentIds.length, `(${(shipmentsWithBL.size / shipmentIds.length * 100).toFixed(0)}%)`);
  console.log('Shipments with SOB docs:', shipmentsWithSOB.size, '/', shipmentIds.length, `(${(shipmentsWithSOB.size / shipmentIds.length * 100).toFixed(0)}%)`);

  // Why 144 booking_confirmation for 121 shipments?
  console.log('\n\nWHY MULTIPLE DOCS PER SHIPMENT?');
  console.log('─'.repeat(60));

  ['booking_confirmation', 'shipping_instruction', 'bill_of_lading'].forEach(docType => {
    const docsOfType: Record<string, number> = {};
    docs?.filter(d => d.document_type === docType)
      .forEach(d => {
        docsOfType[d.shipment_id] = (docsOfType[d.shipment_id] || 0) + 1;
      });

    const with1 = Object.values(docsOfType).filter(c => c === 1).length;
    const with2plus = Object.values(docsOfType).filter(c => c >= 2).length;
    const totalDocs = docTypeCounts[docType] || 0;

    console.log(`\n${docType}:`);
    console.log(`  Total docs: ${totalDocs}`);
    console.log(`  Shipments with 1: ${with1}`);
    console.log(`  Shipments with 2+: ${with2plus}`);
  });

  // Check shipments missing key docs by status
  console.log('\n\nMISSING DOCS BY STATUS:');
  console.log('─'.repeat(60));

  const statusGroups: Record<string, string[]> = {};
  shipments?.forEach(s => {
    if (statusGroups[s.status] === undefined) statusGroups[s.status] = [];
    statusGroups[s.status].push(s.id);
  });

  Object.entries(statusGroups).forEach(([status, ids]) => {
    const withSI = ids.filter(id => shipmentsWithSI.has(id)).length;
    const withBL = ids.filter(id => shipmentsWithBL.has(id)).length;
    const withSOB = ids.filter(id => shipmentsWithSOB.has(id)).length;

    console.log(`\n${status.toUpperCase()} (${ids.length} shipments):`);
    console.log(`  With SI: ${withSI} (${(withSI / ids.length * 100).toFixed(0)}%)`);
    console.log(`  With BL: ${withBL} (${(withBL / ids.length * 100).toFixed(0)}%)`);
    console.log(`  With SOB: ${withSOB} (${(withSOB / ids.length * 100).toFixed(0)}%)`);
  });
}

main().catch(console.error);
