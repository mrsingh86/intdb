#!/usr/bin/env npx tsx
/**
 * Full Linkage & Journey Audit
 *
 * FIXED: Uses pagination to avoid Supabase 1000-row limit
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * ============================================================================
 * SUPABASE PAGINATION UTILITIES
 * ============================================================================
 * Supabase has a default 1000-row limit. These utilities handle pagination
 * properly to get accurate counts across entire tables.
 */

const BATCH_SIZE = 1000;

/**
 * Paginate through all rows to get unique values for a single column
 */
async function getAllUniqueValues(
  table: string,
  column: string
): Promise<Set<string>> {
  const uniqueValues = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`Error fetching ${table}.${column}:`, error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row[column]) {
        uniqueValues.add(row[column]);
      }
    }

    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;
  }

  return uniqueValues;
}

/**
 * Paginate through all rows to get multiple columns
 * Returns array of all rows
 */
async function getAllRows<T>(
  table: string,
  columns: string
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }

    if (!data || data.length === 0) break;

    allRows.push(...(data as T[]));
    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;
  }

  return allRows;
}

/**
 * Get counts by grouping values (simulates GROUP BY)
 */
async function getGroupedCounts(
  table: string,
  column: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`Error fetching ${table}.${column}:`, error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const value = row[column]?.toString() || 'null';
      counts[value] = (counts[value] || 0) + 1;
    }

    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;
  }

  return counts;
}

async function audit() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              FULL LINKAGE & JOURNEY MAPPING AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Core counts
  const { count: emails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const { count: shipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });
  const { count: directCarrier } = await supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('is_direct_carrier_confirmed', true);

  console.log('');
  console.log('CORE DATA:');
  console.log('─'.repeat(70));
  console.log(`  Total emails:                    ${emails}`);
  console.log(`  Total shipments:                 ${shipments}`);
  console.log(`  Direct carrier shipments:        ${directCarrier} (REAL)`);

  // 2. Email-Shipment Links (PAGINATED - fixes 1000-row limit)
  const { count: links } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });

  // Use pagination to get ALL linked emails/shipments
  const linkedEmails = await getAllUniqueValues('shipment_documents', 'email_id');
  const linkedShipments = await getAllUniqueValues('shipment_documents', 'shipment_id');

  console.log('');
  console.log('EMAIL ↔ SHIPMENT LINKAGE:');
  console.log('─'.repeat(70));
  console.log(`  Total links:                     ${links}`);
  console.log(`  Unique emails linked:            ${linkedEmails.size} / ${emails} (${Math.round(linkedEmails.size/(emails||1)*100)}%)`);
  console.log(`  Shipments with documents:        ${linkedShipments.size} / ${shipments}`);
  console.log(`  Avg docs per shipment:           ${Math.round((links||0) / (linkedShipments.size||1))}`);

  // 3. Link confidence breakdown (PAGINATED)
  const confCounts = await getGroupedCounts('shipment_documents', 'link_confidence_score');

  console.log('');
  console.log('LINK CONFIDENCE SCORES:');
  console.log('─'.repeat(70));
  console.log(`  95% (booking_number):            ${confCounts['95']}`);
  console.log(`  90% (bl_number):                 ${confCounts['90']}`);
  console.log(`  75% (container_number):          ${confCounts['75']}`);
  console.log(`  70% (unknown):                   ${confCounts['70']}`);
  console.log(`  null (needs backfill):           ${confCounts['null']}`);

  // 4. Journey tables
  const { count: journeyEvents } = await supabase.from('shipment_journey_events').select('*', { count: 'exact', head: true });
  const { count: blockers } = await supabase.from('shipment_blockers').select('*', { count: 'exact', head: true });
  const { count: comms } = await supabase.from('stakeholder_communication_timeline').select('*', { count: 'exact', head: true });

  // Check how many shipments have journey data (PAGINATED)
  const shipmentsWithJourney = await getAllUniqueValues('shipment_journey_events', 'shipment_id');

  console.log('');
  console.log('JOURNEY MAPPING:');
  console.log('─'.repeat(70));
  console.log(`  shipment_journey_events:         ${journeyEvents} records`);
  console.log(`  shipment_blockers:               ${blockers} records`);
  console.log(`  stakeholder_communication:       ${comms} records`);
  console.log(`  Shipments with journey data:     ${shipmentsWithJourney.size} / ${shipments}`);

  // 5. Sample shipment with full journey
  if (shipmentsWithJourney.size > 0) {
    const sampleShipmentId = [...shipmentsWithJourney][0];

    const { data: shipment } = await supabase
      .from('shipments')
      .select('booking_number, status, is_direct_carrier_confirmed')
      .eq('id', sampleShipmentId)
      .single();

    const { count: sampleEvents } = await supabase
      .from('shipment_journey_events')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', sampleShipmentId);

    const { count: sampleDocs } = await supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', sampleShipmentId);

    console.log('');
    console.log('SAMPLE SHIPMENT WITH JOURNEY:');
    console.log('─'.repeat(70));
    console.log(`  Booking: ${shipment?.booking_number}`);
    console.log(`  Status: ${shipment?.status}`);
    console.log(`  Direct carrier: ${shipment?.is_direct_carrier_confirmed}`);
    console.log(`  Journey events: ${sampleEvents}`);
    console.log(`  Linked documents: ${sampleDocs}`);
  }

  // 6. Entity extractions (PAGINATED)
  const { count: entities } = await supabase.from('entity_extractions').select('*', { count: 'exact', head: true });

  // Get ALL unique emails with entities (no limit!)
  const emailsWithEntities = await getAllUniqueValues('entity_extractions', 'email_id');

  console.log('');
  console.log('ENTITY EXTRACTION:');
  console.log('─'.repeat(70));
  console.log(`  Total entities:                  ${entities}`);
  console.log(`  Emails with entities:            ${emailsWithEntities.size} / ${emails} (${Math.round(emailsWithEntities.size/(emails||1)*100)}%)`);

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('IMPLEMENTED:');
  console.log(`  ✓ Email-Shipment bi-directional linking (${links} links)`);
  console.log(`  ✓ is_direct_carrier_confirmed flag (${directCarrier} shipments)`);
  console.log(`  ✓ Journey events tracking (${journeyEvents} events)`);
  console.log(`  ✓ Blockers tracking (${blockers} blockers)`);
  console.log(`  ✓ Stakeholder communications (${comms} records)`);
  console.log(`  ✓ Entity extraction (${emailsWithEntities.size}/${emails} emails = ${Math.round(emailsWithEntities.size/(emails||1)*100)}%)`);
  console.log('');
  console.log('GAPS:');

  const nullConfidence = confCounts['null'] || 0;
  if (nullConfidence > 0) {
    console.log(`  ⚠ ${nullConfidence} links missing confidence_score`);
  }

  const unlinkedEmails = (emails || 0) - linkedEmails.size;
  if (unlinkedEmails > 0) {
    console.log(`  ⚠ ${unlinkedEmails} emails not linked to any shipment (${Math.round(unlinkedEmails/(emails||1)*100)}%)`);
  }

  const shipmentsNoJourney = (shipments || 0) - shipmentsWithJourney.size;
  if (shipmentsNoJourney > 0) {
    console.log(`  ⚠ ${shipmentsNoJourney} shipments without journey events`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

audit().catch(console.error);
