/**
 * Trace Pipeline Flow - Shows how data flows through the system
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function traceOneEmail() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('TRACING ONE EMAIL THROUGH COMPLETE PIPELINE');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Find a shipment with complete data
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .not('shipper_id', 'is', null)
    .not('consignee_id', 'is', null)
    .not('created_from_email_id', 'is', null)
    .limit(1)
    .single();

  if (!shipment) {
    console.log('No complete shipment found');
    return;
  }

  console.log('═══ STAGE 1: RAW EMAIL ═══');
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, sender_email, processing_status, received_at')
    .eq('id', shipment.created_from_email_id)
    .single();

  if (email) {
    console.log('Email ID:', email.id);
    console.log('Subject:', (email.subject || '').substring(0, 60) + '...');
    console.log('From:', email.sender_email);
    console.log('Status:', email.processing_status);
    console.log('Received:', email.received_at);
  }

  console.log('\n           ↓ Classified');
  console.log('═══ STAGE 2: CLASSIFICATION ═══');
  const { data: classification } = await supabase
    .from('document_classifications')
    .select('document_type, confidence_score, classification_reason')
    .eq('email_id', shipment.created_from_email_id)
    .single();

  if (classification) {
    console.log('Document Type:', classification.document_type);
    console.log('Confidence:', classification.confidence_score);
    console.log('Reason:', (classification.classification_reason || '').substring(0, 60));
  }

  console.log('\n           ↓ Entities Extracted');
  console.log('═══ STAGE 3: ENTITY EXTRACTION ═══');
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .eq('shipment_id', shipment.id)
    .limit(10);

  if (entities && entities.length > 0) {
    entities.forEach(e => console.log('  ' + e.entity_type + ':', (e.entity_value || '').substring(0, 40)));
  } else {
    console.log('  (Entities linked via email_id)');
  }

  console.log('\n           ↓ Shipment Created/Updated');
  console.log('═══ STAGE 4: SHIPMENT ═══');
  console.log('Shipment ID:', shipment.id);
  console.log('Booking #:', shipment.booking_number);
  console.log('BL #:', shipment.bl_number);
  console.log('Vessel:', shipment.vessel_name, shipment.voyage_number);
  console.log('POL:', shipment.port_of_loading);
  console.log('POD:', shipment.port_of_discharge);
  console.log('ETD:', shipment.etd);
  console.log('ETA:', shipment.eta);
  console.log('Workflow:', shipment.workflow_state);
  console.log('Shipper ID:', shipment.shipper_id);
  console.log('Consignee ID:', shipment.consignee_id);

  console.log('\n           ↓ Stakeholders Linked');
  console.log('═══ STAGE 5: STAKEHOLDERS ═══');

  if (shipment.shipper_id) {
    const { data: shipper } = await supabase
      .from('parties')
      .select('party_name, party_type, is_customer')
      .eq('id', shipment.shipper_id)
      .single();
    console.log('SHIPPER:', shipper?.party_name);
    console.log('  Type:', shipper?.party_type);
    console.log('  Is Customer:', shipper?.is_customer);
  }

  if (shipment.consignee_id) {
    const { data: consignee } = await supabase
      .from('parties')
      .select('party_name, party_type, is_customer')
      .eq('id', shipment.consignee_id)
      .single();
    console.log('CONSIGNEE:', consignee?.party_name);
    console.log('  Type:', consignee?.party_type);
    console.log('  Is Customer:', consignee?.is_customer);
  }

  console.log('\n           ↓ Document Lifecycle Created');
  console.log('═══ STAGE 6: DOCUMENT LIFECYCLE ═══');
  const { data: lifecycles } = await supabase
    .from('document_lifecycle')
    .select('document_type, lifecycle_status, quality_score')
    .eq('shipment_id', shipment.id);

  if (lifecycles && lifecycles.length > 0) {
    lifecycles.forEach(l =>
      console.log('  ' + l.document_type + ': ' + l.lifecycle_status + ' (quality: ' + (l.quality_score || 'N/A') + ')')
    );
  }

  // Also show linked documents
  console.log('\n═══ LINKED DOCUMENTS ═══');
  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('document_type, linked_at')
    .eq('shipment_id', shipment.id);

  if (shipmentDocs && shipmentDocs.length > 0) {
    shipmentDocs.forEach(d => console.log('  ' + d.document_type + ' (linked:', d.linked_at + ')'));
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('PIPELINE COMPLETE ✓');
  console.log('════════════════════════════════════════════════════════════════════');
}

traceOneEmail().catch(console.error);
