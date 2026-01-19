import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('FINDING UNLINKED CRITICAL DOCUMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const criticalTypes = ['shipping_instruction', 'bill_of_lading', 'arrival_notice'];

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  const shipmentByBooking = new Map<string, string>();
  const allBookings = new Set<string>();
  for (const s of shipments || []) {
    shipmentByBooking.set(s.booking_number, s.id);
    allBookings.add(s.booking_number);
  }

  // Get linked documents
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id, document_type');

  const linkedEmailIds = new Set(linkedDocs?.map(d => d.email_id).filter(Boolean) || []);

  for (const docType of criticalTypes) {
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ ' + docType.toUpperCase().padEnd(73) + '│');
    console.log('└─────────────────────────────────────────────────────────────────────────────┘');

    // Get classifications of this type
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id, confidence_score')
      .eq('document_type', docType)
      .gt('confidence_score', 70);

    // Find unlinked ones
    const unlinked: string[] = [];
    for (const c of classifications || []) {
      if (!linkedEmailIds.has(c.email_id)) {
        unlinked.push(c.email_id);
      }
    }

    console.log('\n   Total classified: ' + classifications?.length);
    console.log('   Unlinked: ' + unlinked.length);

    // Check why unlinked - do they have booking numbers?
    let hasBookingMatchesShipment = 0;
    let hasBookingNoMatch = 0;
    let noBookingExtracted = 0;
    const bookingsNoMatch: string[] = [];
    const shouldLink: { emailId: string; booking: string; subject: string }[] = [];

    for (const emailId of unlinked.slice(0, 200)) {
      // Check entity extraction
      const { data: extraction } = await supabase
        .from('entity_extractions')
        .select('entity_value')
        .eq('email_id', emailId)
        .eq('entity_type', 'booking_number')
        .single();

      if (!extraction) {
        noBookingExtracted++;
        continue;
      }

      const booking = extraction.entity_value;
      if (shipmentByBooking.has(booking)) {
        hasBookingMatchesShipment++;
        // Get email subject for context
        const { data: email } = await supabase
          .from('raw_emails')
          .select('subject')
          .eq('id', emailId)
          .single();

        if (shouldLink.length < 5) {
          shouldLink.push({ emailId, booking, subject: email?.subject || '' });
        }
      } else {
        hasBookingNoMatch++;
        if (bookingsNoMatch.length < 10 && !bookingsNoMatch.includes(booking)) {
          bookingsNoMatch.push(booking);
        }
      }
    }

    console.log('\n   Breakdown of unlinked:');
    console.log('   - No booking # extracted: ' + noBookingExtracted);
    console.log('   - Booking # doesn\'t match any shipment: ' + hasBookingNoMatch);
    console.log('   - SHOULD BE LINKED (booking matches): ' + hasBookingMatchesShipment + ' ⚠️');

    if (shouldLink.length > 0) {
      console.log('\n   Sample documents that SHOULD be linked:');
      for (const item of shouldLink) {
        console.log('   - ' + item.booking + ': ' + item.subject.substring(0, 60));
      }
    }

    if (bookingsNoMatch.length > 0) {
      console.log('\n   Booking numbers with no matching shipment:');
      for (const b of bookingsNoMatch) {
        // Check if similar booking exists
        const similar = [...allBookings].filter(s => s.includes(b) || b.includes(s));
        console.log('   - ' + b + (similar.length > 0 ? ' (similar: ' + similar[0] + ')' : ''));
      }
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('ROOT CAUSE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('\n   1. BOOKING # NOT EXTRACTED:');
  console.log('      - Many SI/BL/AN emails don\'t have booking # in entity_extractions');
  console.log('      - Need to improve extraction or re-process these emails');
  console.log('\n   2. BOOKING # DOESN\'T MATCH SHIPMENT:');
  console.log('      - Email has booking # but we don\'t have that shipment in DB');
  console.log('      - These are for shipments not yet created or different bookings');
  console.log('\n   3. SHOULD BE LINKED:');
  console.log('      - Email has booking # that matches existing shipment');
  console.log('      - Linking step was skipped or failed');
}

main().catch(console.error);
