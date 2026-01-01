import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Helper to fetch all rows with pagination
async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; value: any }
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + limit - 1);
    if (filter) {
      query = query.eq(filter.column, filter.value);
    }
    const { data, error } = await query;

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));
    offset += limit;

    if (data.length < limit) break;
  }

  return all;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('FULL DOCUMENT ANALYSIS (WITH PAGINATION)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Fetch ALL data
  console.log('\nFetching all data...');

  const classifications = await fetchAll<{ email_id: string; document_type: string; confidence_score: number }>(
    'document_classifications',
    'email_id, document_type, confidence_score'
  );
  console.log('  Classifications: ' + classifications.length);

  const linkedDocs = await fetchAll<{ email_id: string; shipment_id: string; document_type: string }>(
    'shipment_documents',
    'email_id, shipment_id, document_type'
  );
  console.log('  Linked documents: ' + linkedDocs.length);

  const bookingExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions',
    'email_id, entity_value',
    { column: 'entity_type', value: 'booking_number' }
  );
  console.log('  Booking extractions: ' + bookingExtractions.length);

  const shipments = await fetchAll<{ id: string; booking_number: string }>(
    'shipments',
    'id, booking_number'
  );
  console.log('  Shipments: ' + shipments.length);

  // Build lookup maps
  const linkedEmailIds = new Set(linkedDocs.filter(d => d.email_id).map(d => d.email_id));
  const shipmentByBooking = new Map(shipments.map(s => [s.booking_number, s.id]));
  const bookingByEmail = new Map(bookingExtractions.map(e => [e.email_id, e.entity_value]));

  // Analyze by document type
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('DOCUMENT TYPE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const stats = new Map<string, {
    total: number;
    highConf: number;
    linked: number;
    hasBooking: number;
    bookingMatchesShipment: number;
  }>();

  for (const c of classifications) {
    const s = stats.get(c.document_type) || {
      total: 0, highConf: 0, linked: 0, hasBooking: 0, bookingMatchesShipment: 0
    };

    s.total++;
    if (c.confidence_score >= 70) s.highConf++;
    if (linkedEmailIds.has(c.email_id)) s.linked++;

    const booking = bookingByEmail.get(c.email_id);
    if (booking) {
      s.hasBooking++;
      if (shipmentByBooking.has(booking)) {
        s.bookingMatchesShipment++;
      }
    }

    stats.set(c.document_type, s);
  }

  console.log('\n Document Type                Total  Hi-Conf  Linked  HasBkg  Matches  SHOULD LINK');
  console.log('─'.repeat(90));

  const sorted = [...stats.entries()].sort((a, b) => b[1].total - a[1].total);
  let totalShouldLink = 0;

  for (const [type, s] of sorted) {
    // "Should link" = has booking that matches shipment BUT not linked
    const shouldLink = s.bookingMatchesShipment - s.linked;
    if (shouldLink > 0) totalShouldLink += shouldLink;

    console.log(' ' + type.padEnd(28) +
                s.total.toString().padStart(5) +
                s.highConf.toString().padStart(8) +
                s.linked.toString().padStart(8) +
                s.hasBooking.toString().padStart(8) +
                s.bookingMatchesShipment.toString().padStart(8) +
                (shouldLink > 0 ? shouldLink.toString().padStart(12) + ' ⚠️' : '           0'));
  }

  console.log('─'.repeat(90));
  console.log(' TOTAL'.padEnd(28) +
              classifications.length.toString().padStart(5) +
              [...stats.values()].reduce((a, b) => a + b.highConf, 0).toString().padStart(8) +
              linkedDocs.length.toString().padStart(8) +
              ''.padStart(8) +
              ''.padStart(8) +
              totalShouldLink.toString().padStart(12) + ' ⚠️');

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('\n   Total Classifications: ' + classifications.length);
  console.log('   Currently Linked: ' + linkedDocs.length);
  console.log('   SHOULD BE LINKED: ' + totalShouldLink + ' (have booking # matching a shipment)');

  // Find specific documents to link
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('DOCUMENTS THAT SHOULD BE LINKED');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const toLink: { emailId: string; booking: string; docType: string; shipmentId: string }[] = [];

  for (const c of classifications) {
    if (linkedEmailIds.has(c.email_id)) continue;

    const booking = bookingByEmail.get(c.email_id);
    if (!booking) continue;

    const shipmentId = shipmentByBooking.get(booking);
    if (!shipmentId) continue;

    toLink.push({
      emailId: c.email_id,
      booking,
      docType: c.document_type,
      shipmentId
    });
  }

  console.log('\n   Found ' + toLink.length + ' documents to link');

  // Group by document type
  const byType = new Map<string, number>();
  for (const item of toLink) {
    byType.set(item.docType, (byType.get(item.docType) || 0) + 1);
  }

  console.log('\n   Breakdown by type:');
  [...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log('   - ' + type + ': ' + count);
  });

  // Sample
  console.log('\n   Sample documents to link:');
  for (const item of toLink.slice(0, 10)) {
    console.log('   - ' + item.booking + ' | ' + item.docType);
  }
}

main().catch(console.error);
