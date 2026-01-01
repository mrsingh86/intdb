import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('CORRECTED ANALYSIS: DOCUMENT LINKING');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Get entity extractions for booking numbers
  const { data: bookingExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  const emailsWithBooking = new Map<string, string>();
  for (const e of bookingExtractions || []) {
    emailsWithBooking.set(e.email_id, e.entity_value);
  }

  console.log('\n1. ENTITY EXTRACTIONS:');
  console.log('   Emails with booking # extracted:', emailsWithBooking.size);

  // 2. Get linked documents (using email_id column)
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id, document_type');

  const linkedEmailIds = new Set<string>();
  for (const d of linkedDocs || []) {
    if (d.email_id) linkedEmailIds.add(d.email_id);
  }

  console.log('\n2. SHIPMENT_DOCUMENTS:');
  console.log('   Total document links:', linkedDocs?.length);
  console.log('   With email_id populated:', linkedEmailIds.size);

  // 3. Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  const shipmentByBooking = new Map<string, string>();
  for (const s of shipments || []) {
    shipmentByBooking.set(s.booking_number, s.id);
  }

  console.log('\n3. SHIPMENTS:');
  console.log('   Total shipments:', shipments?.length);

  // 4. Find emails with booking # that SHOULD be linked but AREN'T
  const shouldBeLinked: { emailId: string; booking: string }[] = [];

  for (const [emailId, booking] of emailsWithBooking) {
    // Check if shipment exists for this booking
    if (shipmentByBooking.has(booking)) {
      // Check if email is already linked
      const isLinked = linkedEmailIds.has(emailId);
      if (!isLinked) {
        shouldBeLinked.push({ emailId, booking });
      }
    }
  }

  console.log('\n4. LINKING GAP ANALYSIS:');
  const matchingShipments = [...emailsWithBooking.values()].filter(b => shipmentByBooking.has(b));
  console.log('   Emails with booking # matching a shipment:', matchingShipments.length);
  console.log('   Already linked:', linkedEmailIds.size);
  console.log('   SHOULD BE LINKED (gap):', shouldBeLinked.length);

  // 5. Group by booking to see impact
  const gapByBooking = new Map<string, number>();
  for (const item of shouldBeLinked) {
    gapByBooking.set(item.booking, (gapByBooking.get(item.booking) || 0) + 1);
  }

  console.log('\n5. TOP BOOKINGS WITH UNLINKED EMAILS:');
  const sorted = [...gapByBooking.entries()].sort((a, b) => b[1] - a[1]);
  for (const [booking, count] of sorted.slice(0, 15)) {
    // Get what doc types are linked vs missing
    const shipmentId = shipmentByBooking.get(booking);
    const { data: existingDocs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .eq('shipment_id', shipmentId);

    const linkedTypes = existingDocs?.map(d => d.document_type).join(', ') || 'none';
    console.log('   ' + booking + ': ' + count + ' unlinked emails (has: ' + linkedTypes.substring(0, 50) + ')');
  }

  // 6. Check document classifications for unlinked emails
  console.log('\n6. DOCUMENT TYPES OF UNLINKED EMAILS (sample of 500):');
  const unlinkedDocTypes = new Map<string, number>();

  for (const item of shouldBeLinked.slice(0, 500)) {
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', item.emailId)
      .single();

    if (classification) {
      const type = classification.document_type;
      unlinkedDocTypes.set(type, (unlinkedDocTypes.get(type) || 0) + 1);
    }
  }

  [...unlinkedDocTypes.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log('   ' + type + ': ' + count);
  });

  // 7. Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('\n   Total emails with booking #: ' + emailsWithBooking.size);
  console.log('   Emails linked to shipments: ' + linkedEmailIds.size);
  console.log('   UNLINKED but SHOULD BE: ' + shouldBeLinked.length);
  console.log('   Affected shipments: ' + gapByBooking.size);
}

main().catch(console.error);
