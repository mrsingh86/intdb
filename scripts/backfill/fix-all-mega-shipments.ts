/**
 * Fix All Mega-Shipments (>50 chronicles)
 *
 * The old code (knownValues.bookingNumber || extracted) meant thread-inherited
 * booking numbers overwrote what the email actually contained. We re-extract
 * from subject + body_preview to find the real booking, correct it, and re-link.
 */

import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const MEGA_THRESHOLD = 50;

/** Same regex patterns used by chronicle-service.ts */
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

interface ShipmentResult {
  unlinked: number;
  bookingFixed: number;
  relinkedSame: number;
  relinkedDifferent: number;
  remainedUnlinked: number;
}

async function fixShipment(
  shipmentId: string,
  bookingNumber: string,
  mblNumber: string | null
): Promise<ShipmentResult> {
  const result: ShipmentResult = { unlinked: 0, bookingFixed: 0, relinkedSame: 0, relinkedDifferent: 0, remainedUnlinked: 0 };

  // Fetch thread-linked chronicles with content
  const { data: threadLinked } = await supabase
    .from('chronicle')
    .select('id, booking_number, mbl_number, subject, body_preview')
    .eq('shipment_id', shipmentId)
    .eq('linked_by', 'thread');

  if (!threadLinked || threadLinked.length === 0) return result;

  // Re-extract from email content, find conflicts
  const conflicting: Array<typeof threadLinked[0] & { _extractedBooking: string | null }> = [];

  for (const c of threadLinked) {
    const extractedBooking = extractBookingFromContent(c.subject || '', c.body_preview || '');
    const extractedMbl = extractMblFromContent(c.subject || '', c.body_preview || '');

    const bookingConflict = extractedBooking && extractedBooking !== bookingNumber;
    const mblConflict = extractedMbl && mblNumber && extractedMbl !== mblNumber;

    if (bookingConflict || mblConflict) {
      conflicting.push({ ...c, _extractedBooking: extractedBooking });
    }
  }

  if (conflicting.length === 0) return result;

  // Unlink in batches
  const conflictIds = conflicting.map(c => c.id);
  for (let i = 0; i < conflictIds.length; i += 100) {
    const batch = conflictIds.slice(i, i + 100);
    const { error } = await supabase
      .from('chronicle')
      .update({ shipment_id: null, linked_by: null, linked_at: null })
      .in('id', batch);
    if (!error) result.unlinked += batch.length;
  }

  // Fix stored booking numbers
  for (const c of conflicting) {
    if (c._extractedBooking && c._extractedBooking !== c.booking_number) {
      const { error } = await supabase
        .from('chronicle')
        .update({ booking_number: c._extractedBooking })
        .eq('id', c.id);
      if (!error) result.bookingFixed++;
    }
  }

  // Re-link via RPC
  for (const id of conflictIds) {
    const { data: linkResult, error: linkErr } = await supabase.rpc(
      'link_chronicle_to_shipment',
      { chronicle_id: id }
    );

    if (linkErr || !linkResult || linkResult.length === 0) {
      result.remainedUnlinked++;
      continue;
    }

    if (linkResult[0].shipment_id === shipmentId) {
      result.relinkedSame++;
    } else {
      result.relinkedDifferent++;
    }
  }

  return result;
}

async function fixAllMegaShipments(): Promise<void> {
  console.log('='.repeat(60));
  console.log(`FIX ALL MEGA-SHIPMENTS (>${MEGA_THRESHOLD} chronicles)`);
  console.log('='.repeat(60));

  // Find all mega-shipments via counting
  console.log('\nFinding mega-shipments...');
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, mbl_number');

  if (!shipments) {
    console.error('Failed to fetch shipments');
    return;
  }

  const megaShipments: Array<{ id: string; booking_number: string; mbl_number: string | null; count: number }> = [];

  for (const s of shipments) {
    const { count } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', s.id);

    if (count && count > MEGA_THRESHOLD) {
      megaShipments.push({ id: s.id, booking_number: s.booking_number, mbl_number: s.mbl_number, count });
    }
  }

  megaShipments.sort((a, b) => b.count - a.count);
  console.log(`Found ${megaShipments.length} mega-shipments:\n`);

  for (const ms of megaShipments) {
    console.log(`  ${ms.booking_number}: ${ms.count} chronicles`);
  }

  if (megaShipments.length === 0) {
    console.log('No mega-shipments found. System is clean.');
    return;
  }

  // Process each
  let totalUnlinked = 0;
  let totalBookingFixed = 0;
  let totalRelinkedSame = 0;
  let totalRelinkedDifferent = 0;
  let totalRemainedUnlinked = 0;
  let shipmentsTouched = 0;

  for (const ms of megaShipments) {
    console.log(`\n--- ${ms.booking_number} (${ms.count} chronicles) ---`);
    const r = await fixShipment(ms.id, ms.booking_number, ms.mbl_number);

    if (r.unlinked === 0) {
      console.log('  No conflicting thread-linked records.');
      continue;
    }

    shipmentsTouched++;
    console.log(`  Unlinked: ${r.unlinked}, booking fixed: ${r.bookingFixed}`);
    console.log(`  Re-linked same: ${r.relinkedSame}, different: ${r.relinkedDifferent}, unlinked: ${r.remainedUnlinked}`);

    totalUnlinked += r.unlinked;
    totalBookingFixed += r.bookingFixed;
    totalRelinkedSame += r.relinkedSame;
    totalRelinkedDifferent += r.relinkedDifferent;
    totalRemainedUnlinked += r.remainedUnlinked;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SYSTEM-WIDE RESULTS');
  console.log('='.repeat(60));
  console.log(`Mega-shipments scanned: ${megaShipments.length}`);
  console.log(`Mega-shipments with conflicts: ${shipmentsTouched}`);
  console.log(`Total conflicting records unlinked: ${totalUnlinked}`);
  console.log(`  Booking numbers corrected: ${totalBookingFixed}`);
  console.log(`  Re-linked to same shipment: ${totalRelinkedSame}`);
  console.log(`  Re-linked to different shipment: ${totalRelinkedDifferent}`);
  console.log(`  Remained unlinked: ${totalRemainedUnlinked}`);

  // Verify
  console.log('\nVerification — remaining mega-shipments:');
  let remainingCount = 0;
  for (const ms of megaShipments) {
    const { count } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', ms.id);
    if (count && count > MEGA_THRESHOLD) {
      console.log(`  ${ms.booking_number}: ${count} (was ${ms.count})`);
      remainingCount++;
    }
  }
  if (remainingCount === 0) {
    console.log('  None! All shipments are now under threshold.');
  }
}

fixAllMegaShipments().catch(console.error);
