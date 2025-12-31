#!/usr/bin/env npx tsx
/**
 * Investigate why emails with cutoff entities aren't linked to shipments
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function investigate() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('INVESTIGATING: Why 255 emails with cutoffs are NOT linked to shipments');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all emails with cutoff entities (with pagination)
  const cutoffTypes = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];
  const emailsWithCutoffs = new Set<string>();

  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type')
      .in('entity_type', cutoffTypes)
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    data.forEach(e => emailsWithCutoffs.add(e.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Total emails with cutoff entities: ${emailsWithCutoffs.size}`);

  // 2. Get all linked emails (with pagination)
  const linkedEmails = new Set<string>();
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    data.forEach(l => linkedEmails.add(l.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Total linked emails: ${linkedEmails.size}`);

  // 3. Find orphaned emails (have cutoffs but not linked)
  const orphanedEmails: string[] = [];
  for (const emailId of emailsWithCutoffs) {
    if (!linkedEmails.has(emailId)) {
      orphanedEmails.push(emailId);
    }
  }

  console.log(`Orphaned emails (cutoffs but not linked): ${orphanedEmails.length}`);
  console.log('');

  // 4. Get all entity extractions for orphaned emails (with pagination)
  const orphanEntities = new Map<string, Map<string, string>>();

  // Process in batches of 100 email IDs
  for (let i = 0; i < orphanedEmails.length; i += 100) {
    const batch = orphanedEmails.slice(i, i + 100);
    const { data } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('email_id', batch);

    for (const e of data || []) {
      if (!orphanEntities.has(e.email_id)) {
        orphanEntities.set(e.email_id, new Map());
      }
      orphanEntities.get(e.email_id)!.set(e.entity_type, e.entity_value);
    }
  }

  // 5. Analyze: Do they have booking numbers?
  let hasBookingNumber = 0;
  let hasBlNumber = 0;
  let hasNoIdentifier = 0;
  const bookingNumbers: string[] = [];
  const blNumbers: string[] = [];

  for (const [emailId, entities] of orphanEntities) {
    const booking = entities.get('booking_number');
    const bl = entities.get('bl_number');

    if (booking) {
      hasBookingNumber++;
      bookingNumbers.push(booking);
    } else if (bl) {
      hasBlNumber++;
      blNumbers.push(bl);
    } else {
      hasNoIdentifier++;
    }
  }

  console.log('IDENTIFIER ANALYSIS:');
  console.log('─'.repeat(60));
  console.log(`  Has booking_number:     ${hasBookingNumber}`);
  console.log(`  Has bl_number only:     ${hasBlNumber}`);
  console.log(`  Has NO identifier:      ${hasNoIdentifier}`);
  console.log('');

  // 6. Check if shipments exist for these booking numbers
  const { data: existingShipments } = await supabase
    .from('shipments')
    .select('booking_number, bl_number');

  const shipmentByBooking = new Map<string, boolean>();
  const shipmentByBl = new Map<string, boolean>();

  for (const ship of existingShipments || []) {
    if (ship.booking_number) shipmentByBooking.set(ship.booking_number, true);
    if (ship.bl_number) shipmentByBl.set(ship.bl_number, true);
  }

  let matchingShipmentExists = 0;
  let noMatchingShipment = 0;
  const canLink: { emailId: string; booking: string; bl: string | null }[] = [];
  const cannotLink: { emailId: string; booking: string | null; bl: string | null }[] = [];

  for (const [emailId, entities] of orphanEntities) {
    const booking = entities.get('booking_number');
    const bl = entities.get('bl_number');

    const bookingMatch = booking && shipmentByBooking.has(booking);
    const blMatch = bl && shipmentByBl.has(bl);

    if (bookingMatch || blMatch) {
      matchingShipmentExists++;
      canLink.push({ emailId, booking: booking || '', bl });
    } else {
      noMatchingShipment++;
      cannotLink.push({ emailId, booking, bl });
    }
  }

  console.log('SHIPMENT MATCHING:');
  console.log('─'.repeat(60));
  console.log(`  Matching shipment EXISTS: ${matchingShipmentExists} (CAN be linked)`);
  console.log(`  NO matching shipment:     ${noMatchingShipment} (need new shipment)`);
  console.log('');

  // 7. Sample: Linkable emails
  console.log('SAMPLE: Emails that CAN be linked (shipment exists):');
  console.log('─'.repeat(60));
  for (const item of canLink.slice(0, 5)) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', item.emailId)
      .single();

    console.log(`  Booking: ${item.booking || 'N/A'}`);
    console.log(`  Subject: ${(email?.subject || 'N/A').substring(0, 50)}`);
    console.log(`  Sender:  ${email?.sender_email}`);
    console.log('');
  }

  // 8. Sample: Cannot link
  console.log('SAMPLE: Emails that CANNOT be linked (no shipment):');
  console.log('─'.repeat(60));
  for (const item of cannotLink.slice(0, 5)) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', item.emailId)
      .single();

    console.log(`  Booking: ${item.booking || 'N/A'} | BL: ${item.bl || 'N/A'}`);
    console.log(`  Subject: ${(email?.subject || 'N/A').substring(0, 50)}`);
    console.log(`  Sender:  ${email?.sender_email}`);
    console.log('');
  }

  // 9. Summary
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Orphaned cutoff emails:     ${orphanedEmails.length}`);
  console.log(`  → Can be linked NOW:        ${matchingShipmentExists}`);
  console.log(`  → Need new shipment:        ${noMatchingShipment}`);
  console.log('');
  console.log(`  Potential cutoff coverage after linking: ~${Math.round((linkedEmails.size + matchingShipmentExists) / emailsWithCutoffs.size * 100)}%`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  return { canLink, cannotLink };
}

investigate().catch(console.error);
