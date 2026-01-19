/**
 * Check documents that have booking/BL matches but aren't linked
 *
 * This indicates a bug in the backfill script
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 1000;

async function fetchAll<T = any>(table: string, select: string = '*'): Promise<T[]> {
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);

    if (data && data.length > 0) {
      allData = allData.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

async function main() {
  console.log('========================================================================');
  console.log('     CHECK DOCUMENTS WITH BOOKING/BL MATCH BUT NOT LINKED');
  console.log('========================================================================');
  console.log('');

  // Fetch data
  const [shipments, allEntities, classifications, linkedDocs] = await Promise.all([
    fetchAll<{
      id: string;
      booking_number: string | null;
      mbl_number: string | null;
      hbl_number: string | null;
    }>('shipments', 'id,booking_number,mbl_number,hbl_number'),
    fetchAll<{
      email_id: string;
      entity_type: string;
      entity_value: string;
    }>('entity_extractions', 'email_id,entity_type,entity_value'),
    fetchAll<{
      email_id: string;
      document_type: string;
    }>('document_classifications', 'email_id,document_type'),
    fetchAll<{ email_id: string }>('shipment_documents', 'email_id'),
  ]);

  const linkedEmailIds = new Set(linkedDocs.map(d => d.email_id));

  // Build lookup maps
  const shipmentByBooking = new Map<string, typeof shipments[0]>();
  const shipmentByMbl = new Map<string, typeof shipments[0]>();
  const shipmentByHbl = new Map<string, typeof shipments[0]>();

  for (const s of shipments) {
    if (s.booking_number) shipmentByBooking.set(s.booking_number.toUpperCase(), s);
    if (s.mbl_number) shipmentByMbl.set(s.mbl_number.toUpperCase(), s);
    if (s.hbl_number) shipmentByHbl.set(s.hbl_number.toUpperCase(), s);
  }

  // Group entities by email
  const entitiesByEmail = new Map<string, typeof allEntities>();
  for (const e of allEntities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push(e);
    entitiesByEmail.set(e.email_id, existing);
  }

  // Find unlinked documents with matching booking/BL
  const unlinkedWithMatch: {
    emailId: string;
    docType: string;
    matchType: string;
    matchValue: string;
    shipmentBooking: string;
  }[] = [];

  for (const c of classifications) {
    if (linkedEmailIds.has(c.email_id)) continue;

    const entities = entitiesByEmail.get(c.email_id) || [];

    for (const e of entities) {
      const value = e.entity_value.toUpperCase();

      if (e.entity_type === 'booking_number' && shipmentByBooking.has(value)) {
        unlinkedWithMatch.push({
          emailId: c.email_id,
          docType: c.document_type,
          matchType: 'booking_number',
          matchValue: value,
          shipmentBooking: shipmentByBooking.get(value)!.booking_number!,
        });
        break;
      }

      if ((e.entity_type === 'bl_number' || e.entity_type === 'mbl_number') && shipmentByMbl.has(value)) {
        unlinkedWithMatch.push({
          emailId: c.email_id,
          docType: c.document_type,
          matchType: 'mbl_number',
          matchValue: value,
          shipmentBooking: shipmentByMbl.get(value)!.booking_number || value,
        });
        break;
      }

      if (e.entity_type === 'hbl_number' && shipmentByHbl.has(value)) {
        unlinkedWithMatch.push({
          emailId: c.email_id,
          docType: c.document_type,
          matchType: 'hbl_number',
          matchValue: value,
          shipmentBooking: shipmentByHbl.get(value)!.booking_number || value,
        });
        break;
      }
    }
  }

  console.log(`Found ${unlinkedWithMatch.length} documents with booking/BL match but NOT linked`);
  console.log('');

  // Group by document type
  const byDocType: Record<string, number> = {};
  for (const u of unlinkedWithMatch) {
    byDocType[u.docType] = (byDocType[u.docType] || 0) + 1;
  }

  console.log('By document type:');
  for (const [type, count] of Object.entries(byDocType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(35)} ${count}`);
  }
  console.log('');

  // Group by match type
  const byMatchType: Record<string, number> = {};
  for (const u of unlinkedWithMatch) {
    byMatchType[u.matchType] = (byMatchType[u.matchType] || 0) + 1;
  }

  console.log('By match type:');
  for (const [type, count] of Object.entries(byMatchType)) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }
  console.log('');

  // Sample
  console.log('Sample unlinked documents with matches:');
  console.log('------------------------------------------------------------------------');

  const sampleIds = unlinkedWithMatch.slice(0, 10).map(u => u.emailId);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id,subject,sender_email')
    .in('id', sampleIds);

  for (const u of unlinkedWithMatch.slice(0, 10)) {
    const email = emails?.find(e => e.id === u.emailId);
    console.log(`  Type: ${u.docType}`);
    console.log(`  Subject: ${email?.subject?.substring(0, 60) || 'N/A'}...`);
    console.log(`  Match: ${u.matchType} = ${u.matchValue}`);
    console.log(`  Should link to: ${u.shipmentBooking}`);
    console.log('');
  }

  console.log('========================================================================');
  console.log('ROOT CAUSE');
  console.log('========================================================================');
  console.log('');
  console.log('These documents SHOULD have been linked by backfill-document-links.ts');
  console.log('Possible reasons:');
  console.log('  1. Document type not in documentTypesToLink array');
  console.log('  2. Backfill ran before these documents were classified');
  console.log('  3. Case sensitivity issue');
  console.log('');
  console.log('FIX: Re-run backfill-document-links.ts or run BackfillService.backfillAll()');
}

main().catch(console.error);
