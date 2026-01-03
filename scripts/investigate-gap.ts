import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigate() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('INVESTIGATING BOOKING CONFIRMATION GAP');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Total shipments
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  const totalShipments = allShipments?.length || 0;
  console.log(`Total shipments: ${totalShipments}\n`);

  // 2. Shipments with booking_confirmation documents
  const { data: withBookingDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .eq('document_type', 'booking_confirmation');

  const uniqueWithBooking = new Set(withBookingDocs?.map(d => d.shipment_id) || []);
  console.log(`Shipments with booking_confirmation doc: ${uniqueWithBooking.size}`);

  // 3. Shipments with ANY documents
  const { data: withAnyDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id');

  const uniqueWithAny = new Set(withAnyDocs?.map(d => d.shipment_id) || []);
  console.log(`Shipments with ANY documents: ${uniqueWithAny.size}`);

  // 4. Shipments with NO documents
  const shipmentsWithNoDocs = allShipments?.filter(s => !uniqueWithAny.has(s.id)) || [];
  console.log(`Shipments with NO documents: ${shipmentsWithNoDocs.length}\n`);

  if (shipmentsWithNoDocs.length > 0) {
    console.log('Sample shipments with NO documents:');
    for (const s of shipmentsWithNoDocs.slice(0, 5)) {
      console.log(`  - ${s.booking_number}`);
    }
  }

  // 5. Document type distribution
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('document_type');

  const docCounts: Record<string, number> = {};
  for (const doc of allDocs || []) {
    docCounts[doc.document_type] = (docCounts[doc.document_type] || 0) + 1;
  }

  console.log('\nDocument type distribution in shipment_documents:');
  console.log('─'.repeat(50));
  const sorted = Object.entries(docCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    console.log(`  ${count.toString().padStart(4)}  ${type}`);
  }

  // 6. Total raw_emails with booking confirmation classification
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  console.log(`\nTotal emails classified as booking_confirmation: ${bookingEmails?.length || 0}`);

  // 7. Check how many booking emails are NOT linked to shipments
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedEmailIds = new Set(linkedDocs?.map(d => d.email_id) || []);

  const unlinkedBookingEmails = bookingEmails?.filter(e => !linkedEmailIds.has(e.email_id)) || [];
  console.log(`Booking confirmation emails NOT linked to any shipment: ${unlinkedBookingEmails.length}`);

  // 8. Shipments WITHOUT booking_confirmation but WITH other docs
  const shipmentsWithoutBooking = allShipments?.filter(s =>
    uniqueWithAny.has(s.id) && !uniqueWithBooking.has(s.id)
  ) || [];

  console.log(`\nShipments WITH docs but WITHOUT booking_confirmation: ${shipmentsWithoutBooking.length}`);

  if (shipmentsWithoutBooking.length > 0) {
    console.log('Sample (first 10):');
    for (const s of shipmentsWithoutBooking.slice(0, 10)) {
      // Get their documents
      const { data: docs } = await supabase
        .from('shipment_documents')
        .select('document_type')
        .eq('shipment_id', s.id);

      const docTypes = docs?.map(d => d.document_type).join(', ') || 'none';
      console.log(`  - ${s.booking_number}: ${docTypes}`);
    }
  }
}

investigate().catch(console.error);
