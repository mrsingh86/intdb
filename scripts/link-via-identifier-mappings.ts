/**
 * Link documents using identifier_mappings table
 *
 * For emails that have container/BL/MBL but NO booking:
 * 1. Look up the identifier in identifier_mappings
 * 2. Get the associated booking_number
 * 3. Find shipment by booking_number
 * 4. Link the email to that shipment
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; value: any }
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('LINKING VIA IDENTIFIER MAPPINGS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Get all shipments
  console.log('\n1. Loading shipments...');
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  const shipmentByBooking = new Map(shipments?.map(s => [s.booking_number, s.id]) || []);
  console.log(`   Shipments: ${shipments?.length}`);

  // 2. Get existing links
  console.log('\n2. Loading existing links...');
  const existingLinks = await fetchAll<{ email_id: string }>(
    'shipment_documents', 'email_id'
  );
  const linkedEmailIds = new Set(existingLinks.map(l => l.email_id).filter(Boolean));
  console.log(`   Existing links: ${linkedEmailIds.size}`);

  // 3. Get identifier mappings
  console.log('\n3. Loading identifier mappings...');
  const { data: mappings } = await supabase
    .from('identifier_mappings')
    .select('booking_number, container_number, bl_number, mbl_number, hbl_number');

  // Build reverse lookup maps: identifier → booking_number
  const bookingByContainer = new Map<string, string>();
  const bookingByBl = new Map<string, string>();
  const bookingByMbl = new Map<string, string>();
  const bookingByHbl = new Map<string, string>();

  for (const m of mappings || []) {
    if (m.container_number && m.booking_number) {
      bookingByContainer.set(m.container_number, m.booking_number);
    }
    if (m.bl_number && m.booking_number) {
      bookingByBl.set(m.bl_number, m.booking_number);
    }
    if (m.mbl_number && m.booking_number) {
      bookingByMbl.set(m.mbl_number, m.booking_number);
    }
    if (m.hbl_number && m.booking_number) {
      bookingByHbl.set(m.hbl_number, m.booking_number);
    }
  }

  console.log(`   Container → Booking mappings: ${bookingByContainer.size}`);
  console.log(`   BL → Booking mappings: ${bookingByBl.size}`);
  console.log(`   MBL → Booking mappings: ${bookingByMbl.size}`);
  console.log(`   HBL → Booking mappings: ${bookingByHbl.size}`);

  // 4. Find emails with secondary identifiers but NO booking
  console.log('\n4. Finding emails with secondary identifiers only...');

  // Get all emails with booking extractions
  const bookingExtractions = await fetchAll<{ email_id: string }>(
    'entity_extractions', 'email_id', { column: 'entity_type', value: 'booking_number' }
  );
  const emailsWithBooking = new Set(bookingExtractions.map(e => e.email_id));

  // Get emails with secondary identifiers
  const containerExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'container_number' }
  );
  const blExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'bl_number' }
  );
  const mblExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'mbl_number' }
  );
  const hblExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'hbl_number' }
  );

  // 5. Try to link via mappings
  console.log('\n5. Attempting to link via mappings...');

  const toLink: { emailId: string; shipmentId: string; matchType: string; matchValue: string }[] = [];

  // Get document types
  const classifications = await fetchAll<{ email_id: string; document_type: string }>(
    'document_classifications', 'email_id, document_type'
  );
  const docTypeByEmail = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // Try container → booking → shipment
  for (const e of containerExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;
    if (emailsWithBooking.has(e.email_id)) continue; // Already has booking, should be linked directly

    const booking = bookingByContainer.get(e.entity_value);
    if (!booking) continue;

    const shipmentId = shipmentByBooking.get(booking);
    if (!shipmentId) continue;

    toLink.push({ emailId: e.email_id, shipmentId, matchType: 'container→booking', matchValue: e.entity_value });
    linkedEmailIds.add(e.email_id);
  }

  // Try BL → booking → shipment
  for (const e of blExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;
    if (emailsWithBooking.has(e.email_id)) continue;

    const booking = bookingByBl.get(e.entity_value);
    if (!booking) continue;

    const shipmentId = shipmentByBooking.get(booking);
    if (!shipmentId) continue;

    toLink.push({ emailId: e.email_id, shipmentId, matchType: 'bl→booking', matchValue: e.entity_value });
    linkedEmailIds.add(e.email_id);
  }

  // Try MBL → booking → shipment
  for (const e of mblExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;
    if (emailsWithBooking.has(e.email_id)) continue;

    const booking = bookingByMbl.get(e.entity_value);
    if (!booking) continue;

    const shipmentId = shipmentByBooking.get(booking);
    if (!shipmentId) continue;

    toLink.push({ emailId: e.email_id, shipmentId, matchType: 'mbl→booking', matchValue: e.entity_value });
    linkedEmailIds.add(e.email_id);
  }

  // Try HBL → booking → shipment
  for (const e of hblExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;
    if (emailsWithBooking.has(e.email_id)) continue;

    const booking = bookingByHbl.get(e.entity_value);
    if (!booking) continue;

    const shipmentId = shipmentByBooking.get(booking);
    if (!shipmentId) continue;

    toLink.push({ emailId: e.email_id, shipmentId, matchType: 'hbl→booking', matchValue: e.entity_value });
    linkedEmailIds.add(e.email_id);
  }

  console.log(`\n   Emails to link via mappings: ${toLink.length}`);

  // Group by match type
  const byMatchType = new Map<string, number>();
  for (const l of toLink) {
    byMatchType.set(l.matchType, (byMatchType.get(l.matchType) || 0) + 1);
  }
  console.log('   By match type:');
  [...byMatchType.entries()].forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });

  // 6. Insert links
  if (toLink.length > 0) {
    console.log('\n6. Inserting links...');

    let inserted = 0;
    const batchSize = 50;

    for (let i = 0; i < toLink.length; i += batchSize) {
      const batch = toLink.slice(i, i + batchSize).map(l => ({
        email_id: l.emailId,
        shipment_id: l.shipmentId,
        document_type: docTypeByEmail.get(l.emailId) || 'other',
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('shipment_documents')
        .insert(batch);

      if (!error) {
        inserted += batch.length;
      }
    }

    console.log(`   Inserted: ${inserted}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const { count: finalCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  console.log(`\n   Total documents linked: ${finalCount}`);
  console.log(`   New links via mappings: ${toLink.length}`);

  if (toLink.length > 0) {
    console.log('\n   Sample links:');
    for (const l of toLink.slice(0, 5)) {
      console.log(`   - ${l.matchType}: ${l.matchValue}`);
    }
  }
}

main().catch(console.error);
