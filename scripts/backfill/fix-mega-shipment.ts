/**
 * Fix Mega-Shipment 7006150312
 *
 * The old code (knownValues.bookingNumber || extracted) meant thread-inherited
 * booking numbers overwrote what the email actually contained. So stored
 * booking_number already matches the shipment — we can't detect conflicts
 * from stored data alone.
 *
 * Strategy: Re-extract booking numbers from email subject + body_preview,
 * compare with shipment's booking number. If the email's OWN content mentions
 * a different booking, it was wrongly linked via thread inheritance.
 */

import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_BOOKING = '7006150312';

/** Same regex patterns used by chronicle-service.ts extractBookingNumber */
function extractBookingFromContent(subject: string, body: string): string | null {
  const text = (subject || '') + ' ' + (body || '');
  const patterns = [
    /BKG[#:\s]*([A-Z0-9]{8,20})/i,
    /BOOKING[#:\s]*([A-Z0-9]{8,20})/i,
    /\b(\d{9,10})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractMblFromContent(subject: string, body: string): string | null {
  const text = (subject || '') + ' ' + (body || '');
  const patterns = [
    /B\/L[#:\s]*([A-Z0-9]{8,20})/i,
    /MBL[#:\s]*([A-Z0-9]{8,20})/i,
    /BILL OF LADING[#:\s]*([A-Z0-9]{8,20})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fixMegaShipment(): Promise<void> {
  console.log('='.repeat(60));
  console.log(`FIX MEGA-SHIPMENT: ${TARGET_BOOKING}`);
  console.log('='.repeat(60));

  // Step 1: Find the shipment
  const { data: shipment, error: shipErr } = await supabase
    .from('shipments')
    .select('id, booking_number, mbl_number')
    .eq('booking_number', TARGET_BOOKING)
    .single();

  if (shipErr || !shipment) {
    console.error(`Shipment ${TARGET_BOOKING} not found:`, shipErr?.message);
    return;
  }

  console.log(`\nShipment: ${shipment.id}`);
  console.log(`  booking_number: ${shipment.booking_number}`);
  console.log(`  mbl_number: ${shipment.mbl_number || 'NULL'}`);

  // Step 2: Fetch all thread-linked chronicles with subject + body
  const { data: threadLinked, error: fetchErr } = await supabase
    .from('chronicle')
    .select('id, booking_number, mbl_number, linked_by, thread_id, subject, body_preview')
    .eq('shipment_id', shipment.id)
    .eq('linked_by', 'thread');

  if (fetchErr || !threadLinked) {
    console.error('Failed to fetch chronicles:', fetchErr?.message);
    return;
  }

  // Also get total count
  const { count: totalCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .eq('shipment_id', shipment.id);

  console.log(`\nTotal chronicles linked: ${totalCount}`);
  console.log(`Thread-linked chronicles: ${threadLinked.length}`);

  // Step 3: Re-extract booking from email content, find conflicts
  const conflicting: typeof threadLinked = [];
  const genuineThread: typeof threadLinked = [];
  const noBookingExtracted: typeof threadLinked = [];

  for (const c of threadLinked) {
    const extractedBooking = extractBookingFromContent(c.subject || '', c.body_preview || '');
    const extractedMbl = extractMblFromContent(c.subject || '', c.body_preview || '');

    // Conflict: email content has a DIFFERENT booking than the shipment
    const bookingConflict = extractedBooking
      && extractedBooking !== shipment.booking_number;
    const mblConflict = extractedMbl
      && shipment.mbl_number
      && extractedMbl !== shipment.mbl_number;

    if (bookingConflict || mblConflict) {
      conflicting.push({ ...c, _extractedBooking: extractedBooking, _extractedMbl: extractedMbl } as any);
    } else if (!extractedBooking && !extractedMbl) {
      // No identifier extractable — could be generic emails, keep linked
      noBookingExtracted.push(c);
    } else {
      genuineThread.push(c);
    }
  }

  console.log(`\nAnalysis of ${threadLinked.length} thread-linked records:`);
  console.log(`  Genuine (extracted booking matches): ${genuineThread.length}`);
  console.log(`  Conflicting (extracted booking DIFFERS): ${conflicting.length}`);
  console.log(`  No booking extractable (kept as-is): ${noBookingExtracted.length}`);

  if (conflicting.length === 0) {
    console.log('\nNo conflicting records found. Nothing to fix.');
    return;
  }

  // Show sample conflicts
  const sample = conflicting.slice(0, 10);
  console.log('\nSample conflicts:');
  for (const c of sample) {
    const extracted = (c as any)._extractedBooking || (c as any)._extractedMbl || 'none';
    console.log(`  ${c.id.substring(0, 8)}...: stored=${c.booking_number}, extracted=${extracted}, subject="${(c.subject || '').substring(0, 60)}"`);
  }

  // Count unique extracted bookings
  const uniqueBookings = new Set(conflicting.map(c => (c as any)._extractedBooking).filter(Boolean));
  console.log(`\nUnique conflicting booking numbers: ${uniqueBookings.size}`);
  for (const bk of Array.from(uniqueBookings).slice(0, 15)) {
    const count = conflicting.filter(c => (c as any)._extractedBooking === bk).length;
    console.log(`  ${bk}: ${count} records`);
  }

  // Step 4: Unlink conflicting records + clear inherited booking_number
  console.log(`\nUnlinking ${conflicting.length} conflicting records...`);
  const conflictIds = conflicting.map(c => c.id);

  let unlinked = 0;
  for (let i = 0; i < conflictIds.length; i += 100) {
    const batch = conflictIds.slice(i, i + 100);
    const { error: unlinkErr } = await supabase
      .from('chronicle')
      .update({ shipment_id: null, linked_by: null, linked_at: null })
      .in('id', batch);

    if (unlinkErr) {
      console.error(`Batch ${Math.floor(i / 100) + 1} unlink error:`, unlinkErr.message);
    } else {
      unlinked += batch.length;
    }
  }
  console.log(`Unlinked: ${unlinked}`);

  // Step 5: Fix the stored booking_number to match email content
  console.log('\nFixing stored booking numbers from email content...');
  let bookingFixed = 0;
  for (const c of conflicting) {
    const extracted = (c as any)._extractedBooking;
    if (extracted && extracted !== c.booking_number) {
      const { error } = await supabase
        .from('chronicle')
        .update({ booking_number: extracted })
        .eq('id', c.id);
      if (!error) bookingFixed++;
    }
  }
  console.log(`Booking numbers corrected: ${bookingFixed}`);

  // Step 6: Re-run linking RPC for each unlinked record
  console.log(`\nRe-linking ${unlinked} records via RPC...`);
  let relinkedSame = 0;
  let relinkedDifferent = 0;
  let remainedUnlinked = 0;
  const newShipments: Record<string, number> = {};

  for (let i = 0; i < conflictIds.length; i++) {
    const id = conflictIds[i];
    const { data: linkResult, error: linkErr } = await supabase.rpc(
      'link_chronicle_to_shipment',
      { chronicle_id: id }
    );

    if (linkErr) {
      console.error(`  RPC error for ${id}:`, linkErr.message);
      remainedUnlinked++;
      continue;
    }

    if (!linkResult || linkResult.length === 0) {
      remainedUnlinked++;
      continue;
    }

    const result = linkResult[0];
    if (result.shipment_id === shipment.id) {
      relinkedSame++;
    } else {
      relinkedDifferent++;
      const key = result.shipment_id;
      newShipments[key] = (newShipments[key] || 0) + 1;
    }

    // Progress every 50
    if ((i + 1) % 50 === 0) {
      console.log(`  Progress: ${i + 1}/${conflictIds.length}`);
    }
  }

  // Step 7: Report
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Re-linked to SAME shipment (${TARGET_BOOKING}): ${relinkedSame}`);
  console.log(`Re-linked to DIFFERENT shipment: ${relinkedDifferent}`);
  console.log(`Remained unlinked: ${remainedUnlinked}`);

  if (Object.keys(newShipments).length > 0) {
    console.log('\nNew shipment distribution:');
    for (const [sid, count] of Object.entries(newShipments).sort((a, b) => b[1] - a[1])) {
      const { data: s } = await supabase
        .from('shipments')
        .select('booking_number')
        .eq('id', sid)
        .single();
      console.log(`  ${s?.booking_number || sid}: ${count} records`);
    }
  }

  // Verify final count
  const { count: finalCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .eq('shipment_id', shipment.id);

  console.log(`\nFinal chronicle count for ${TARGET_BOOKING}: ${finalCount} (was ${totalCount})`);
}

fixMegaShipment().catch(console.error);
