/**
 * Backfill Document Links - FIXED VERSION
 *
 * Fixes from original backfill-document-links.ts:
 * 1. Adds container_number matching
 * 2. Expands documentTypesToLink to include all document types
 * 3. Shows dry-run results first
 *
 * Run with: npx tsx scripts/backfill-document-links-fixed.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

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

interface Classification {
  email_id: string;
  document_type: string;
  confidence_score: number;
}

interface Entity {
  email_id: string;
  entity_type: string;
  entity_value: string;
}

interface Shipment {
  id: string;
  booking_number: string | null;
  mbl_number: string | null;
  hbl_number: string | null;
  container_number_primary: string | null;
  container_numbers: string[] | null;
}

interface ShipmentDocument {
  email_id: string;
  shipment_id: string;
}

async function backfillDocumentLinks() {
  console.log('========================================================================');
  console.log('        BACKFILL DOCUMENT LINKS - FIXED VERSION');
  console.log(`        Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will create links)'}`);
  console.log('========================================================================');
  console.log('');

  // 1. Fetch all required data
  console.log('Fetching data...');
  const [classifications, entities, shipments, existingDocs] = await Promise.all([
    fetchAll<Classification>('document_classifications', 'email_id,document_type,confidence_score'),
    fetchAll<Entity>('entity_extractions', 'email_id,entity_type,entity_value'),
    fetchAll<Shipment>('shipments', 'id,booking_number,mbl_number,hbl_number,container_number_primary,container_numbers'),
    fetchAll<ShipmentDocument>('shipment_documents', 'email_id,shipment_id'),
  ]);

  console.log(`  Classifications: ${classifications.length}`);
  console.log(`  Entities: ${entities.length}`);
  console.log(`  Shipments: ${shipments.length}`);
  console.log(`  Existing links: ${existingDocs.length}`);
  console.log('');

  // 2. Create lookup maps
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
    // FIX #1: Add container_number matching
    if (s.container_number_primary) {
      shipmentByContainer.set(s.container_number_primary.toUpperCase(), s);
    }
    if (s.container_numbers) {
      for (const c of s.container_numbers) {
        if (c) shipmentByContainer.set(c.toUpperCase(), s);
      }
    }
  }

  console.log('Lookup maps built:');
  console.log(`  By booking: ${shipmentByBooking.size}`);
  console.log(`  By MBL: ${shipmentByMbl.size}`);
  console.log(`  By HBL: ${shipmentByHbl.size}`);
  console.log(`  By container: ${shipmentByContainer.size}`);
  console.log('');

  // Group entities by email
  const entitiesByEmail = new Map<string, Entity[]>();
  for (const e of entities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push(e);
    entitiesByEmail.set(e.email_id, existing);
  }

  const linkedEmails = new Set(existingDocs.map(d => d.email_id));

  // FIX #2: Include ALL document types (not just a subset)
  // Note: We could filter out 'not_shipping' but let's be inclusive
  const excludedDocTypes = ['not_shipping']; // Only exclude truly irrelevant types

  // Helper to find shipment by any identifier
  function findShipment(emailId: string): { shipment: Shipment; matchType: string } | null {
    const emailEntities = entitiesByEmail.get(emailId) || [];

    for (const e of emailEntities) {
      const value = e.entity_value?.toUpperCase();
      if (!value) continue;

      // Check booking_number first (highest priority)
      if (e.entity_type === 'booking_number' && shipmentByBooking.has(value)) {
        return { shipment: shipmentByBooking.get(value)!, matchType: 'booking' };
      }
    }

    for (const e of emailEntities) {
      const value = e.entity_value?.toUpperCase();
      if (!value) continue;

      // Check MBL/BL number
      if ((e.entity_type === 'mbl_number' || e.entity_type === 'bl_number') && shipmentByMbl.has(value)) {
        return { shipment: shipmentByMbl.get(value)!, matchType: 'mbl' };
      }
    }

    for (const e of emailEntities) {
      const value = e.entity_value?.toUpperCase();
      if (!value) continue;

      // Check HBL number
      if (e.entity_type === 'hbl_number' && shipmentByHbl.has(value)) {
        return { shipment: shipmentByHbl.get(value)!, matchType: 'hbl' };
      }
    }

    // FIX #1: Check container_number (lowest priority)
    for (const e of emailEntities) {
      const value = e.entity_value?.toUpperCase();
      if (!value) continue;

      if (e.entity_type === 'container_number' && shipmentByContainer.has(value)) {
        return { shipment: shipmentByContainer.get(value)!, matchType: 'container' };
      }
    }

    return null;
  }

  // 3. Find unlinked documents that can be linked
  console.log('Finding linkable documents...');

  const toLinkDocuments: { emailId: string; shipmentId: string; documentType: string; matchType: string }[] = [];
  const stats = {
    alreadyLinked: 0,
    noIdentifiers: 0,
    noMatchingShipment: 0,
    linkedByBooking: 0,
    linkedByMbl: 0,
    linkedByHbl: 0,
    linkedByContainer: 0,
    excludedDocType: 0,
  };

  for (const c of classifications) {
    // Skip excluded document types
    if (excludedDocTypes.includes(c.document_type)) {
      stats.excludedDocType++;
      continue;
    }

    // Skip if already linked
    if (linkedEmails.has(c.email_id)) {
      stats.alreadyLinked++;
      continue;
    }

    // Find matching shipment
    const result = findShipment(c.email_id);
    if (!result) {
      // Check if email has any identifiers at all
      const emailEntities = entitiesByEmail.get(c.email_id) || [];
      const hasIdentifiers = emailEntities.some(e =>
        ['booking_number', 'mbl_number', 'bl_number', 'hbl_number', 'container_number'].includes(e.entity_type)
      );

      if (hasIdentifiers) {
        stats.noMatchingShipment++;
      } else {
        stats.noIdentifiers++;
      }
      continue;
    }

    // Track stats by match type
    switch (result.matchType) {
      case 'booking': stats.linkedByBooking++; break;
      case 'mbl': stats.linkedByMbl++; break;
      case 'hbl': stats.linkedByHbl++; break;
      case 'container': stats.linkedByContainer++; break;
    }

    // Add to link list
    toLinkDocuments.push({
      emailId: c.email_id,
      shipmentId: result.shipment.id,
      documentType: c.document_type,
      matchType: result.matchType,
    });
  }

  console.log('');
  console.log('Analysis results:');
  console.log(`  Already linked: ${stats.alreadyLinked}`);
  console.log(`  Excluded doc types: ${stats.excludedDocType}`);
  console.log(`  No identifiers: ${stats.noIdentifiers}`);
  console.log(`  No matching shipment: ${stats.noMatchingShipment}`);
  console.log('');
  console.log('Documents to link:');
  console.log(`  By booking#: ${stats.linkedByBooking}`);
  console.log(`  By MBL#: ${stats.linkedByMbl}`);
  console.log(`  By HBL#: ${stats.linkedByHbl}`);
  console.log(`  By container#: ${stats.linkedByContainer}`);
  console.log(`  TOTAL: ${toLinkDocuments.length}`);
  console.log('');

  // Group by document type for logging
  const byDocType: Record<string, number> = {};
  for (const doc of toLinkDocuments) {
    byDocType[doc.documentType] = (byDocType[doc.documentType] || 0) + 1;
  }

  console.log('By document type:');
  for (const [type, count] of Object.entries(byDocType).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${type.padEnd(35)} ${count.toString().padStart(5)}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('========================================================================');
    console.log('                      DRY RUN - NO CHANGES MADE');
    console.log('========================================================================');
    console.log('');
    console.log(`Would have linked ${toLinkDocuments.length} documents.`);
    console.log('');
    console.log('To execute, run without --dry-run flag:');
    console.log('  npx tsx scripts/backfill-document-links-fixed.ts');
    return;
  }

  // 4. Create document links in batches
  if (toLinkDocuments.length === 0) {
    console.log('No documents to link!');
    return;
  }

  console.log('Creating document links...');
  const BATCH_SIZE = 100;
  let linkedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toLinkDocuments.length; i += BATCH_SIZE) {
    const batch = toLinkDocuments.slice(i, i + BATCH_SIZE);

    const documents = batch.map(d => ({
      email_id: d.emailId,
      shipment_id: d.shipmentId,
      document_type: d.documentType,
      created_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('shipment_documents')
      .upsert(documents, { onConflict: 'email_id,shipment_id' });

    if (error) {
      console.error(`  Batch error: ${error.message}`);
      errorCount += batch.length;
    } else {
      linkedCount += batch.length;
    }

    // Progress
    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= toLinkDocuments.length) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, toLinkDocuments.length)}/${toLinkDocuments.length}`);
    }
  }

  // 5. Summary
  console.log('');
  console.log('========================================================================');
  console.log('                              BACKFILL COMPLETE');
  console.log('========================================================================');
  console.log('');
  console.log(`Documents linked: ${linkedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('');
  console.log('Summary by match type:');
  console.log(`  Booking: ${stats.linkedByBooking}`);
  console.log(`  MBL: ${stats.linkedByMbl}`);
  console.log(`  HBL: ${stats.linkedByHbl}`);
  console.log(`  Container: ${stats.linkedByContainer}`);
}

backfillDocumentLinks().catch(console.error);
