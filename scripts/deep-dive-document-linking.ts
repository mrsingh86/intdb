import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('DEEP DIVE: DOCUMENT TRACKING & LINKING ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // ============================================================================
  // PART 1: DOCUMENT INVENTORY
  // ============================================================================
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PART 1: DOCUMENT INVENTORY                                                 │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // Total emails
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  // Emails with classifications
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, confidence_score');

  const classifiedEmailIds = new Set(classifications?.map(c => c.email_id) || []);

  // Emails linked to shipments
  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('raw_email_id, shipment_id, document_type');

  const linkedEmailIds = new Set(shipmentDocs?.filter(d => d.raw_email_id).map(d => d.raw_email_id) || []);

  // Entity extractions (has booking number)
  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('email_id, extracted_data');

  const extractedEmailIds = new Set(extractions?.map(e => e.email_id) || []);
  const extractionsWithBooking = extractions?.filter(e => {
    const data = e.extracted_data as any;
    return data?.booking_number;
  }) || [];

  console.log('\n   Total emails in system:        ' + totalEmails);
  console.log('   Emails with classification:    ' + classifiedEmailIds.size);
  console.log('   Emails with entity extraction: ' + extractedEmailIds.size);
  console.log('   Emails with booking # extracted: ' + extractionsWithBooking.length);
  console.log('   Emails linked to shipments:    ' + linkedEmailIds.size);
  console.log('   ────────────────────────────────');
  console.log('   UNLINKED emails:               ' + (totalEmails! - linkedEmailIds.size));

  // ============================================================================
  // PART 2: CLASSIFICATION VS LINKING GAP
  // ============================================================================
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PART 2: CLASSIFICATION VS LINKING GAP                                      │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // Group classifications by type
  const classificationsByType = new Map<string, { total: number; linked: number; unlinked: number }>();

  for (const c of classifications || []) {
    const type = c.document_type;
    const stats = classificationsByType.get(type) || { total: 0, linked: 0, unlinked: 0 };
    stats.total++;
    if (linkedEmailIds.has(c.email_id)) {
      stats.linked++;
    } else {
      stats.unlinked++;
    }
    classificationsByType.set(type, stats);
  }

  console.log('\n   Document Type               Total   Linked   UNLINKED   Link Rate');
  console.log('   ─────────────────────────────────────────────────────────────────');

  const importantTypes = ['booking_confirmation', 'shipping_instruction', 'bill_of_lading',
                          'arrival_notice', 'invoice', 'booking_amendment', 'delivery_order',
                          'vgm_submission', 'container_release'];

  for (const type of importantTypes) {
    const stats = classificationsByType.get(type);
    if (stats) {
      const rate = Math.round((stats.linked / stats.total) * 100);
      console.log('   ' + type.padEnd(25) +
                  stats.total.toString().padStart(5) +
                  stats.linked.toString().padStart(9) +
                  stats.unlinked.toString().padStart(11) +
                  (rate + '%').padStart(11));
    }
  }

  // ============================================================================
  // PART 3: WHY ARE DOCUMENTS NOT LINKED?
  // ============================================================================
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PART 3: WHY ARE DOCUMENTS NOT LINKED?                                      │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // Get unlinked emails with classifications
  const unlinkedClassified = classifications?.filter(c => !linkedEmailIds.has(c.email_id)) || [];

  // Categorize reasons
  let noBookingExtracted = 0;
  let bookingNotInDB = 0;
  let bookingExistsButNotLinked = 0;
  let lowConfidence = 0;

  const bookingsNotInDB: string[] = [];
  const bookingsShouldBeLinked: { booking: string; emailId: string; docType: string }[] = [];

  // Get all shipment booking numbers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  const shipmentByBooking = new Map<string, string>();
  for (const s of shipments || []) {
    shipmentByBooking.set(s.booking_number, s.id);
  }

  for (const c of unlinkedClassified) {
    if (c.confidence_score < 70) {
      lowConfidence++;
      continue;
    }

    // Check if we have extraction for this email
    const extraction = extractions?.find(e => e.email_id === c.email_id);
    if (!extraction) {
      noBookingExtracted++;
      continue;
    }

    const bookingNum = (extraction.extracted_data as any)?.booking_number;
    if (!bookingNum) {
      noBookingExtracted++;
      continue;
    }

    // Check if booking exists in shipments
    const shipmentId = shipmentByBooking.get(bookingNum);
    if (!shipmentId) {
      bookingNotInDB++;
      if (bookingsNotInDB.length < 20) bookingsNotInDB.push(bookingNum);
    } else {
      bookingExistsButNotLinked++;
      if (bookingsShouldBeLinked.length < 20) {
        bookingsShouldBeLinked.push({
          booking: bookingNum,
          emailId: c.email_id,
          docType: c.document_type
        });
      }
    }
  }

  console.log('\n   Unlinked classified emails: ' + unlinkedClassified.length);
  console.log('\n   Breakdown:');
  console.log('   ─────────────────────────────────────────────────');
  console.log('   Low confidence (<70%):           ' + lowConfidence);
  console.log('   No booking # extracted:          ' + noBookingExtracted);
  console.log('   Booking # not in shipments DB:   ' + bookingNotInDB);
  console.log('   BOOKING EXISTS - SHOULD LINK:    ' + bookingExistsButNotLinked + ' ⚠️');

  if (bookingsShouldBeLinked.length > 0) {
    console.log('\n   Sample documents that SHOULD be linked:');
    for (const item of bookingsShouldBeLinked.slice(0, 10)) {
      console.log('   - ' + item.booking + ' | ' + item.docType);
    }
  }

  // ============================================================================
  // PART 4: SHIPMENTS MISSING CRITICAL DOCUMENTS
  // ============================================================================
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PART 4: SHIPMENTS MISSING CRITICAL DOCUMENTS                               │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // Get document types for each shipment
  const docsByShipment = new Map<string, Set<string>>();
  for (const d of shipmentDocs || []) {
    const types = docsByShipment.get(d.shipment_id) || new Set();
    types.add(d.document_type);
    docsByShipment.set(d.shipment_id, types);
  }

  // Expected documents by status
  const expectedDocs: Record<string, string[]> = {
    'draft': ['booking_confirmation'],
    'booked': ['booking_confirmation', 'shipping_instruction'],
    'in_transit': ['booking_confirmation', 'shipping_instruction', 'bill_of_lading'],
    'arrived': ['booking_confirmation', 'bill_of_lading', 'arrival_notice'],
  };

  const missingDocs: { booking: string; status: string; missing: string[] }[] = [];

  for (const s of shipments || []) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('status')
      .eq('id', s.id)
      .single();

    const status = shipment?.status || 'draft';
    const hasDocs = docsByShipment.get(s.id) || new Set();
    const expected = expectedDocs[status] || [];
    const missing = expected.filter(e => !hasDocs.has(e));

    if (missing.length > 0) {
      missingDocs.push({ booking: s.booking_number, status, missing });
    }
  }

  console.log('\n   Shipments missing expected documents: ' + missingDocs.length);

  // Group by missing document type
  const missingByType = new Map<string, number>();
  for (const m of missingDocs) {
    for (const doc of m.missing) {
      missingByType.set(doc, (missingByType.get(doc) || 0) + 1);
    }
  }

  console.log('\n   Missing document breakdown:');
  [...missingByType.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log('   - ' + type + ': ' + count + ' shipments');
  });

  // ============================================================================
  // PART 5: ROOT CAUSE ANALYSIS
  // ============================================================================
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PART 5: ROOT CAUSE ANALYSIS                                                │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  console.log('\n   ISSUE 1: Linking only happens during initial email processing');
  console.log('   - When email is processed, if shipment doesn\'t exist yet, no link created');
  console.log('   - Later emails for same booking may create shipment, but earlier emails not retroactively linked');

  console.log('\n   ISSUE 2: Entity extraction gaps');
  console.log('   - ' + noBookingExtracted + ' emails classified but no booking # extracted');
  console.log('   - Booking # might be in subject/body but extraction failed');

  console.log('\n   ISSUE 3: Booking number variations');
  console.log('   - Same booking with different formats (e.g., MAEU prefix vs without)');
  console.log('   - Booking in email doesn\'t match exactly with shipment record');

  // Check for near-matches
  console.log('\n   Checking for booking number near-matches...');
  const allExtractedBookings = new Set<string>();
  for (const e of extractionsWithBooking) {
    allExtractedBookings.add((e.extracted_data as any).booking_number);
  }

  const shipmentBookings = new Set(shipments?.map(s => s.booking_number) || []);

  let exactMatches = 0;
  let noMatch = 0;
  const unmatched: string[] = [];

  for (const booking of allExtractedBookings) {
    if (shipmentBookings.has(booking)) {
      exactMatches++;
    } else {
      noMatch++;
      if (unmatched.length < 10) unmatched.push(booking);
    }
  }

  console.log('   - Extracted bookings with exact match in DB: ' + exactMatches);
  console.log('   - Extracted bookings with NO match: ' + noMatch);

  if (unmatched.length > 0) {
    console.log('\n   Sample unmatched booking numbers:');
    unmatched.forEach(b => console.log('   - ' + b));
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY & RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  console.log('\n   📊 Current State:');
  console.log('   - ' + totalEmails + ' total emails');
  console.log('   - ' + linkedEmailIds.size + ' linked to shipments (' + Math.round((linkedEmailIds.size / totalEmails!) * 100) + '%)');
  console.log('   - ' + bookingExistsButNotLinked + ' SHOULD BE LINKED (booking exists)');

  console.log('\n   🔧 Recommended Actions:');
  console.log('   1. Run retroactive linking for ' + bookingExistsButNotLinked + ' documents');
  console.log('   2. Improve booking # extraction from email subjects');
  console.log('   3. Add booking # variation matching (with/without carrier prefix)');
  console.log('   4. Re-process emails with low extraction confidence');
}

main().catch(console.error);
