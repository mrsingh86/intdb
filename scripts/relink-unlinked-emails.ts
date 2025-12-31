#!/usr/bin/env npx tsx
/**
 * Re-Link Unlinked Emails to Existing Shipments
 *
 * Scans all emails that have entity extractions but aren't linked
 * to shipments via shipment_documents table. Matches them by:
 * 1. booking_number
 * 2. bl_number
 * 3. container_number
 *
 * Creates the missing links and updates processing status.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface EntityByEmail {
  booking_number?: string;
  bl_number?: string;
  container_number?: string;
  container_numbers?: string;
}

async function relinkEmails() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('RE-LINKING UNLINKED EMAILS TO SHIPMENTS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all currently linked email IDs
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedEmailIds = new Set(linkedDocs?.map(d => d.email_id) || []);
  console.log(`Currently linked emails: ${linkedEmailIds.size}`);

  // 2. Get all emails with classifications (processed enough to have document_type)
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  const classificationMap = new Map<string, string>();
  for (const c of classifications || []) {
    classificationMap.set(c.email_id, c.document_type);
  }

  // 3. Get all entity extractions grouped by email
  const { data: allEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value');

  const entitiesByEmail = new Map<string, EntityByEmail>();
  for (const e of allEntities || []) {
    if (!entitiesByEmail.has(e.email_id)) {
      entitiesByEmail.set(e.email_id, {});
    }
    const emailEntities = entitiesByEmail.get(e.email_id)!;
    if (e.entity_type === 'booking_number') emailEntities.booking_number = e.entity_value;
    if (e.entity_type === 'bl_number') emailEntities.bl_number = e.entity_value;
    if (e.entity_type === 'container_number') emailEntities.container_number = e.entity_value;
    if (e.entity_type === 'container_numbers') emailEntities.container_numbers = e.entity_value;
  }

  console.log(`Emails with entity extractions: ${entitiesByEmail.size}`);

  // 4. Find unlinked emails that have identifiers
  const unlinkedWithIdentifiers: Array<{
    emailId: string;
    documentType: string;
    entities: EntityByEmail;
  }> = [];

  for (const [emailId, entities] of entitiesByEmail) {
    if (linkedEmailIds.has(emailId)) continue; // Already linked

    const hasIdentifier = entities.booking_number || entities.bl_number ||
      entities.container_number || entities.container_numbers;

    if (hasIdentifier) {
      const documentType = classificationMap.get(emailId) || 'unknown';
      unlinkedWithIdentifiers.push({ emailId, documentType, entities });
    }
  }

  console.log(`Unlinked emails with identifiers: ${unlinkedWithIdentifiers.length}`);
  console.log('');

  // 5. Load all shipments for matching
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, container_number_primary');

  const shipmentByBooking = new Map<string, string>();
  const shipmentByBl = new Map<string, string>();
  const shipmentByContainer = new Map<string, string>();

  for (const s of allShipments || []) {
    if (s.booking_number) shipmentByBooking.set(s.booking_number, s.id);
    if (s.bl_number) shipmentByBl.set(s.bl_number, s.id);
    if (s.container_number_primary) shipmentByContainer.set(s.container_number_primary, s.id);
  }

  console.log(`Shipments indexed: ${allShipments?.length}`);
  console.log(`  By booking_number: ${shipmentByBooking.size}`);
  console.log(`  By bl_number: ${shipmentByBl.size}`);
  console.log(`  By container: ${shipmentByContainer.size}`);
  console.log('');

  // 6. Match and link
  const stats = {
    matchedByBooking: 0,
    matchedByBl: 0,
    matchedByContainer: 0,
    noMatch: 0,
    linkCreated: 0,
    errors: 0,
    byDocumentType: {} as Record<string, number>,
  };

  console.log('LINKING EMAILS:');
  console.log('─'.repeat(60));

  for (const { emailId, documentType, entities } of unlinkedWithIdentifiers) {
    let shipmentId: string | undefined;
    let matchedBy = '';

    // Try cascade match
    if (entities.booking_number && shipmentByBooking.has(entities.booking_number)) {
      shipmentId = shipmentByBooking.get(entities.booking_number);
      matchedBy = 'booking_number';
      stats.matchedByBooking++;
    } else if (entities.bl_number && shipmentByBl.has(entities.bl_number)) {
      shipmentId = shipmentByBl.get(entities.bl_number);
      matchedBy = 'bl_number';
      stats.matchedByBl++;
    } else {
      // Try container match
      let containerNum = entities.container_number;
      if (!containerNum && entities.container_numbers) {
        try {
          const containers = JSON.parse(entities.container_numbers);
          if (Array.isArray(containers) && containers.length > 0) {
            containerNum = containers[0];
          }
        } catch {
          containerNum = entities.container_numbers;
        }
      }
      if (containerNum && shipmentByContainer.has(containerNum)) {
        shipmentId = shipmentByContainer.get(containerNum);
        matchedBy = 'container';
        stats.matchedByContainer++;
      }
    }

    if (!shipmentId) {
      stats.noMatch++;
      continue;
    }

    // Check if link already exists
    const { data: existing } = await supabase
      .from('shipment_documents')
      .select('id')
      .eq('shipment_id', shipmentId)
      .eq('email_id', emailId)
      .maybeSingle();

    if (existing) {
      // Already linked, skip
      continue;
    }

    // Create the link
    const { error } = await supabase
      .from('shipment_documents')
      .insert({
        shipment_id: shipmentId,
        email_id: emailId,
        document_type: documentType,
        created_at: new Date().toISOString(),
      });

    if (error) {
      stats.errors++;
      console.log(`  ❌ Error linking ${emailId}: ${error.message}`);
    } else {
      stats.linkCreated++;
      stats.byDocumentType[documentType] = (stats.byDocumentType[documentType] || 0) + 1;

      // Update processing status to 'processed'
      await supabase
        .from('raw_emails')
        .update({ processing_status: 'processed' })
        .eq('id', emailId);
    }
  }

  // 7. Print results
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('MATCHING SUMMARY:');
  console.log(`  Matched by booking_number: ${stats.matchedByBooking}`);
  console.log(`  Matched by bl_number:      ${stats.matchedByBl}`);
  console.log(`  Matched by container:      ${stats.matchedByContainer}`);
  console.log(`  No match found:            ${stats.noMatch}`);
  console.log('');
  console.log(`  TOTAL LINKS CREATED:       ${stats.linkCreated}`);
  console.log(`  Errors:                    ${stats.errors}`);
  console.log('');
  console.log('LINKS BY DOCUMENT TYPE:');
  console.log('─'.repeat(50));
  for (const [type, count] of Object.entries(stats.byDocumentType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(35)} ${count}`);
  }

  // 8. Show updated stats
  console.log('');
  await showUpdatedStats();
}

async function showUpdatedStats() {
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const { count: linkedEmails } = await supabase
    .from('shipment_documents')
    .select('email_id', { count: 'exact', head: true });

  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const uniqueLinked = new Set(linkedDocs?.map(d => d.email_id) || []).size;

  console.log('UPDATED LINKING STATISTICS:');
  console.log('═'.repeat(50));
  console.log(`  Total emails:          ${totalEmails}`);
  console.log(`  Unique emails linked:  ${uniqueLinked}`);
  console.log(`  Link percentage:       ${Math.round((uniqueLinked / (totalEmails || 1)) * 100)}%`);
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

relinkEmails().catch(console.error);
