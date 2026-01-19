/**
 * Investigate Document Linking Gaps (Concise Version)
 *
 * Focused analysis on:
 * 1. Container linking gap
 * 2. No-identifier documents
 * 3. No-matching shipment documents
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 1000;

async function fetchAll<T = any>(
  table: string,
  select: string = '*'
): Promise<T[]> {
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

interface Shipment {
  id: string;
  booking_number: string | null;
  mbl_number: string | null;
  hbl_number: string | null;
  container_number_primary: string | null;
  container_numbers: string[] | null;
}

interface Entity {
  email_id: string;
  entity_type: string;
  entity_value: string;
}

interface Classification {
  email_id: string;
  document_type: string;
}

interface ShipmentDocument {
  email_id: string;
  shipment_id: string;
}

async function main() {
  console.log('========================================================================');
  console.log('              DOCUMENT LINKING GAP INVESTIGATION');
  console.log('========================================================================');
  console.log('');

  // Fetch all data
  console.log('Fetching data...');
  const [shipments, allEntities, classifications, linkedDocs] = await Promise.all([
    fetchAll<Shipment>('shipments', 'id,booking_number,mbl_number,hbl_number,container_number_primary,container_numbers'),
    fetchAll<Entity>('entity_extractions', 'email_id,entity_type,entity_value'),
    fetchAll<Classification>('document_classifications', 'email_id,document_type'),
    fetchAll<ShipmentDocument>('shipment_documents', 'email_id,shipment_id'),
  ]);

  console.log(`  Shipments: ${shipments.length}`);
  console.log(`  Classifications: ${classifications.length}`);
  console.log(`  Entities: ${allEntities.length}`);
  console.log(`  Linked docs: ${linkedDocs.length}`);
  console.log('');

  // Build lookup maps
  const linkedEmailIds = new Set(linkedDocs.map(d => d.email_id));

  const entitiesByEmail = new Map<string, Entity[]>();
  for (const e of allEntities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push(e);
    entitiesByEmail.set(e.email_id, existing);
  }

  const shipmentByBooking = new Map<string, Shipment>();
  const shipmentByMbl = new Map<string, Shipment>();
  const shipmentByHbl = new Map<string, Shipment>();
  const shipmentByContainer = new Map<string, Shipment>();

  for (const s of shipments) {
    if (s.booking_number) shipmentByBooking.set(s.booking_number.toUpperCase(), s);
    if (s.mbl_number) shipmentByMbl.set(s.mbl_number.toUpperCase(), s);
    if (s.hbl_number) shipmentByHbl.set(s.hbl_number.toUpperCase(), s);
    if (s.container_number_primary) {
      shipmentByContainer.set(s.container_number_primary.toUpperCase(), s);
    }
    if (s.container_numbers) {
      for (const c of s.container_numbers) {
        if (c) shipmentByContainer.set(c.toUpperCase(), s);
      }
    }
  }

  // ============================================================================
  // 1. CONTAINER DATA ANALYSIS
  // ============================================================================
  console.log('------------------------------------------------------------------------');
  console.log('1. CONTAINER DATA ANALYSIS');
  console.log('------------------------------------------------------------------------');

  let shipmentsWithContainer = 0;
  for (const s of shipments) {
    if (s.container_number_primary || (s.container_numbers && s.container_numbers.length > 0)) {
      shipmentsWithContainer++;
    }
  }

  const containerEntities = allEntities.filter(e => e.entity_type === 'container_number');
  const uniqueDocContainers = new Set(containerEntities.map(e => e.entity_value.toUpperCase()));

  console.log(`  Shipments with containers: ${shipmentsWithContainer} / ${shipments.length}`);
  console.log(`  Unique containers on shipments: ${shipmentByContainer.size}`);
  console.log(`  Documents with container entities: ${containerEntities.length}`);
  console.log(`  Unique container values in docs: ${uniqueDocContainers.size}`);
  console.log('');

  // ============================================================================
  // 2. UNLINKED DOCUMENT ANALYSIS
  // ============================================================================
  console.log('------------------------------------------------------------------------');
  console.log('2. UNLINKED DOCUMENT ANALYSIS');
  console.log('------------------------------------------------------------------------');

  const stats = {
    noIdentifiers: 0,
    noMatchBooking: 0,
    noMatchBl: 0,
    noMatchContainer: 0,
    couldLinkViaContainer: 0,
    hasMatchButUnlinked: 0,
  };

  const noIdByDocType: Record<string, number> = {};
  const noMatchByDocType: Record<string, number> = {};
  const containerLinkableByDocType: Record<string, number> = {};
  const couldLinkSamples: { emailId: string; docType: string; container: string; shipmentBooking: string }[] = [];

  for (const c of classifications) {
    if (linkedEmailIds.has(c.email_id)) continue; // Already linked

    const entities = entitiesByEmail.get(c.email_id) || [];
    const bookings = entities.filter(e => e.entity_type === 'booking_number').map(e => e.entity_value.toUpperCase());
    const bls = entities.filter(e => ['bl_number', 'mbl_number'].includes(e.entity_type)).map(e => e.entity_value.toUpperCase());
    const hbls = entities.filter(e => e.entity_type === 'hbl_number').map(e => e.entity_value.toUpperCase());
    const containers = entities.filter(e => e.entity_type === 'container_number').map(e => e.entity_value.toUpperCase());

    // No identifiers at all?
    if (bookings.length === 0 && bls.length === 0 && hbls.length === 0 && containers.length === 0) {
      stats.noIdentifiers++;
      noIdByDocType[c.document_type] = (noIdByDocType[c.document_type] || 0) + 1;
      continue;
    }

    // Check if has match
    let hasBookingMatch = bookings.some(b => shipmentByBooking.has(b));
    let hasBlMatch = bls.some(b => shipmentByMbl.has(b));
    let hasHblMatch = hbls.some(h => shipmentByHbl.has(h));
    let hasContainerMatch = containers.some(c => shipmentByContainer.has(c));

    if (hasBookingMatch || hasBlMatch || hasHblMatch) {
      // Has a match via booking/BL but isn't linked - this is the bug in backfill script
      stats.hasMatchButUnlinked++;
      continue;
    }

    if (hasContainerMatch && !hasBookingMatch && !hasBlMatch && !hasHblMatch) {
      // ONLY has container match - this is the gap we're investigating
      stats.couldLinkViaContainer++;
      containerLinkableByDocType[c.document_type] = (containerLinkableByDocType[c.document_type] || 0) + 1;

      if (couldLinkSamples.length < 10) {
        const container = containers.find(c => shipmentByContainer.has(c))!;
        const shipment = shipmentByContainer.get(container)!;
        couldLinkSamples.push({
          emailId: c.email_id,
          docType: c.document_type,
          container,
          shipmentBooking: shipment.booking_number || shipment.id,
        });
      }
      continue;
    }

    // Has identifiers but no matching shipment
    if (bookings.length > 0) stats.noMatchBooking++;
    if (bls.length > 0) stats.noMatchBl++;
    if (containers.length > 0) stats.noMatchContainer++;
    noMatchByDocType[c.document_type] = (noMatchByDocType[c.document_type] || 0) + 1;
  }

  console.log('  Unlinked breakdown:');
  console.log(`    No identifiers at all: ${stats.noIdentifiers}`);
  console.log(`    Has booking/BL match but unlinked: ${stats.hasMatchButUnlinked}`);
  console.log(`    Could link via container ONLY: ${stats.couldLinkViaContainer}`);
  console.log(`    Has identifiers, no shipment match: ${stats.noMatchBooking + stats.noMatchBl + stats.noMatchContainer}`);
  console.log('');

  console.log('  Documents with NO identifiers by type:');
  for (const [type, count] of Object.entries(noIdByDocType).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${type.padEnd(35)} ${count}`);
  }
  console.log('');

  console.log('  Documents linkable via container by type:');
  for (const [type, count] of Object.entries(containerLinkableByDocType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(35)} ${count}`);
  }
  console.log('');

  console.log('  Documents with identifiers but NO matching shipment:');
  for (const [type, count] of Object.entries(noMatchByDocType).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${type.padEnd(35)} ${count}`);
  }
  console.log('');

  // ============================================================================
  // 3. SAMPLE CONTAINER-LINKABLE DOCUMENTS
  // ============================================================================
  console.log('------------------------------------------------------------------------');
  console.log('3. SAMPLE DOCUMENTS THAT COULD BE LINKED VIA CONTAINER');
  console.log('------------------------------------------------------------------------');

  if (couldLinkSamples.length > 0) {
    const sampleIds = couldLinkSamples.map(s => s.emailId);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id,subject,sender_email')
      .in('id', sampleIds);

    for (const sample of couldLinkSamples) {
      const email = emails?.find(e => e.id === sample.emailId);
      console.log(`  Type: ${sample.docType}`);
      console.log(`  Subject: ${email?.subject?.substring(0, 60) || 'N/A'}...`);
      console.log(`  From: ${email?.sender_email}`);
      console.log(`  Container: ${sample.container}`);
      console.log(`  -> Would link to: ${sample.shipmentBooking}`);
      console.log('');
    }
  }

  // ============================================================================
  // 4. ROOT CAUSE AND FIX
  // ============================================================================
  console.log('========================================================================');
  console.log('4. ROOT CAUSE AND RECOMMENDED FIX');
  console.log('========================================================================');
  console.log('');

  console.log('ROOT CAUSE:');
  console.log('  backfill-document-links.ts findShipment() function (line 122-144)');
  console.log('  ONLY checks: booking_number, mbl_number, bl_number, hbl_number');
  console.log('  MISSING: container_number matching');
  console.log('');

  console.log('FIX REQUIRED:');
  console.log('  Add container_number matching to findShipment():');
  console.log('');
  console.log('  case "container_number":');
  console.log('    if (shipmentByContainer.has(value)) return shipmentByContainer.get(value)!;');
  console.log('    break;');
  console.log('');

  console.log('IMPACT:');
  console.log(`  ${stats.couldLinkViaContainer} documents would be linked`);
  console.log('');

  console.log('OTHER GAPS:');
  console.log(`  ${stats.noIdentifiers} documents have NO identifiers - check extraction quality`);
  console.log(`  ${stats.hasMatchButUnlinked} documents have matches but weren't linked - re-run backfill`);
}

main().catch(console.error);
