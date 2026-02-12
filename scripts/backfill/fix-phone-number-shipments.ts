/**
 * Fix Phone-Number Shipments
 *
 * ROOT CAUSE: The regex \b(\d{9,10})\b in extractBookingNumber() matches
 * Indian phone numbers in email signatures (e.g., "Ph: +91 8810432530").
 * This creates fake shipments with phone numbers as booking numbers,
 * then thread-linking cascades contaminates hundreds of chronicles.
 *
 * STRATEGY:
 * 1. Find all shipments where booking_number is a phone number from signatures
 * 2. Unlink ALL chronicles from these fake shipments
 * 3. Fix the stored booking_number on each chronicle (re-extract from content,
 *    stripping phone numbers)
 * 4. Re-link via RPC (which now has conflict detection)
 * 5. Delete the fake shipments if they have 0 remaining chronicles
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env') });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/** Phone pattern that precedes a digit sequence in email signatures */
const PHONE_PRECEDING = /(?:Ph|Mobile|Tel|Phone|Call|Fax|Mob)[^a-zA-Z]{0,5}\+?\d{0,3}\s*$/i;

/** Extract booking number, skipping phone numbers in signatures */
function extractBookingClean(subject: string, body: string): string | null {
  const text = (subject || '') + ' ' + (body || '');
  const patterns: RegExp[] = [
    /BKG[#:\s]*([A-Z0-9]{8,20})/i,
    /BOOKING[#:\s]*([A-Z0-9]{8,20})/i,
    /\b(\d{9,10})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || match.index === undefined) continue;
    // For bare digit patterns, check if preceded by phone label
    if (pattern.source === '\\b(\\d{9,10})\\b') {
      const preceding = text.substring(Math.max(0, match.index - 30), match.index);
      if (PHONE_PRECEDING.test(preceding)) continue;
    }
    return match[1];
  }
  return null;
}

async function run(): Promise<void> {
  console.log('='.repeat(60));
  console.log('FIX PHONE-NUMBER SHIPMENTS');
  console.log('='.repeat(60));

  // Step 1: Find phone-number shipments
  console.log('\nStep 1: Finding phone-number shipments...');

  // Get all 10-digit-only booking shipments that have phone matches in chronicle bodies
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, mbl_number, carrier_name');

  if (!allShipments) {
    console.error('Failed to fetch shipments');
    return;
  }

  const digitOnly = allShipments.filter(s => s.booking_number && /^\d{10}$/.test(s.booking_number));
  console.log(`  10-digit booking shipments: ${digitOnly.length}`);

  // Check which ones are phone numbers by sampling chronicle bodies
  const phoneShipments: typeof digitOnly = [];
  for (const s of digitOnly) {
    const { data: samples } = await supabase
      .from('chronicle')
      .select('body_preview')
      .eq('shipment_id', s.id)
      .or(`body_preview.like.%Ph%${s.booking_number}%,body_preview.like.%Mobile%${s.booking_number}%`)
      .limit(1);

    if (samples && samples.length > 0) {
      phoneShipments.push(s);
    }
  }

  console.log(`  Confirmed phone-number shipments: ${phoneShipments.length}`);

  if (phoneShipments.length === 0) {
    console.log('No phone-number shipments found.');
    return;
  }

  for (const s of phoneShipments) {
    console.log(`    ${s.booking_number} (${s.carrier_name || 'no carrier'})`);
  }

  // Step 2: Process each phone-number shipment
  let totalUnlinked = 0;
  let totalBookingFixed = 0;
  let totalRelinked = 0;
  let totalOrphaned = 0;
  let shipmentsDeleted = 0;

  for (const shipment of phoneShipments) {
    console.log(`\n--- Processing ${shipment.booking_number} ---`);

    // Fetch all chronicles linked to this shipment
    const { data: chronicles } = await supabase
      .from('chronicle')
      .select('id, booking_number, subject, body_preview, linked_by')
      .eq('shipment_id', shipment.id);

    if (!chronicles || chronicles.length === 0) {
      console.log('  No chronicles linked.');
      continue;
    }

    console.log(`  Chronicles linked: ${chronicles.length}`);

    // Unlink ALL chronicles from this fake shipment
    const ids = chronicles.map(c => c.id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await supabase
        .from('chronicle')
        .update({ shipment_id: null, linked_by: null, linked_at: null })
        .in('id', batch);
    }
    totalUnlinked += ids.length;
    console.log(`  Unlinked: ${ids.length}`);

    // Fix stored booking_number on each chronicle
    let fixed = 0;
    for (const c of chronicles) {
      // Only fix if the stored booking IS the phone number
      if (c.booking_number === shipment.booking_number) {
        const cleanBooking = extractBookingClean(c.subject || '', c.body_preview || '');
        const newBooking = cleanBooking === shipment.booking_number ? null : cleanBooking;
        await supabase
          .from('chronicle')
          .update({ booking_number: newBooking })
          .eq('id', c.id);
        fixed++;
      }
    }
    totalBookingFixed += fixed;
    console.log(`  Booking numbers cleaned: ${fixed}`);

    // Re-link via RPC
    let relinked = 0;
    let orphaned = 0;
    for (const id of ids) {
      const { data: result } = await supabase.rpc(
        'link_chronicle_to_shipment',
        { chronicle_id: id }
      );
      if (result && result.length > 0) {
        relinked++;
      } else {
        orphaned++;
      }
    }
    totalRelinked += relinked;
    totalOrphaned += orphaned;
    console.log(`  Re-linked: ${relinked}, orphaned: ${orphaned}`);

    // Check if shipment still has any chronicles
    const { count } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', shipment.id);

    if (!count || count === 0) {
      // Delete the fake shipment
      const { error: delErr } = await supabase
        .from('shipments')
        .delete()
        .eq('id', shipment.id);
      if (!delErr) {
        shipmentsDeleted++;
        console.log(`  DELETED fake shipment ${shipment.booking_number}`);
      } else {
        console.log(`  Could not delete shipment: ${delErr.message}`);
      }
    } else {
      console.log(`  Shipment retained: ${count} chronicles still linked`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Phone-number shipments processed: ${phoneShipments.length}`);
  console.log(`Fake shipments deleted: ${shipmentsDeleted}`);
  console.log(`Total chronicles unlinked: ${totalUnlinked}`);
  console.log(`Booking numbers cleaned: ${totalBookingFixed}`);
  console.log(`Re-linked to correct shipment: ${totalRelinked}`);
  console.log(`Remained orphaned: ${totalOrphaned}`);
}

run().catch(console.error);
