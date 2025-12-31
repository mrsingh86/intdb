#!/usr/bin/env npx tsx
/**
 * Full Re-Link ALL Emails to Shipments
 *
 * Handles pagination properly to process ALL emails in the database.
 * Links any email with extracted identifiers to existing shipments.
 * Creates new shipments for booking numbers that don't exist.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function fetchAll<T>(
  table: string,
  select: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + limit - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));
    offset += limit;

    if (data.length < limit) break;
  }

  return all;
}

async function fullRelink() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('FULL RE-LINK ALL EMAILS TO SHIPMENTS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Fetch ALL data with proper pagination
  console.log('Fetching all data (with pagination)...');

  const allEmails = await fetchAll<{ id: string; processing_status: string }>('raw_emails', 'id, processing_status');
  console.log(`  Total emails: ${allEmails.length}`);

  const allClassifications = await fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id, document_type');
  console.log(`  Classifications: ${allClassifications.length}`);

  const allExtractions = await fetchAll<{ email_id: string; entity_type: string; entity_value: string }>('entity_extractions', 'email_id, entity_type, entity_value');
  console.log(`  Entity extractions: ${allExtractions.length}`);

  const allLinks = await fetchAll<{ email_id: string; shipment_id: string }>('shipment_documents', 'email_id, shipment_id');
  console.log(`  Existing links: ${allLinks.length}`);

  const allShipments = await fetchAll<{ id: string; booking_number: string | null; bl_number: string | null; container_number_primary: string | null }>('shipments', 'id, booking_number, bl_number, container_number_primary');
  console.log(`  Shipments: ${allShipments.length}`);
  console.log('');

  // 2. Build lookup maps
  const classificationMap = new Map<string, string>();
  for (const c of allClassifications) {
    classificationMap.set(c.email_id, c.document_type);
  }

  const linkedEmailIds = new Set(allLinks.map(l => l.email_id));

  // Entities by email
  const entitiesByEmail = new Map<string, Record<string, string>>();
  for (const e of allExtractions) {
    if (!entitiesByEmail.has(e.email_id)) {
      entitiesByEmail.set(e.email_id, {});
    }
    entitiesByEmail.get(e.email_id)![e.entity_type] = e.entity_value;
  }

  // Shipment lookups
  const shipmentByBooking = new Map<string, string>();
  const shipmentByBl = new Map<string, string>();
  const shipmentByContainer = new Map<string, string>();

  for (const s of allShipments) {
    if (s.booking_number) shipmentByBooking.set(s.booking_number, s.id);
    if (s.bl_number) shipmentByBl.set(s.bl_number, s.id);
    if (s.container_number_primary) shipmentByContainer.set(s.container_number_primary, s.id);
  }

  // 3. Find all unlinked emails with identifiers
  console.log('ANALYSIS:');
  console.log('─'.repeat(60));
  console.log(`  Emails with extractions: ${entitiesByEmail.size}`);
  console.log(`  Already linked: ${linkedEmailIds.size}`);

  const unlinkedWithIdentifiers: Array<{
    emailId: string;
    documentType: string;
    entities: Record<string, string>;
  }> = [];

  for (const [emailId, entities] of entitiesByEmail) {
    if (linkedEmailIds.has(emailId)) continue;

    const hasIdentifier = entities.booking_number || entities.bl_number ||
      entities.container_number || entities.container_numbers;

    if (hasIdentifier) {
      const documentType = classificationMap.get(emailId) || 'unknown';
      unlinkedWithIdentifiers.push({ emailId, documentType, entities });
    }
  }

  console.log(`  Unlinked with identifiers: ${unlinkedWithIdentifiers.length}`);
  console.log('');

  // 4. Link to existing shipments OR create new ones
  const stats = {
    linkedToExisting: 0,
    newShipmentsCreated: 0,
    matchedByBooking: 0,
    matchedByBl: 0,
    matchedByContainer: 0,
    noIdentifier: 0,
    errors: 0,
    byDocumentType: {} as Record<string, number>,
  };

  console.log('LINKING EMAILS:');
  console.log('─'.repeat(60));

  for (const { emailId, documentType, entities } of unlinkedWithIdentifiers) {
    let shipmentId: string | undefined;
    let matchedBy = '';
    let createdNew = false;

    // Try cascade match to existing shipment
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

    // If no match, create NEW shipment (only if we have booking_number)
    if (!shipmentId && entities.booking_number) {
      const { data: newShipment, error: createError } = await supabase
        .from('shipments')
        .insert({
          booking_number: entities.booking_number,
          bl_number: entities.bl_number || null,
          vessel_name: entities.vessel_name || null,
          voyage_number: entities.voyage_number || null,
          port_of_loading: entities.port_of_loading || null,
          port_of_discharge: entities.port_of_discharge || null,
          etd: entities.etd || null,
          eta: entities.eta || null,
          shipper_name: entities.shipper_name || entities.shipper || null,
          consignee_name: entities.consignee_name || entities.consignee || null,
          workflow_state: 'booking_confirmed',
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError) {
        // Might be duplicate booking number - try to fetch existing
        const { data: existing } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', entities.booking_number)
          .maybeSingle();

        if (existing) {
          shipmentId = existing.id;
          matchedBy = 'booking_number (retry)';
        } else {
          stats.errors++;
          continue;
        }
      } else if (newShipment) {
        shipmentId = newShipment.id;
        createdNew = true;
        stats.newShipmentsCreated++;

        // Add to lookup for future matches
        shipmentByBooking.set(entities.booking_number, shipmentId);
        if (entities.bl_number) shipmentByBl.set(entities.bl_number, shipmentId);
      }
    }

    if (!shipmentId) {
      stats.noIdentifier++;
      continue;
    }

    // Check if link already exists
    const { data: existing } = await supabase
      .from('shipment_documents')
      .select('id')
      .eq('shipment_id', shipmentId)
      .eq('email_id', emailId)
      .maybeSingle();

    if (existing) continue;

    // Create link
    const { error: linkError } = await supabase
      .from('shipment_documents')
      .insert({
        shipment_id: shipmentId,
        email_id: emailId,
        document_type: documentType,
        created_at: new Date().toISOString(),
      });

    if (linkError) {
      stats.errors++;
    } else {
      if (createdNew) {
        // Already counted
      } else {
        stats.linkedToExisting++;
      }
      stats.byDocumentType[documentType] = (stats.byDocumentType[documentType] || 0) + 1;

      // Update processing status
      await supabase
        .from('raw_emails')
        .update({ processing_status: 'processed' })
        .eq('id', emailId);
    }

    // Progress indicator
    const total = stats.linkedToExisting + stats.newShipmentsCreated;
    if (total > 0 && total % 50 === 0) {
      console.log(`  Processed ${total} links...`);
    }
  }

  // 5. Print results
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('MATCHING SUMMARY:');
  console.log(`  Linked to EXISTING shipments: ${stats.linkedToExisting}`);
  console.log(`  NEW shipments created:        ${stats.newShipmentsCreated}`);
  console.log('');
  console.log('MATCH METHOD:');
  console.log(`  By booking_number: ${stats.matchedByBooking}`);
  console.log(`  By bl_number:      ${stats.matchedByBl}`);
  console.log(`  By container:      ${stats.matchedByContainer}`);
  console.log(`  No valid identifier: ${stats.noIdentifier}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log('');
  console.log('LINKS BY DOCUMENT TYPE:');
  console.log('─'.repeat(50));
  for (const [type, count] of Object.entries(stats.byDocumentType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(35)} ${count}`);
  }

  // 6. Final stats
  console.log('');
  await showFinalStats();
}

async function showFinalStats() {
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const allLinks = await fetchAll<{ email_id: string }>('shipment_documents', 'email_id');
  const uniqueLinked = new Set(allLinks.map(l => l.email_id)).size;

  console.log('FINAL STATISTICS:');
  console.log('═'.repeat(50));
  console.log(`  Total emails:          ${totalEmails}`);
  console.log(`  Total shipments:       ${totalShipments}`);
  console.log(`  Unique emails linked:  ${uniqueLinked}`);
  console.log(`  Link percentage:       ${Math.round((uniqueLinked / (totalEmails || 1)) * 100)}%`);
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

fullRelink().catch(console.error);
