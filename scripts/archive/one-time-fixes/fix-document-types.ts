/**
 * Fix Document Types in shipment_documents
 *
 * Updates document_type from document_classifications table
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function fixDocumentTypes() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         FIX DOCUMENT TYPES                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipment_documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('id, email_id, document_type');

  console.log(`Total shipment_documents: ${docs?.length}\n`);

  let updated = 0;
  const typeCounts: Record<string, number> = {};

  for (const doc of docs || []) {
    // Get classification for this email
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', doc.email_id)
      .order('confidence_score', { ascending: false })
      .limit(1)
      .single();

    const docType = classification?.document_type || 'unknown';
    typeCounts[docType] = (typeCounts[docType] || 0) + 1;

    // Update if different
    if (doc.document_type !== docType) {
      await supabase
        .from('shipment_documents')
        .update({ document_type: docType })
        .eq('id', doc.id);
      updated++;
    }
  }

  console.log(`Updated ${updated} document types\n`);
  console.log('Document type distribution:');
  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  // Now update shipment statuses based on linked document types
  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('UPDATING SHIPMENT STATUSES:\n');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status, etd, eta');

  let statusUpdated = 0;

  for (const shipment of shipments || []) {
    // Get all linked document types
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .eq('shipment_id', shipment.id);

    const docTypes = linkedDocs?.map(d => d.document_type) || [];

    // Determine status from document types and dates
    let newStatus = 'draft';
    const now = new Date();
    const etd = shipment.etd ? new Date(shipment.etd) : null;
    const eta = shipment.eta ? new Date(shipment.eta) : null;

    if (docTypes.includes('delivery_order')) {
      newStatus = 'delivered';
    } else if (docTypes.includes('arrival_notice')) {
      newStatus = eta && eta < now ? 'arrived' : 'in_transit';
    } else if (docTypes.includes('bill_of_lading')) {
      newStatus = etd && etd < now ? 'in_transit' : 'booked';
    } else if (docTypes.includes('booking_confirmation') || docTypes.includes('booking_amendment')) {
      newStatus = etd && etd < now ? 'in_transit' : 'booked';
    } else if (etd && etd < now) {
      newStatus = 'in_transit';
    } else if (eta && eta < now) {
      newStatus = 'arrived';
    }

    // Update if different
    if (shipment.status !== newStatus) {
      await supabase
        .from('shipments')
        .update({ status: newStatus, status_updated_at: new Date().toISOString() })
        .eq('id', shipment.id);
      console.log(`  ${shipment.booking_number}: ${shipment.status} → ${newStatus}`);
      statusUpdated++;
    }
  }

  console.log(`\nUpdated ${statusUpdated} shipment statuses\n`);

  // Final summary
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('FINAL STATUS DISTRIBUTION:');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const { data: finalShipments } = await supabase
    .from('shipments')
    .select('status');

  const statusCounts: Record<string, number> = {};
  for (const s of finalShipments || []) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  }

  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
}

fixDocumentTypes().catch(console.error);
