/**
 * Backfill shipments.container_numbers from carrier email extractions
 *
 * This script:
 * 1. Finds shipments with linked carrier emails
 * 2. Gets container numbers from entity_extractions for those emails
 * 3. Updates shipments.container_numbers with extracted containers
 *
 * This enables linking broker emails to shipments via container numbers.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function backfillContainers() {
  console.log('='.repeat(80));
  console.log('BACKFILL SHIPMENT CONTAINER NUMBERS');
  console.log('='.repeat(80));

  // Step 1: Get all shipments with their linked emails
  const { data: shipmentDocs, error: docsError } = await supabase
    .from('shipment_documents')
    .select(`
      shipment_id,
      email_id,
      shipments!inner(id, booking_number, container_numbers)
    `)
    .not('shipment_id', 'is', null);

  if (docsError) {
    console.error('Error fetching shipment documents:', docsError);
    return;
  }

  console.log(`\nFound ${shipmentDocs?.length || 0} linked documents\n`);

  // Group by shipment_id
  const shipmentEmails = new Map<string, Set<string>>();
  const shipmentInfo = new Map<string, any>();

  for (const doc of shipmentDocs || []) {
    const shipmentId = doc.shipment_id;
    if (!shipmentEmails.has(shipmentId)) {
      shipmentEmails.set(shipmentId, new Set());
      shipmentInfo.set(shipmentId, doc.shipments);
    }
    shipmentEmails.get(shipmentId)!.add(doc.email_id);
  }

  console.log(`Unique shipments with linked emails: ${shipmentEmails.size}\n`);

  // Step 2: For each shipment, get container numbers from linked email extractions
  let updated = 0;
  let skipped = 0;
  let noContainers = 0;

  for (const [shipmentId, emailIds] of shipmentEmails) {
    const shipment = shipmentInfo.get(shipmentId);
    const existingContainers = shipment?.container_numbers || [];

    // Get container extractions from linked emails
    const { data: extractions } = await supabase
      .from('entity_extractions')
      .select('entity_value')
      .in('email_id', Array.from(emailIds))
      .eq('entity_type', 'container_number');

    const extractedContainers = new Set<string>();
    for (const e of extractions || []) {
      if (e.entity_value && e.entity_value.match(/^[A-Z]{4}\d{7}$/)) {
        extractedContainers.add(e.entity_value.toUpperCase());
      }
    }

    if (extractedContainers.size === 0) {
      noContainers++;
      continue;
    }

    // Merge with existing containers
    const mergedContainers = new Set([...existingContainers, ...extractedContainers]);

    // Check if update needed
    if (mergedContainers.size === existingContainers.length) {
      skipped++;
      continue;
    }

    // Update shipment
    const { error: updateError } = await supabase
      .from('shipments')
      .update({
        container_numbers: Array.from(mergedContainers),
        updated_at: new Date().toISOString()
      })
      .eq('id', shipmentId);

    if (updateError) {
      console.log(`  ❌ Error updating ${shipmentId.substring(0, 8)}: ${updateError.message}`);
    } else {
      const newCount = mergedContainers.size - existingContainers.length;
      console.log(`  ✅ ${shipment?.booking_number || shipmentId.substring(0, 8)}: +${newCount} containers (total: ${mergedContainers.size})`);
      updated++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log(`\nSummary:`);
  console.log(`  Updated: ${updated} shipments`);
  console.log(`  Skipped (no new containers): ${skipped}`);
  console.log(`  No containers found: ${noContainers}`);

  // Step 3: Now try to link orphan broker documents
  console.log('\n' + '='.repeat(80));
  console.log('LINKING ORPHAN BROKER DOCUMENTS');
  console.log('='.repeat(80));

  // Get orphan documents with container extractions
  const { data: orphanDocs } = await supabase
    .from('shipment_documents')
    .select('id, email_id, document_type, booking_number_extracted')
    .is('shipment_id', null)
    .eq('status', 'pending_link');

  console.log(`\nFound ${orphanDocs?.length || 0} orphan documents\n`);

  let linked = 0;
  for (const orphan of orphanDocs || []) {
    // Get container extractions for this orphan's email
    const { data: containerExtractions } = await supabase
      .from('entity_extractions')
      .select('entity_value')
      .eq('email_id', orphan.email_id)
      .eq('entity_type', 'container_number');

    const containers = containerExtractions?.map(e => e.entity_value).filter(Boolean) || [];

    if (containers.length === 0) continue;

    // Try to find matching shipment
    for (const container of containers) {
      const { data: matchingShipments } = await supabase
        .from('shipments')
        .select('id, booking_number')
        .contains('container_numbers', [container])
        .limit(1);

      if (matchingShipments && matchingShipments.length > 0) {
        const shipment = matchingShipments[0];

        // Update orphan document with shipment link
        const { error: linkError } = await supabase
          .from('shipment_documents')
          .update({
            shipment_id: shipment.id,
            status: 'linked',
            updated_at: new Date().toISOString()
          })
          .eq('id', orphan.id);

        if (!linkError) {
          console.log(`  ✅ Linked ${orphan.document_type} to ${shipment.booking_number} via ${container}`);
          linked++;
        }
        break;
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n  Shipments updated with containers: ${updated}`);
  console.log(`  Orphan documents linked: ${linked}`);
}

backfillContainers().catch(console.error);
