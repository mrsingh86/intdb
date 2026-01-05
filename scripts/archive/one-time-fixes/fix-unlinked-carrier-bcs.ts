/**
 * Fix Unlinked Carrier Booking Confirmations
 *
 * This script identifies carrier booking confirmation emails that:
 * 1. Are classified as booking_confirmation
 * 2. Have an extracted booking number
 * 3. Are from a known carrier (via pattern or domain)
 * 4. Are NOT linked to any shipment
 *
 * It then resets their processing_status so they get reprocessed.
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Carrier patterns to match in sender_email
const CARRIER_PATTERNS = [
  /maersk/i,
  /in\.export/i,
  /hlag|hapag/i,
  /cma.cgm|cma cgm/i,
  /coscon|cosco/i,
  /one-line|ocean network express/i,
  /evergreen/i,
  /\bmsc\b|mediterranean shipping/i,
  /yang\s*ming|yml/i,
  /\bzim\b/i,
  /oocl/i,
  /apl\b/i,
];

function isCarrierEmail(senderEmail: string): boolean {
  const sender = senderEmail.toLowerCase();
  return CARRIER_PATTERNS.some(pattern => pattern.test(sender));
}

async function fixUnlinkedCarrierBCs() {
  console.log('=== FIX UNLINKED CARRIER BOOKING CONFIRMATIONS ===\n');

  // 1. Get all booking_confirmation classifications
  const classifications = await getAllRows<{email_id: string; document_type: string}>(
    supabase, 'document_classifications', 'email_id, document_type'
  );
  const bcEmailIds = new Set(
    classifications
      .filter(c => c.document_type === 'booking_confirmation')
      .map(c => c.email_id)
  );
  console.log('Booking confirmation emails:', bcEmailIds.size);

  // 2. Get all shipment_documents to find what's already linked
  const shipmentDocs = await getAllRows<{email_id: string}>(
    supabase, 'shipment_documents', 'email_id'
  );
  const linkedEmailIds = new Set(shipmentDocs.map(d => d.email_id));
  console.log('Emails already linked to shipments:', linkedEmailIds.size);

  // 3. Get all raw_emails with sender info
  const emails = await getAllRows<{id: string; sender_email: string; subject: string; email_direction: string; processing_status: string}>(
    supabase, 'raw_emails', 'id, sender_email, subject, email_direction, processing_status'
  );
  const emailMap = new Map(emails.map(e => [e.id, e]));

  // 4. Get entity extractions for booking numbers
  const extractions = await getAllRows<{email_id: string; entity_type: string; entity_value: string}>(
    supabase, 'entity_extractions', 'email_id, entity_type, entity_value'
  );
  const bookingByEmail = new Map<string, string>();
  extractions
    .filter(e => e.entity_type === 'booking_number' && e.entity_value)
    .forEach(e => bookingByEmail.set(e.email_id, e.entity_value));

  // 5. Find unlinked carrier BC emails
  const unlinkedCarrierBCs: Array<{
    email_id: string;
    sender_email: string;
    subject: string;
    booking_number: string;
    direction: string;
  }> = [];

  for (const emailId of bcEmailIds) {
    // Skip if already linked
    if (linkedEmailIds.has(emailId)) continue;

    const email = emailMap.get(emailId);
    if (!email) continue;

    // Check if from carrier
    if (!isCarrierEmail(email.sender_email || '')) continue;

    // Check if has booking number
    const bookingNumber = bookingByEmail.get(emailId);
    if (!bookingNumber) continue;

    unlinkedCarrierBCs.push({
      email_id: emailId,
      sender_email: email.sender_email,
      subject: email.subject,
      booking_number: bookingNumber,
      direction: email.email_direction,
    });
  }

  console.log('\n=== UNLINKED CARRIER BOOKING CONFIRMATIONS ===');
  console.log('Found:', unlinkedCarrierBCs.length);

  if (unlinkedCarrierBCs.length === 0) {
    console.log('No unlinked carrier booking confirmations to fix!');
    return;
  }

  console.log('\nDetails:');
  unlinkedCarrierBCs.forEach(bc => {
    console.log(`  ${bc.booking_number} | ${bc.direction} | ${bc.sender_email?.substring(0, 50)}`);
  });

  // 6. Check if shipments exist for these booking numbers
  const shipments = await getAllRows<{id: string; booking_number: string}>(
    supabase, 'shipments', 'id, booking_number'
  );
  const shipmentByBooking = new Map(shipments.map(s => [s.booking_number, s.id]));

  console.log('\n=== ANALYSIS ===');
  let canLink = 0;
  let needsShipment = 0;

  for (const bc of unlinkedCarrierBCs) {
    const shipmentId = shipmentByBooking.get(bc.booking_number);
    if (shipmentId) {
      console.log(`  ${bc.booking_number}: Shipment EXISTS - can link directly`);
      canLink++;
    } else {
      console.log(`  ${bc.booking_number}: NO shipment - needs creation`);
      needsShipment++;
    }
  }

  console.log(`\nCan link directly: ${canLink}`);
  console.log(`Needs shipment creation: ${needsShipment}`);

  // 7. Reset processing status for reprocessing
  console.log('\n=== RESETTING FOR REPROCESSING ===');
  let reset = 0;

  for (const bc of unlinkedCarrierBCs) {
    const { error } = await supabase
      .from('raw_emails')
      .update({ processing_status: 'classified' })
      .eq('id', bc.email_id);

    if (!error) {
      reset++;
      console.log(`  Reset: ${bc.booking_number}`);
    } else {
      console.log(`  Error resetting ${bc.booking_number}: ${error.message}`);
    }
  }

  console.log(`\nReset ${reset} emails for reprocessing.`);
  console.log('Run the cron job to process these emails and create/link shipments.');
}

fixUnlinkedCarrierBCs().catch(console.error);
