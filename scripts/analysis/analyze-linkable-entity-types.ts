/**
 * Analyze Other Entity Types for Linking Potential
 *
 * Check if we should add linking by:
 * - job_number
 * - invoice_number
 * - shipment_number
 * - consol_number
 * - Other identifiers
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
  console.log('              LINKABLE ENTITY TYPES ANALYSIS');
  console.log('========================================================================');
  console.log('');

  // Fetch entities
  const allEntities = await fetchAll<{
    email_id: string;
    entity_type: string;
    entity_value: string;
  }>('entity_extractions', 'email_id,entity_type,entity_value');

  const linkedDocs = await fetchAll<{ email_id: string }>('shipment_documents', 'email_id');
  const linkedEmailIds = new Set(linkedDocs.map(d => d.email_id));

  // Currently used for linking
  const currentLinkingTypes = new Set([
    'booking_number',
    'bl_number',
    'mbl_number',
    'hbl_number',
    'container_number',
  ]);

  // Potential identifier types that could be used
  const potentialLinkingTypes = [
    'job_number',
    'invoice_number',
    'shipment_number',
    'consol_number',
    'po_number',
    'customer_reference',
    'isf_number',
    'ams_number',
    'reference_number',
    'tracking_id',
    'so_number',
    'transport_document_number',
    'waybill_number',
    'cargo_control_number',
    'delivery_order_number',
    'pickup_number',
  ];

  // Group entities by email
  const entitiesByEmail = new Map<string, { entity_type: string; entity_value: string }[]>();
  for (const e of allEntities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push({ entity_type: e.entity_type, entity_value: e.entity_value });
    entitiesByEmail.set(e.email_id, existing);
  }

  // Count unlinked documents that have each potential entity type
  const potentialLinkingStats: Record<string, {
    totalCount: number;
    uniqueValues: Set<string>;
    unlinkedDocsWithThis: number;
    unlinkedDocsOnlyThis: number;  // No current linking identifiers
    sampleValues: string[];
  }> = {};

  for (const type of potentialLinkingTypes) {
    potentialLinkingStats[type] = {
      totalCount: 0,
      uniqueValues: new Set(),
      unlinkedDocsWithThis: 0,
      unlinkedDocsOnlyThis: 0,
      sampleValues: [],
    };
  }

  // Analyze each email
  for (const [emailId, entities] of entitiesByEmail.entries()) {
    const isLinked = linkedEmailIds.has(emailId);

    // Check if has any current linking type
    const hasCurrentLinkingType = entities.some(e => currentLinkingTypes.has(e.entity_type));

    for (const entity of entities) {
      if (potentialLinkingTypes.includes(entity.entity_type)) {
        const stats = potentialLinkingStats[entity.entity_type];
        stats.totalCount++;
        stats.uniqueValues.add(entity.entity_value.toUpperCase());

        if (stats.sampleValues.length < 5 && !stats.sampleValues.includes(entity.entity_value)) {
          stats.sampleValues.push(entity.entity_value);
        }

        if (!isLinked) {
          stats.unlinkedDocsWithThis++;
          if (!hasCurrentLinkingType) {
            stats.unlinkedDocsOnlyThis++;
          }
        }
      }
    }
  }

  // Display results
  console.log('Potential Entity Types for Linking:');
  console.log('------------------------------------------------------------------------');
  console.log('Entity Type              | Total | Unique | Unlinked | Only This | Samples');
  console.log('------------------------------------------------------------------------');

  const sortedTypes = Object.entries(potentialLinkingStats)
    .sort((a, b) => b[1].unlinkedDocsOnlyThis - a[1].unlinkedDocsOnlyThis);

  for (const [type, stats] of sortedTypes) {
    if (stats.totalCount > 0) {
      console.log(
        `${type.padEnd(24)} | ${stats.totalCount.toString().padStart(5)} | ${stats.uniqueValues.size.toString().padStart(6)} | ${stats.unlinkedDocsWithThis.toString().padStart(8)} | ${stats.unlinkedDocsOnlyThis.toString().padStart(9)} | ${stats.sampleValues.slice(0, 2).join(', ')}`
      );
    }
  }

  console.log('');
  console.log('Legend:');
  console.log('  Total: Total entities of this type');
  console.log('  Unique: Unique values');
  console.log('  Unlinked: Unlinked docs with this entity type');
  console.log('  Only This: Unlinked docs where this is the ONLY identifier (no booking/BL/container)');
  console.log('');

  // Find documents that have ONLY potential identifiers (no current linking types)
  console.log('========================================================================');
  console.log('DOCUMENTS WITH ONLY ALTERNATE IDENTIFIERS (no booking/BL/container)');
  console.log('========================================================================');
  console.log('');

  let docsWithOnlyAlternate = 0;
  const alternateOnlyByType: Record<string, string[]> = {};

  for (const [emailId, entities] of entitiesByEmail.entries()) {
    if (linkedEmailIds.has(emailId)) continue;

    const hasCurrentLinkingType = entities.some(e => currentLinkingTypes.has(e.entity_type));
    if (hasCurrentLinkingType) continue;

    // Has some potential linking type?
    const potentialTypes = entities.filter(e => potentialLinkingTypes.includes(e.entity_type));
    if (potentialTypes.length > 0) {
      docsWithOnlyAlternate++;
      for (const p of potentialTypes) {
        if (!alternateOnlyByType[p.entity_type]) {
          alternateOnlyByType[p.entity_type] = [];
        }
        if (alternateOnlyByType[p.entity_type].length < 3) {
          alternateOnlyByType[p.entity_type].push(`${emailId}: ${p.entity_value}`);
        }
      }
    }
  }

  console.log(`Documents with ONLY alternate identifiers: ${docsWithOnlyAlternate}`);
  console.log('');

  for (const [type, samples] of Object.entries(alternateOnlyByType).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${type}:`);
    for (const sample of samples) {
      console.log(`    ${sample}`);
    }
    console.log('');
  }

  // Check shipments table for these fields
  console.log('========================================================================');
  console.log('SHIPMENT TABLE - POTENTIAL LINKING COLUMNS');
  console.log('========================================================================');
  console.log('');

  // Check what columns exist on shipments
  const { data: sampleShipment } = await supabase
    .from('shipments')
    .select('*')
    .limit(1)
    .single();

  if (sampleShipment) {
    const columns = Object.keys(sampleShipment);
    const potentialColumns = columns.filter(c =>
      c.includes('number') || c.includes('reference') || c.includes('id')
    );

    console.log('Columns on shipments table that could be used for linking:');
    for (const col of potentialColumns) {
      console.log(`  ${col}`);
    }
  }

  console.log('');
  console.log('========================================================================');
  console.log('RECOMMENDATION');
  console.log('========================================================================');
  console.log('');
  console.log('1. IMMEDIATE FIX: Add container_number to backfill-document-links.ts');
  console.log('   Impact: ~164 documents');
  console.log('');
  console.log('2. CONSIDER: Add job_number linking if it matches Intoglo job numbers');
  console.log('   Impact: Could help with internal documents');
  console.log('');
  console.log('3. NO ACTION NEEDED for other types:');
  console.log('   - invoice_number: Not unique across shipments');
  console.log('   - po_number: Customer-specific, not in shipment table');
  console.log('   - customer_reference: Varies too much');
}

main().catch(console.error);
