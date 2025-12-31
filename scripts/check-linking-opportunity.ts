#!/usr/bin/env npx tsx
/**
 * Check if unlinked emails can be linked to existing shipments
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkLinkingStatus() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('EMAIL → SHIPMENT LINKING STATUS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Total counts
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const { count: totalShipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });

  // Linked emails
  const linkedEmailIds = new Set<string>();
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('shipment_documents').select('email_id').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    data.forEach(l => linkedEmailIds.add(l.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log('CURRENT STATUS:');
  console.log('─'.repeat(60));
  console.log(`  Total emails:     ${totalEmails}`);
  console.log(`  Total shipments:  ${totalShipments}`);
  console.log(`  Emails linked:    ${linkedEmailIds.size} (${Math.round(linkedEmailIds.size/(totalEmails||1)*100)}%)`);
  console.log(`  Emails unlinked:  ${(totalEmails||0) - linkedEmailIds.size} (${Math.round(((totalEmails||0) - linkedEmailIds.size)/(totalEmails||1)*100)}%)`);
  console.log('');

  // Get all classifications
  const allClassifications: { email_id: string; document_type: string }[] = [];
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allClassifications.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const unlinkedByType: Record<string, number> = {};
  const linkedByType: Record<string, number> = {};

  for (const c of allClassifications) {
    if (linkedEmailIds.has(c.email_id)) {
      linkedByType[c.document_type] = (linkedByType[c.document_type] || 0) + 1;
    } else {
      unlinkedByType[c.document_type] = (unlinkedByType[c.document_type] || 0) + 1;
    }
  }

  console.log('UNLINKED EMAILS BY DOCUMENT TYPE (Top 15):');
  console.log('─'.repeat(60));
  console.log('  TYPE                           COUNT   % OF TYPE');
  console.log('  ' + '─'.repeat(55));

  for (const [type, unlinkedCount] of Object.entries(unlinkedByType).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const linkedCount = linkedByType[type] || 0;
    const total = unlinkedCount + linkedCount;
    const pct = Math.round(unlinkedCount / total * 100);
    console.log(`  ${type.padEnd(30)}${String(unlinkedCount).padStart(5)}   ${pct}% unlinked`);
  }

  // Check if unlinked emails have booking numbers that match shipments
  console.log('');
  console.log('');
  console.log('CAN THESE UNLINKED EMAILS BE LINKED?');
  console.log('─'.repeat(60));

  // Get all booking numbers from shipments
  const { data: shipments } = await supabase.from('shipments').select('id, booking_number');
  const bookingToShipment = new Map<string, string>();
  for (const s of shipments || []) {
    if (s.booking_number) bookingToShipment.set(s.booking_number, s.id);
  }

  // Get unlinked email IDs
  const unlinkedEmailIds: string[] = [];
  for (const c of allClassifications) {
    if (!linkedEmailIds.has(c.email_id)) {
      unlinkedEmailIds.push(c.email_id);
    }
  }

  // Check first 500 unlinked emails
  let canLink = 0;
  let noBookingNumber = 0;
  let bookingNotFound = 0;

  for (const emailId of unlinkedEmailIds.slice(0, 500)) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_value')
      .eq('email_id', emailId)
      .eq('entity_type', 'booking_number')
      .limit(1);

    if (!entities || entities.length === 0) {
      noBookingNumber++;
    } else {
      const booking = entities[0].entity_value;
      if (bookingToShipment.has(booking)) {
        canLink++;
      } else {
        bookingNotFound++;
      }
    }
  }

  console.log(`  Sampled ${Math.min(500, unlinkedEmailIds.length)} unlinked emails:`);
  console.log('');
  console.log(`  CAN be linked (booking matches shipment):  ${canLink}`);
  console.log(`  NO booking number extracted:               ${noBookingNumber}`);
  console.log(`  Booking number but NO matching shipment:   ${bookingNotFound}`);
  console.log('');

  if (canLink > 0) {
    const estimatedTotal = Math.round(canLink / 500 * unlinkedEmailIds.length);
    console.log(`  → Estimated ${estimatedTotal} emails CAN be linked to existing shipments`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

checkLinkingStatus().catch(console.error);
