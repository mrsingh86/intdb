import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('UNLINKED ARRIVAL NOTICES - WHY?');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get unlinked arrival notice emails
  const { data: anClassifications } = await supabase
    .from('document_classifications')
    .select('email_id, confidence_score')
    .eq('document_type', 'arrival_notice')
    .gt('confidence_score', 70);

  // Get linked email IDs
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('raw_email_id');

  const linkedEmailIds = new Set(linkedDocs?.map(d => d.raw_email_id).filter(Boolean) || []);

  // Find unlinked ones
  const unlinkedEmailIds = anClassifications?.filter(c => {
    return !linkedEmailIds.has(c.email_id);
  }).map(c => c.email_id) || [];

  console.log('\nTotal arrival_notice classifications:', anClassifications?.length);
  console.log('Unlinked:', unlinkedEmailIds.length);

  console.log('\nSample unlinked arrival notice emails:');

  for (const emailId of unlinkedEmailIds.slice(0, 10)) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, true_sender_email')
      .eq('id', emailId)
      .single();

    // Check if there's an entity extraction with booking number
    const { data: extraction } = await supabase
      .from('entity_extractions')
      .select('extracted_data')
      .eq('email_id', emailId)
      .single();

    const bookingNum = (extraction?.extracted_data as any)?.booking_number || 'none';

    console.log('\n   Email: ' + email?.subject?.substring(0, 70));
    console.log('   From: ' + email?.true_sender_email);
    console.log('   Booking #: ' + bookingNum);

    // Check if this booking exists in shipments
    if (bookingNum !== 'none') {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('booking_number, status')
        .eq('booking_number', bookingNum)
        .single();

      console.log('   Shipment exists: ' + (shipment ? 'YES (' + shipment.status + ')' : 'NO'));
    }
  }

  // Count categories
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('CATEGORIZING UNLINKED ARRIVAL NOTICES:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  let noShipment = 0;
  let hasShipmentNotLinked = 0;
  let noExtraction = 0;
  const matchingBookings: string[] = [];

  for (const emailId of unlinkedEmailIds) {
    const { data: extraction } = await supabase
      .from('entity_extractions')
      .select('extracted_data')
      .eq('email_id', emailId)
      .single();

    if (!extraction) {
      noExtraction++;
      continue;
    }

    const bookingNum = (extraction.extracted_data as any)?.booking_number;
    if (!bookingNum) {
      noExtraction++;
      continue;
    }

    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, booking_number')
      .eq('booking_number', bookingNum)
      .single();

    if (shipment) {
      hasShipmentNotLinked++;
      if (matchingBookings.length < 10) matchingBookings.push(bookingNum);
    } else {
      noShipment++;
    }
  }

  console.log('\n   Has matching shipment (should link!): ' + hasShipmentNotLinked);
  console.log('   No matching shipment in DB: ' + noShipment);
  console.log('   No booking # extracted: ' + noExtraction);

  if (matchingBookings.length > 0) {
    console.log('\n   Sample bookings that SHOULD be linked:');
    matchingBookings.forEach(b => console.log('   - ' + b));
  }
}

main().catch(console.error);
