#!/usr/bin/env npx tsx
/**
 * Investigate Why Booking Confirmations Are Unlinked
 *
 * Analyzes the 55+ booking_confirmation emails that aren't linked
 * to any shipment to understand why.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function investigate() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('INVESTIGATING UNLINKED BOOKING CONFIRMATIONS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all booking_confirmation classifications
  const { data: bookingClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bookingEmailIds = new Set(bookingClassifications?.map(c => c.email_id) || []);
  console.log(`Total booking_confirmation emails: ${bookingEmailIds.size}`);

  // 2. Get all linked emails from shipment_documents
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedEmailIds = new Set(linkedDocs?.map(d => d.email_id) || []);
  console.log(`Linked emails (all types): ${linkedEmailIds.size}`);

  // 3. Find unlinked booking confirmations
  const unlinkedBookingIds: string[] = [];
  for (const emailId of bookingEmailIds) {
    if (!linkedEmailIds.has(emailId)) {
      unlinkedBookingIds.push(emailId);
    }
  }
  console.log(`Unlinked booking_confirmations: ${unlinkedBookingIds.length}`);
  console.log('');

  // 4. Analyze unlinked ones
  console.log('ANALYSIS OF UNLINKED BOOKING CONFIRMATIONS:');
  console.log('─'.repeat(60));

  // Get raw_emails data for unlinked ones
  const { data: unlinkedEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, processing_status, received_at')
    .in('id', unlinkedBookingIds.slice(0, 100));

  // Get entity extractions for unlinked ones
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', unlinkedBookingIds);

  // Group entities by email
  const entitiesByEmail: Record<string, Record<string, string>> = {};
  for (const e of entities || []) {
    if (!entitiesByEmail[e.email_id]) entitiesByEmail[e.email_id] = {};
    entitiesByEmail[e.email_id][e.entity_type] = e.entity_value;
  }

  // Analyze patterns
  let hasBookingNumber = 0;
  let hasBlNumber = 0;
  let hasContainerNumber = 0;
  let hasNoIdentifier = 0;
  const processingStatusCounts: Record<string, number> = {};

  for (const email of unlinkedEmails || []) {
    // Count processing status
    processingStatusCounts[email.processing_status || 'null'] =
      (processingStatusCounts[email.processing_status || 'null'] || 0) + 1;

    // Check what identifiers exist
    const emailEntities = entitiesByEmail[email.id] || {};
    const hasBooking = !!emailEntities.booking_number;
    const hasBl = !!emailEntities.bl_number;
    const hasContainer = !!emailEntities.container_number || !!emailEntities.container_numbers;

    if (hasBooking) hasBookingNumber++;
    if (hasBl) hasBlNumber++;
    if (hasContainer) hasContainerNumber++;
    if (!hasBooking && !hasBl && !hasContainer) hasNoIdentifier++;
  }

  console.log('');
  console.log('PROCESSING STATUS DISTRIBUTION:');
  for (const [status, count] of Object.entries(processingStatusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(25)} ${count}`);
  }

  console.log('');
  console.log('IDENTIFIER AVAILABILITY:');
  console.log(`  Has booking_number:     ${hasBookingNumber} / ${unlinkedEmails?.length}`);
  console.log(`  Has bl_number:          ${hasBlNumber} / ${unlinkedEmails?.length}`);
  console.log(`  Has container_number:   ${hasContainerNumber} / ${unlinkedEmails?.length}`);
  console.log(`  Has NO identifier:      ${hasNoIdentifier} / ${unlinkedEmails?.length}`);

  // 5. Sample 5 unlinked emails with booking numbers (should have been linked)
  console.log('');
  console.log('SAMPLE UNLINKED EMAILS WITH BOOKING NUMBERS (should have been linked):');
  console.log('─'.repeat(80));

  let sampleCount = 0;
  for (const email of unlinkedEmails || []) {
    const emailEntities = entitiesByEmail[email.id] || {};
    if (emailEntities.booking_number && sampleCount < 5) {
      sampleCount++;
      console.log(`\n${sampleCount}. Email ID: ${email.id}`);
      console.log(`   Subject: ${(email.subject || '').substring(0, 70)}`);
      console.log(`   Sender: ${email.sender_email}`);
      console.log(`   Status: ${email.processing_status}`);
      console.log(`   Booking#: ${emailEntities.booking_number}`);
      console.log(`   BL#: ${emailEntities.bl_number || 'N/A'}`);

      // Check if this booking number exists in shipments
      const { data: matchingShipment } = await supabase
        .from('shipments')
        .select('id, booking_number')
        .eq('booking_number', emailEntities.booking_number)
        .maybeSingle();

      if (matchingShipment) {
        console.log(`   ⚠️ SHIPMENT EXISTS: ${matchingShipment.id} - Should have been linked!`);
      } else {
        console.log(`   ℹ️ No matching shipment found for this booking number`);
      }
    }
  }

  // 6. Check if unlinked emails have processing_status = 'processed'
  console.log('');
  console.log('═'.repeat(80));
  console.log('ROOT CAUSE ANALYSIS:');
  console.log('═'.repeat(80));

  const { data: pendingEmails } = await supabase
    .from('raw_emails')
    .select('id, processing_status')
    .in('id', unlinkedBookingIds)
    .neq('processing_status', 'processed');

  console.log(`\nUnlinked booking_confirmations NOT fully processed: ${pendingEmails?.length}`);

  if (pendingEmails && pendingEmails.length > 0) {
    console.log('\nThese emails may not have completed the full pipeline.');
    console.log('They need to be reprocessed to create shipment links.');
  }

  // Check for emails processed but still not linked (the real issue)
  const { data: processedButUnlinked } = await supabase
    .from('raw_emails')
    .select('id')
    .in('id', unlinkedBookingIds)
    .eq('processing_status', 'processed');

  console.log(`\nUnlinked booking_confirmations that ARE processed: ${processedButUnlinked?.length}`);

  if (processedButUnlinked && processedButUnlinked.length > 0) {
    console.log('\nThese were processed but not linked - possible pipeline gap.');
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

investigate().catch(console.error);
