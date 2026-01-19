/**
 * Investigate Document Linking Gaps
 *
 * Deep analysis of why document linking coverage is low:
 * 1. Container number data on shipments
 * 2. Container entities in documents
 * 3. Missing identifiers analysis
 * 4. No-matching-shipment analysis
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
  select: string = '*',
  filter?: { column: string; value: any }
): Promise<T[]> {
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select);

    if (filter) {
      query = query.eq(filter.column, filter.value);
    }

    const { data, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

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
  confidence_score: number;
}

interface Classification {
  email_id: string;
  document_type: string;
  confidence_score: number;
}

interface ShipmentDocument {
  email_id: string;
  shipment_id: string;
}

interface RawEmail {
  id: string;
  subject: string;
  sender_email: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              DOCUMENT LINKING GAP INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // ============================================================================
  // 1. CHECK CONTAINER DATA ON SHIPMENTS
  // ============================================================================
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 1. CONTAINER DATA ON SHIPMENTS                                             │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  const shipments = await fetchAll<Shipment>(
    'shipments',
    'id,booking_number,mbl_number,hbl_number,container_number_primary,container_numbers'
  );

  console.log(`Total shipments: ${shipments.length}`);

  let shipmentsWithContainerPrimary = 0;
  let shipmentsWithContainerArray = 0;
  let shipmentsWithAnyContainer = 0;
  let totalContainersOnShipments = 0;
  const containerStats: Record<string, number> = {};

  for (const s of shipments) {
    const hasContainerPrimary = !!s.container_number_primary;
    const hasContainerArray = Array.isArray(s.container_numbers) && s.container_numbers.length > 0;

    if (hasContainerPrimary) shipmentsWithContainerPrimary++;
    if (hasContainerArray) {
      shipmentsWithContainerArray++;
      totalContainersOnShipments += s.container_numbers!.length;
    }
    if (hasContainerPrimary || hasContainerArray) {
      shipmentsWithAnyContainer++;
    }

    // Check container format
    const containers = [...(s.container_numbers || [])];
    if (s.container_number_primary && !containers.includes(s.container_number_primary)) {
      containers.push(s.container_number_primary);
    }

    for (const c of containers) {
      if (typeof c === 'string' && c.length > 0) {
        const len = `length_${c.length}`;
        containerStats[len] = (containerStats[len] || 0) + 1;
      }
    }
  }

  console.log(`  Shipments with container_number_primary: ${shipmentsWithContainerPrimary}`);
  console.log(`  Shipments with container_numbers array: ${shipmentsWithContainerArray}`);
  console.log(`  Shipments with ANY container: ${shipmentsWithAnyContainer}`);
  console.log(`  Total containers on shipments: ${totalContainersOnShipments}`);
  console.log(`  Container length distribution: ${JSON.stringify(containerStats)}`);
  console.log('');

  // Sample some shipments with containers
  const shipmentsWithContainers = shipments.filter(s =>
    s.container_number_primary || (s.container_numbers && s.container_numbers.length > 0)
  ).slice(0, 5);

  console.log('  Sample shipments with containers:');
  for (const s of shipmentsWithContainers) {
    console.log(`    Booking: ${s.booking_number || 'N/A'}`);
    console.log(`      Primary: ${s.container_number_primary || 'null'}`);
    console.log(`      Array: ${JSON.stringify(s.container_numbers)}`);
    console.log('');
  }

  // ============================================================================
  // 2. CHECK CONTAINER ENTITIES IN DOCUMENTS
  // ============================================================================
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 2. CONTAINER ENTITIES IN DOCUMENTS                                         │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  const allEntities = await fetchAll<Entity>(
    'entity_extractions',
    'email_id,entity_type,entity_value,confidence_score'
  );

  console.log(`Total entities: ${allEntities.length}`);

  // Group by entity type
  const entityTypeCounts: Record<string, number> = {};
  const uniqueEmails = new Set<string>();
  const containerEntities: Entity[] = [];

  for (const e of allEntities) {
    entityTypeCounts[e.entity_type] = (entityTypeCounts[e.entity_type] || 0) + 1;
    uniqueEmails.add(e.email_id);

    if (e.entity_type === 'container_number') {
      containerEntities.push(e);
    }
  }

  console.log(`  Unique emails with entities: ${uniqueEmails.size}`);
  console.log('');
  console.log('  Entity type distribution:');
  for (const [type, count] of Object.entries(entityTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(30)} ${count.toString().padStart(6)}`);
  }

  console.log('');
  console.log(`  Container entities found: ${containerEntities.length}`);

  // Get unique container values
  const uniqueContainers = new Set(containerEntities.map(e => e.entity_value.toUpperCase()));
  console.log(`  Unique container numbers: ${uniqueContainers.size}`);

  // Build shipment container lookup
  const shipmentContainerSet = new Set<string>();
  for (const s of shipments) {
    if (s.container_number_primary) {
      shipmentContainerSet.add(s.container_number_primary.toUpperCase());
    }
    if (s.container_numbers) {
      for (const c of s.container_numbers) {
        if (c) shipmentContainerSet.add(c.toUpperCase());
      }
    }
  }

  console.log(`  Unique containers on shipments: ${shipmentContainerSet.size}`);

  // Find matching containers
  let matchingContainers = 0;
  const unmatchedContainers: string[] = [];

  for (const container of uniqueContainers) {
    if (shipmentContainerSet.has(container)) {
      matchingContainers++;
    } else {
      unmatchedContainers.push(container);
    }
  }

  console.log(`  Container entities matching shipments: ${matchingContainers}`);
  console.log(`  Container entities NOT matching: ${unmatchedContainers.length}`);
  console.log('');

  // Sample unmatched containers
  console.log('  Sample unmatched containers:');
  for (const c of unmatchedContainers.slice(0, 10)) {
    console.log(`    ${c}`);
  }

  // ============================================================================
  // 3. ANALYZE ARRIVAL NOTICES SPECIFICALLY
  // ============================================================================
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 3. ARRIVAL NOTICE ANALYSIS                                                 │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  const classifications = await fetchAll<Classification>(
    'document_classifications',
    'email_id,document_type,confidence_score'
  );

  const arrivalNotices = classifications.filter(c => c.document_type === 'arrival_notice');
  console.log(`  Arrival notices: ${arrivalNotices.length}`);

  // Group entities by email
  const entitiesByEmail = new Map<string, Entity[]>();
  for (const e of allEntities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push(e);
    entitiesByEmail.set(e.email_id, existing);
  }

  let anWithBooking = 0;
  let anWithBl = 0;
  let anWithContainer = 0;
  let anWithNoIdentifiers = 0;
  let anOnlyContainer = 0;

  for (const an of arrivalNotices) {
    const entities = entitiesByEmail.get(an.email_id) || [];
    const hasBooking = entities.some(e => e.entity_type === 'booking_number');
    const hasBl = entities.some(e => ['bl_number', 'mbl_number', 'hbl_number'].includes(e.entity_type));
    const hasContainer = entities.some(e => e.entity_type === 'container_number');

    if (hasBooking) anWithBooking++;
    if (hasBl) anWithBl++;
    if (hasContainer) anWithContainer++;
    if (!hasBooking && !hasBl && !hasContainer) anWithNoIdentifiers++;
    if (hasContainer && !hasBooking && !hasBl) anOnlyContainer++;
  }

  console.log(`  With booking_number: ${anWithBooking}`);
  console.log(`  With bl_number: ${anWithBl}`);
  console.log(`  With container_number: ${anWithContainer}`);
  console.log(`  With NO identifiers: ${anWithNoIdentifiers}`);
  console.log(`  With ONLY container (no booking/BL): ${anOnlyContainer}`);
  console.log('');

  // Sample arrival notices with only container
  const anOnlyContainerList = arrivalNotices.filter(an => {
    const entities = entitiesByEmail.get(an.email_id) || [];
    const hasBooking = entities.some(e => e.entity_type === 'booking_number');
    const hasBl = entities.some(e => ['bl_number', 'mbl_number', 'hbl_number'].includes(e.entity_type));
    const hasContainer = entities.some(e => e.entity_type === 'container_number');
    return hasContainer && !hasBooking && !hasBl;
  });

  console.log(`  Sample arrival notices with ONLY container:`);
  const emailIds = anOnlyContainerList.slice(0, 5).map(a => a.email_id);

  if (emailIds.length > 0) {
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id,subject,sender_email')
      .in('id', emailIds);

    for (const email of emails || []) {
      const entities = entitiesByEmail.get(email.id) || [];
      const containers = entities.filter(e => e.entity_type === 'container_number').map(e => e.entity_value);
      console.log(`    Email: ${email.subject?.substring(0, 60)}...`);
      console.log(`    From: ${email.sender_email}`);
      console.log(`    Containers: ${containers.join(', ')}`);
      console.log('');
    }
  }

  // ============================================================================
  // 4. ANALYZE NO IDENTIFIERS DOCUMENTS
  // ============================================================================
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 4. DOCUMENTS WITH NO IDENTIFIERS (485 mentioned)                           │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  const linkedDocs = await fetchAll<ShipmentDocument>(
    'shipment_documents',
    'email_id,shipment_id'
  );
  const linkedEmailIds = new Set(linkedDocs.map(d => d.email_id));

  // Find unlinked emails with no identifiers
  const noIdentifierEmails: string[] = [];
  const noIdByDocType: Record<string, number> = {};

  for (const c of classifications) {
    if (linkedEmailIds.has(c.email_id)) continue;

    const entities = entitiesByEmail.get(c.email_id) || [];
    const hasLinkableId = entities.some(e =>
      ['booking_number', 'bl_number', 'mbl_number', 'hbl_number', 'container_number'].includes(e.entity_type)
    );

    if (!hasLinkableId) {
      noIdentifierEmails.push(c.email_id);
      noIdByDocType[c.document_type] = (noIdByDocType[c.document_type] || 0) + 1;
    }
  }

  console.log(`  Documents with NO linkable identifiers: ${noIdentifierEmails.length}`);
  console.log('');
  console.log('  By document type:');
  for (const [type, count] of Object.entries(noIdByDocType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(35)} ${count.toString().padStart(5)}`);
  }

  // Sample these emails to understand why
  console.log('');
  console.log('  Sample emails with no identifiers:');
  const sampleNoId = noIdentifierEmails.slice(0, 10);
  if (sampleNoId.length > 0) {
    const { data: sampleEmails } = await supabase
      .from('raw_emails')
      .select('id,subject,sender_email')
      .in('id', sampleNoId);

    for (const email of sampleEmails || []) {
      const c = classifications.find(c => c.email_id === email.id);
      const entities = entitiesByEmail.get(email.id) || [];
      console.log(`    Type: ${c?.document_type || 'unknown'}`);
      console.log(`    Subject: ${email.subject?.substring(0, 70)}...`);
      console.log(`    From: ${email.sender_email}`);
      console.log(`    Entities: ${entities.map(e => `${e.entity_type}:${e.entity_value}`).join(', ') || 'NONE'}`);
      console.log('');
    }
  }

  // ============================================================================
  // 5. ANALYZE NO MATCHING SHIPMENT DOCUMENTS (1840 mentioned)
  // ============================================================================
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 5. DOCUMENTS WITH IDENTIFIERS BUT NO MATCHING SHIPMENT (1840 mentioned)    │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Build shipment lookup maps
  const shipmentByBooking = new Map<string, Shipment>();
  const shipmentByMbl = new Map<string, Shipment>();
  const shipmentByHbl = new Map<string, Shipment>();
  const shipmentByContainer = new Map<string, Shipment>();

  for (const s of shipments) {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number.toUpperCase(), s);
    }
    if (s.mbl_number) {
      shipmentByMbl.set(s.mbl_number.toUpperCase(), s);
    }
    if (s.hbl_number) {
      shipmentByHbl.set(s.hbl_number.toUpperCase(), s);
    }
    if (s.container_number_primary) {
      shipmentByContainer.set(s.container_number_primary.toUpperCase(), s);
    }
    if (s.container_numbers) {
      for (const c of s.container_numbers) {
        if (c) shipmentByContainer.set(c.toUpperCase(), s);
      }
    }
  }

  console.log(`  Lookup maps built:`);
  console.log(`    By booking: ${shipmentByBooking.size}`);
  console.log(`    By MBL: ${shipmentByMbl.size}`);
  console.log(`    By HBL: ${shipmentByHbl.size}`);
  console.log(`    By container: ${shipmentByContainer.size}`);
  console.log('');

  // Find documents with identifiers but no matching shipment
  const noMatchEmails: { emailId: string; docType: string; identifiers: Record<string, string[]> }[] = [];

  for (const c of classifications) {
    if (linkedEmailIds.has(c.email_id)) continue;

    const entities = entitiesByEmail.get(c.email_id) || [];
    const bookings = entities.filter(e => e.entity_type === 'booking_number').map(e => e.entity_value.toUpperCase());
    const bls = entities.filter(e => ['bl_number', 'mbl_number'].includes(e.entity_type)).map(e => e.entity_value.toUpperCase());
    const hbls = entities.filter(e => e.entity_type === 'hbl_number').map(e => e.entity_value.toUpperCase());
    const containers = entities.filter(e => e.entity_type === 'container_number').map(e => e.entity_value.toUpperCase());

    // Has some identifier?
    if (bookings.length === 0 && bls.length === 0 && hbls.length === 0 && containers.length === 0) {
      continue; // No identifiers - counted above
    }

    // Check if ANY identifier matches a shipment
    let hasMatch = false;
    for (const b of bookings) {
      if (shipmentByBooking.has(b)) { hasMatch = true; break; }
    }
    if (!hasMatch) {
      for (const b of bls) {
        if (shipmentByMbl.has(b)) { hasMatch = true; break; }
      }
    }
    if (!hasMatch) {
      for (const h of hbls) {
        if (shipmentByHbl.has(h)) { hasMatch = true; break; }
      }
    }
    if (!hasMatch) {
      for (const c of containers) {
        if (shipmentByContainer.has(c)) { hasMatch = true; break; }
      }
    }

    if (!hasMatch) {
      noMatchEmails.push({
        emailId: c.email_id,
        docType: c.document_type,
        identifiers: { bookings, bls, hbls, containers }
      });
    }
  }

  console.log(`  Documents with identifiers but NO matching shipment: ${noMatchEmails.length}`);
  console.log('');

  // Breakdown by what identifiers they have
  const noMatchStats = {
    onlyBooking: 0,
    onlyBl: 0,
    onlyContainer: 0,
    bookingAndBl: 0,
    bookingAndContainer: 0,
    blAndContainer: 0,
    all: 0,
  };

  for (const nm of noMatchEmails) {
    const hasB = nm.identifiers.bookings.length > 0;
    const hasBl = nm.identifiers.bls.length > 0 || nm.identifiers.hbls.length > 0;
    const hasC = nm.identifiers.containers.length > 0;

    if (hasB && hasBl && hasC) noMatchStats.all++;
    else if (hasB && hasBl) noMatchStats.bookingAndBl++;
    else if (hasB && hasC) noMatchStats.bookingAndContainer++;
    else if (hasBl && hasC) noMatchStats.blAndContainer++;
    else if (hasB) noMatchStats.onlyBooking++;
    else if (hasBl) noMatchStats.onlyBl++;
    else if (hasC) noMatchStats.onlyContainer++;
  }

  console.log('  By identifier type:');
  console.log(`    Only booking: ${noMatchStats.onlyBooking}`);
  console.log(`    Only BL: ${noMatchStats.onlyBl}`);
  console.log(`    Only container: ${noMatchStats.onlyContainer}`);
  console.log(`    Booking + BL: ${noMatchStats.bookingAndBl}`);
  console.log(`    Booking + container: ${noMatchStats.bookingAndContainer}`);
  console.log(`    BL + container: ${noMatchStats.blAndContainer}`);
  console.log(`    All three: ${noMatchStats.all}`);
  console.log('');

  // Sample non-matching emails
  console.log('  Sample documents with identifiers but no matching shipment:');
  const sampleNoMatch = noMatchEmails.slice(0, 10);
  const sampleNoMatchIds = sampleNoMatch.map(n => n.emailId);

  if (sampleNoMatchIds.length > 0) {
    const { data: sampleEmails } = await supabase
      .from('raw_emails')
      .select('id,subject,sender_email')
      .in('id', sampleNoMatchIds);

    for (const nm of sampleNoMatch) {
      const email = sampleEmails?.find(e => e.id === nm.emailId);
      console.log(`    Type: ${nm.docType}`);
      console.log(`    Subject: ${email?.subject?.substring(0, 60) || 'N/A'}...`);
      console.log(`    Identifiers:`);
      if (nm.identifiers.bookings.length > 0) console.log(`      Bookings: ${nm.identifiers.bookings.join(', ')}`);
      if (nm.identifiers.bls.length > 0) console.log(`      BLs: ${nm.identifiers.bls.join(', ')}`);
      if (nm.identifiers.hbls.length > 0) console.log(`      HBLs: ${nm.identifiers.hbls.join(', ')}`);
      if (nm.identifiers.containers.length > 0) console.log(`      Containers: ${nm.identifiers.containers.join(', ')}`);
      console.log('');
    }
  }

  // ============================================================================
  // 6. CHECK IF CONTAINER LINKING IS IN BACKFILL SCRIPT
  // ============================================================================
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 6. ROOT CAUSE ANALYSIS                                                     │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Count documents that COULD be linked via container if we added that logic
  let couldLinkViaContainer = 0;
  const couldLinkDetails: { emailId: string; container: string; shipmentId: string }[] = [];

  for (const c of classifications) {
    if (linkedEmailIds.has(c.email_id)) continue;

    const entities = entitiesByEmail.get(c.email_id) || [];
    const containers = entities.filter(e => e.entity_type === 'container_number').map(e => e.entity_value.toUpperCase());

    // Skip if already has booking/BL match (should be linked by that)
    const bookings = entities.filter(e => e.entity_type === 'booking_number').map(e => e.entity_value.toUpperCase());
    const bls = entities.filter(e => ['bl_number', 'mbl_number'].includes(e.entity_type)).map(e => e.entity_value.toUpperCase());

    let hasBookingMatch = false;
    let hasBlMatch = false;

    for (const b of bookings) {
      if (shipmentByBooking.has(b)) { hasBookingMatch = true; break; }
    }
    for (const b of bls) {
      if (shipmentByMbl.has(b)) { hasBlMatch = true; break; }
    }

    // If no booking/BL match but has container match, could link via container
    if (!hasBookingMatch && !hasBlMatch && containers.length > 0) {
      for (const container of containers) {
        const shipment = shipmentByContainer.get(container);
        if (shipment) {
          couldLinkViaContainer++;
          if (couldLinkDetails.length < 20) {
            couldLinkDetails.push({ emailId: c.email_id, container, shipmentId: shipment.id });
          }
          break; // Count once per email
        }
      }
    }
  }

  console.log(`  Documents that COULD be linked via container: ${couldLinkViaContainer}`);
  console.log('');

  if (couldLinkDetails.length > 0) {
    console.log('  Sample documents that could be linked via container:');
    const detailEmailIds = couldLinkDetails.map(d => d.emailId);
    const { data: detailEmails } = await supabase
      .from('raw_emails')
      .select('id,subject')
      .in('id', detailEmailIds);

    for (const detail of couldLinkDetails.slice(0, 5)) {
      const email = detailEmails?.find(e => e.id === detail.emailId);
      const shipment = shipments.find(s => s.id === detail.shipmentId);
      const c = classifications.find(c => c.email_id === detail.emailId);

      console.log(`    Document: ${c?.document_type || 'unknown'}`);
      console.log(`    Subject: ${email?.subject?.substring(0, 60) || 'N/A'}...`);
      console.log(`    Container: ${detail.container}`);
      console.log(`    -> Would link to shipment: ${shipment?.booking_number || detail.shipmentId}`);
      console.log('');
    }
  }

  // ============================================================================
  // 7. SUMMARY AND RECOMMENDATIONS
  // ============================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              SUMMARY & RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const totalClassified = classifications.length;
  const totalLinked = linkedEmailIds.size;
  const unlinkedWithIds = noMatchEmails.length;
  const unlinkedNoIds = noIdentifierEmails.length;
  const unlinkedTotal = totalClassified - totalLinked;

  console.log('Current State:');
  console.log(`  Total classified documents: ${totalClassified}`);
  console.log(`  Linked to shipments: ${totalLinked} (${((totalLinked/totalClassified)*100).toFixed(1)}%)`);
  console.log(`  Unlinked: ${unlinkedTotal}`);
  console.log(`    - No identifiers: ${unlinkedNoIds}`);
  console.log(`    - Has identifiers, no shipment match: ${unlinkedWithIds}`);
  console.log('');

  console.log('Container Linking Gap:');
  console.log(`  Shipments with containers: ${shipmentsWithAnyContainer}`);
  console.log(`  Container entities in documents: ${containerEntities.length}`);
  console.log(`  Could link via container: ${couldLinkViaContainer}`);
  console.log('');

  console.log('ROOT CAUSES:');
  console.log('  1. backfill-document-links.ts does NOT check container_number');
  console.log('     - findShipment() only checks booking_number, mbl_number, hbl_number');
  console.log('     - Container matching is missing entirely');
  console.log('');
  console.log('  2. BackfillService DOES check container_number (lines 250-258)');
  console.log('     - But may not be running or being used');
  console.log('');
  console.log('  3. Many documents have identifiers but no matching shipment');
  console.log(`     - ${noMatchEmails.length} documents have identifiers we cannot match`);
  console.log('     - These may be for shipments not yet in our system');
  console.log('');

  console.log('RECOMMENDED FIXES:');
  console.log('  1. Update backfill-document-links.ts to include container matching');
  console.log('  2. Run the BackfillService which already has container logic');
  console.log('  3. Consider creating shipments for unmatched booking numbers');
}

main().catch(console.error);
