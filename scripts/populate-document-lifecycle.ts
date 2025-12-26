#!/usr/bin/env npx tsx
/**
 * Populate Document Lifecycle
 *
 * Links documents to shipments via booking number matching and creates
 * document_lifecycle records for each document type per shipment.
 *
 * Steps:
 * 1. Get all document classifications with booking numbers
 * 2. Match to shipments by booking number
 * 3. Create shipment_documents links if missing
 * 4. Create document_lifecycle records if missing
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Document type to lifecycle status mapping
const DOC_TYPE_TO_STATUS: Record<string, string> = {
  'booking_confirmation': 'acknowledged',
  'booking_amendment': 'acknowledged',
  'bill_of_lading': 'received',
  'arrival_notice': 'received',
  'customs_clearance': 'pending',
  'commercial_invoice': 'received',
  'shipping_instruction': 'draft',
  'packing_list': 'received',
};

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          POPULATE DOCUMENT LIFECYCLE RECORDS                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Get current state
  const { count: initialLifecycleCount } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });

  const { count: initialLinkCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  console.log(`Initial state:`);
  console.log(`  - document_lifecycle records: ${initialLifecycleCount}`);
  console.log(`  - shipment_documents links: ${initialLinkCount}`);

  // Step 2: Get all shipments with booking numbers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number');

  if (!shipments) {
    console.log('No shipments found');
    return;
  }

  console.log(`\nShipments to process: ${shipments.length}`);

  // Build booking number to shipment mapping
  const bookingToShipment = new Map<string, string>();
  const blToShipment = new Map<string, string>();

  for (const shipment of shipments) {
    if (shipment.booking_number) {
      bookingToShipment.set(shipment.booking_number, shipment.id);
      // Also add normalized version
      const normalized = shipment.booking_number.replace(/^HL-/i, '').trim();
      if (normalized !== shipment.booking_number) {
        bookingToShipment.set(normalized, shipment.id);
      }
    }
    if (shipment.bl_number) {
      blToShipment.set(shipment.bl_number, shipment.id);
    }
  }

  // Step 3: Get all document classifications with their emails
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_type');

  if (!classifications) {
    console.log('No classifications found');
    return;
  }

  console.log(`Document classifications: ${classifications.length}`);

  // Step 4: Get entity extractions for booking/BL numbers
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('entity_type', ['booking_number', 'bl_number']);

  // Build email to booking/BL mapping
  const emailToBookings = new Map<string, string[]>();
  const emailToBls = new Map<string, string[]>();

  for (const entity of entities || []) {
    if (entity.entity_type === 'booking_number') {
      if (!emailToBookings.has(entity.email_id)) {
        emailToBookings.set(entity.email_id, []);
      }
      emailToBookings.get(entity.email_id)!.push(entity.entity_value);
      // Add normalized version
      const normalized = entity.entity_value.replace(/^HL-/i, '').trim();
      if (normalized !== entity.entity_value) {
        emailToBookings.get(entity.email_id)!.push(normalized);
      }
    } else if (entity.entity_type === 'bl_number') {
      if (!emailToBls.has(entity.email_id)) {
        emailToBls.set(entity.email_id, []);
      }
      emailToBls.get(entity.email_id)!.push(entity.entity_value);
    }
  }

  console.log(`\nEmails with booking numbers: ${emailToBookings.size}`);
  console.log(`Emails with BL numbers: ${emailToBls.size}`);

  // Step 5: Get existing links and lifecycle records
  const { data: existingLinks } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id');

  const existingLinkSet = new Set(
    existingLinks?.map(l => `${l.shipment_id}:${l.email_id}`) || []
  );

  const { data: existingLifecycle } = await supabase
    .from('document_lifecycle')
    .select('shipment_id, document_type');

  const existingLifecycleSet = new Set(
    existingLifecycle?.map(l => `${l.shipment_id}:${l.document_type}`) || []
  );

  // Step 6: Process each classification
  let newLinks = 0;
  let newLifecycle = 0;

  for (const classification of classifications) {
    // Find shipment for this email
    let shipmentId: string | null = null;

    // Try booking numbers
    const bookings = emailToBookings.get(classification.email_id) || [];
    for (const booking of bookings) {
      if (bookingToShipment.has(booking)) {
        shipmentId = bookingToShipment.get(booking)!;
        break;
      }
    }

    // Try BL numbers if no match
    if (!shipmentId) {
      const bls = emailToBls.get(classification.email_id) || [];
      for (const bl of bls) {
        if (blToShipment.has(bl)) {
          shipmentId = blToShipment.get(bl)!;
          break;
        }
      }
    }

    if (!shipmentId) continue;

    // Create shipment_documents link if missing
    const linkKey = `${shipmentId}:${classification.email_id}`;
    if (!existingLinkSet.has(linkKey)) {
      const { error: linkError } = await supabase
        .from('shipment_documents')
        .insert({
          shipment_id: shipmentId,
          email_id: classification.email_id,
          document_type: classification.document_type,
        });

      if (!linkError) {
        newLinks++;
        existingLinkSet.add(linkKey);
      }
    }

    // Create document_lifecycle record if missing
    const lifecycleKey = `${shipmentId}:${classification.document_type}`;
    if (!existingLifecycleSet.has(lifecycleKey)) {
      const lifecycleStatus = DOC_TYPE_TO_STATUS[classification.document_type] || 'pending';

      const { error: lifecycleError } = await supabase
        .from('document_lifecycle')
        .insert({
          shipment_id: shipmentId,
          document_type: classification.document_type,
          lifecycle_status: lifecycleStatus,
          status_history: [{
            status: lifecycleStatus,
            changed_at: new Date().toISOString(),
            changed_by: 'system_backfill'
          }],
          quality_score: 80,
          revision_count: 1,
        });

      if (!lifecycleError) {
        newLifecycle++;
        existingLifecycleSet.add(lifecycleKey);
      }
    }
  }

  // Step 7: Final stats
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`New shipment_documents links: ${newLinks}`);
  console.log(`New document_lifecycle records: ${newLifecycle}`);

  const { count: finalLifecycleCount } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });

  const { count: finalLinkCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  console.log(`\nFinal state:`);
  console.log(`  - document_lifecycle: ${initialLifecycleCount} → ${finalLifecycleCount} (+${(finalLifecycleCount || 0) - (initialLifecycleCount || 0)})`);
  console.log(`  - shipment_documents: ${initialLinkCount} → ${finalLinkCount} (+${(finalLinkCount || 0) - (initialLinkCount || 0)})`);

  // Show lifecycle distribution
  const { data: lifecycleStats } = await supabase
    .from('document_lifecycle')
    .select('document_type');

  const docTypeCounts: Record<string, number> = {};
  lifecycleStats?.forEach(l => {
    docTypeCounts[l.document_type] = (docTypeCounts[l.document_type] || 0) + 1;
  });

  console.log('\nDocument Lifecycle by Type:');
  Object.entries(docTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => console.log(`  ${type}: ${count}`));
}

main().catch(console.error);
