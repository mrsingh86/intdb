/**
 * Link Documents to Existing Shipments
 * Matches by: booking_number, bl_number, container_number
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function linkDocumentsToShipments(): Promise<void> {
  console.log('='.repeat(60));
  console.log('LINK DOCUMENTS TO EXISTING SHIPMENTS');
  console.log('Matching by: booking_number, bl_number, container_number');
  console.log('='.repeat(60));

  let linked = 0;
  let alreadyLinked = 0;
  let noMatch = 0;
  const byDocType: Record<string, number> = {};
  const byMatchType: Record<string, number> = { booking: 0, bl: 0, container: 0 };

  // Get all shipments with identifiers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, container_number_primary, container_numbers');

  const bookingToShipment = new Map<string, string>();
  const blToShipment = new Map<string, string>();
  const containerToShipment = new Map<string, string>();

  for (const s of shipments || []) {
    if (s.booking_number) bookingToShipment.set(s.booking_number, s.id);
    if (s.bl_number) blToShipment.set(s.bl_number, s.id);
    if (s.container_number_primary) containerToShipment.set(s.container_number_primary, s.id);
    if (s.container_numbers && Array.isArray(s.container_numbers)) {
      for (const c of s.container_numbers) containerToShipment.set(c, s.id);
    }
  }

  console.log('Indexed ' + bookingToShipment.size + ' booking numbers');
  console.log('Indexed ' + blToShipment.size + ' BL numbers');
  console.log('Indexed ' + containerToShipment.size + ' container numbers\n');

  // Get linked email IDs
  const { data: linkedEmailIds } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedSet = new Set((linkedEmailIds || []).map(e => e.email_id));

  // Get all emails
  const { data: allEmails } = await supabase.from('raw_emails').select('id');
  const unlinkedIds = (allEmails || []).filter(e => !linkedSet.has(e.id)).map(e => e.id);

  console.log('Found ' + unlinkedIds.length + ' unlinked emails\n');

  // Process in batches
  const batchSize = 100;
  for (let i = 0; i < unlinkedIds.length; i += batchSize) {
    const batch = unlinkedIds.slice(i, i + batchSize);

    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('email_id', batch)
      .in('entity_type', ['booking_number', 'bl_number', 'container_number']);

    const emailEntities = new Map<string, { booking?: string; bl?: string; container?: string }>();
    for (const e of entities || []) {
      if (!emailEntities.has(e.email_id)) emailEntities.set(e.email_id, {});
      const entry = emailEntities.get(e.email_id)!;
      if (e.entity_type === 'booking_number') entry.booking = e.entity_value;
      if (e.entity_type === 'bl_number') entry.bl = e.entity_value;
      if (e.entity_type === 'container_number') entry.container = e.entity_value;
    }

    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', batch);

    const emailDocType = new Map<string, string>();
    for (const c of classifications || []) emailDocType.set(c.email_id, c.document_type);

    for (const emailId of batch) {
      const identifiers = emailEntities.get(emailId);
      if (!identifiers || (!identifiers.booking && !identifiers.bl && !identifiers.container)) {
        noMatch++;
        continue;
      }

      let shipmentId: string | undefined;
      let matchType = '';

      // Priority: booking > bl > container
      if (identifiers.booking && bookingToShipment.has(identifiers.booking)) {
        shipmentId = bookingToShipment.get(identifiers.booking);
        matchType = 'booking';
      } else if (identifiers.bl && blToShipment.has(identifiers.bl)) {
        shipmentId = blToShipment.get(identifiers.bl);
        matchType = 'bl';
      } else if (identifiers.container && containerToShipment.has(identifiers.container)) {
        shipmentId = containerToShipment.get(identifiers.container);
        matchType = 'container';
      }

      if (!shipmentId) {
        noMatch++;
        continue;
      }

      const { data: existing } = await supabase
        .from('shipment_documents')
        .select('id')
        .eq('email_id', emailId)
        .eq('shipment_id', shipmentId)
        .maybeSingle();

      if (existing) {
        alreadyLinked++;
        continue;
      }

      const docType = emailDocType.get(emailId) || 'unknown';
      const confidence = matchType === 'booking' ? 95 : matchType === 'bl' ? 90 : 75;

      const { error } = await supabase.from('shipment_documents').insert({
        email_id: emailId,
        shipment_id: shipmentId,
        document_type: docType,
        link_method: 'ai',
        link_confidence_score: confidence,
      });

      if (!error) {
        linked++;
        byDocType[docType] = (byDocType[docType] || 0) + 1;
        byMatchType[matchType] = (byMatchType[matchType] || 0) + 1;
      }
    }

    console.log('Processed ' + Math.min(i + batchSize, unlinkedIds.length) + '/' + unlinkedIds.length);
  }

  console.log('\n' + '='.repeat(60));
  console.log('COMPLETE');
  console.log('='.repeat(60));
  console.log('Newly linked: ' + linked);
  console.log('Already linked: ' + alreadyLinked);
  console.log('No matching shipment (orphans): ' + noMatch);

  console.log('\nBy match type:');
  console.log('  booking_number: ' + byMatchType.booking);
  console.log('  bl_number: ' + byMatchType.bl);
  console.log('  container_number: ' + byMatchType.container);

  if (Object.keys(byDocType).length > 0) {
    console.log('\nBy document type:');
    Object.entries(byDocType).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log('  ' + t + ': ' + c));
  }
}

linkDocumentsToShipments().catch(console.error);
