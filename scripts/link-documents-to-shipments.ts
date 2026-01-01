/**
 * Link documents to shipments based on extracted identifiers
 *
 * This script finds emails with booking numbers that should be linked to shipments
 * but aren't yet, and creates the link.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Pagination helper
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
  console.log('LINKING DOCUMENTS TO SHIPMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Get all shipments with their booking numbers
  console.log('\n1. Fetching shipments...');
  const shipments = await fetchAll<{ id: string; booking_number: string; container_number_primary: string | null; mbl_number: string | null }>(
    'shipments', 'id, booking_number, container_number_primary, mbl_number'
  );
  console.log('   Total shipments:', shipments.length);

  // Build lookup maps
  const shipmentByBooking = new Map<string, string>();
  const shipmentByContainer = new Map<string, string>();
  const shipmentByMbl = new Map<string, string>();

  for (const s of shipments) {
    if (s.booking_number) shipmentByBooking.set(s.booking_number, s.id);
    if (s.container_number_primary) shipmentByContainer.set(s.container_number_primary, s.id);
    if (s.mbl_number) shipmentByMbl.set(s.mbl_number, s.id);
  }

  // 2. Get all email-to-shipment links
  console.log('\n2. Fetching existing links...');
  const existingLinks = await fetchAll<{ email_id: string }>(
    'shipment_documents', 'email_id'
  );
  const linkedEmailIds = new Set(existingLinks.map(l => l.email_id).filter(Boolean));
  console.log('   Existing links:', linkedEmailIds.size);

  // 3. Get all entity extractions (booking, container, mbl)
  console.log('\n3. Fetching entity extractions...');
  const bookingExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'booking_number' }
  );
  const containerExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'container_number' }
  );
  const mblExtractions = await fetchAll<{ email_id: string; entity_value: string }>(
    'entity_extractions', 'email_id, entity_value', { column: 'entity_type', value: 'mbl_number' }
  );

  console.log('   Booking extractions:', bookingExtractions.length);
  console.log('   Container extractions:', containerExtractions.length);
  console.log('   MBL extractions:', mblExtractions.length);

  // 4. Get document classifications for document types
  console.log('\n4. Fetching classifications...');
  const classifications = await fetchAll<{ email_id: string; document_type: string }>(
    'document_classifications', 'email_id, document_type'
  );
  const docTypeByEmail = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // 5. Find emails that should be linked
  console.log('\n5. Finding emails to link...');

  const toLink: { emailId: string; shipmentId: string; documentType: string; matchType: string }[] = [];

  // Check booking number matches
  for (const e of bookingExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;

    const shipmentId = shipmentByBooking.get(e.entity_value);
    if (shipmentId) {
      const docType = docTypeByEmail.get(e.email_id) || 'other';
      toLink.push({ emailId: e.email_id, shipmentId, documentType: docType, matchType: 'booking' });
      linkedEmailIds.add(e.email_id); // Prevent duplicate processing
    }
  }

  // Check container number matches (fallback)
  for (const e of containerExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;

    const shipmentId = shipmentByContainer.get(e.entity_value);
    if (shipmentId) {
      const docType = docTypeByEmail.get(e.email_id) || 'other';
      toLink.push({ emailId: e.email_id, shipmentId, documentType: docType, matchType: 'container' });
      linkedEmailIds.add(e.email_id);
    }
  }

  // Check MBL matches (fallback)
  for (const e of mblExtractions) {
    if (linkedEmailIds.has(e.email_id)) continue;

    const shipmentId = shipmentByMbl.get(e.entity_value);
    if (shipmentId) {
      const docType = docTypeByEmail.get(e.email_id) || 'other';
      toLink.push({ emailId: e.email_id, shipmentId, documentType: docType, matchType: 'mbl' });
      linkedEmailIds.add(e.email_id);
    }
  }

  console.log('   Emails to link:', toLink.length);

  // Group by match type
  const byMatchType = new Map<string, number>();
  for (const l of toLink) {
    byMatchType.set(l.matchType, (byMatchType.get(l.matchType) || 0) + 1);
  }
  console.log('   By match type:');
  [...byMatchType.entries()].forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });

  // Group by document type
  const byDocType = new Map<string, number>();
  for (const l of toLink) {
    byDocType.set(l.documentType, (byDocType.get(l.documentType) || 0) + 1);
  }
  console.log('   By document type:');
  [...byDocType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });

  // 6. Insert links
  if (toLink.length > 0) {
    console.log('\n6. INSERTING LINKS...');

    let inserted = 0;
    let errors = 0;

    const batchSize = 50;
    for (let i = 0; i < toLink.length; i += batchSize) {
      const batch = toLink.slice(i, i + batchSize).map(l => ({
        email_id: l.emailId,
        shipment_id: l.shipmentId,
        document_type: l.documentType,
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('shipment_documents')
        .insert(batch);

      if (error) {
        errors++;
        if (errors <= 3) {
          console.error('   Error:', error.message);
        }
      } else {
        inserted += batch.length;
      }

      if ((i + batchSize) % 200 === 0) {
        console.log(`   Inserted ${inserted} / ${toLink.length}`);
      }
    }

    console.log('\n   Total inserted:', inserted);
    if (errors > 0) console.log('   Batches with errors:', errors);
  }

  // 7. Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const { count: finalCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  console.log('\n   Documents linked before:', existingLinks.length);
  console.log('   Documents linked after:', finalCount);
  console.log('   New links created:', toLink.length);
}

main().catch(console.error);
