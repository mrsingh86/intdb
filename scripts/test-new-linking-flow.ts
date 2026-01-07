#!/usr/bin/env npx tsx
/**
 * Test script to verify new linking flow uses email_extractions table
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function testNewLinkingFlow() {
  console.log('=== Testing New Linking Flow (email_extractions) ===\n');

  // Find an email that has linking identifiers in email_extractions
  const { data: emailWithExtractions } = await supabase
    .from('email_extractions')
    .select('email_id, entity_type, entity_value')
    .in('entity_type', ['booking_number', 'container_number', 'bl_number', 'hbl_number'])
    .limit(10);

  if (!emailWithExtractions || emailWithExtractions.length === 0) {
    console.log('No emails with linking identifiers in email_extractions');
    console.log('Run backfill first: npx tsx scripts/backfill-entity-extractions.ts --limit 100');
    return;
  }

  // Group by email_id
  const emailIds = [...new Set(emailWithExtractions.map(e => e.email_id))];
  const emailId = emailIds[0];

  console.log('Testing with email:', emailId.substring(0, 8));
  console.log('\nEntities in email_extractions:');
  for (const e of emailWithExtractions.filter(x => x.email_id === emailId)) {
    console.log(`  ${e.entity_type}: ${e.entity_value}`);
  }

  // Get email details
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, processing_status')
    .eq('id', emailId)
    .single();

  console.log('\nSubject:', email?.subject?.substring(0, 60));
  console.log('Current status:', email?.processing_status);

  // Reset status for re-test
  await supabase
    .from('raw_emails')
    .update({ processing_status: 'classified' })
    .eq('id', emailId);

  // Initialize orchestrator and process
  const orchestrator = new EmailProcessingOrchestrator(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await orchestrator.initialize();

  console.log('\nProcessing email with new linking flow...');
  const result = await orchestrator.processEmail(emailId);

  console.log('\n=== Result ===');
  console.log('Success:', result.success);
  console.log('Stage:', result.stage);
  console.log('Shipment ID:', result.shipmentId || '(none - orphan document)');
  if (result.error) console.log('Error:', result.error);

  // Check if linked via shipment_documents
  const { data: shipmentDoc } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type')
    .eq('email_id', emailId)
    .single();

  if (shipmentDoc?.shipment_id) {
    console.log('\n✅ Linked to shipment:', shipmentDoc.shipment_id);
    console.log('Document type:', shipmentDoc.document_type);

    // Get shipment details
    const { data: shipment } = await supabase
      .from('shipments')
      .select('booking_number, vessel_name, etd')
      .eq('id', shipmentDoc.shipment_id)
      .single();

    if (shipment) {
      console.log('Shipment booking:', shipment.booking_number);
    }
  } else {
    console.log('\n⚠️ Not linked to any shipment (orphan document)');
    console.log('This is expected if no matching shipment exists for the extracted identifiers.');
  }

  // Verify no writes to old entity_extractions table
  const { count: oldTableCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('email_id', emailId);

  console.log('\n=== Isolation Check ===');
  console.log('entity_extractions (OLD) for this email:', oldTableCount || 0);

  const { count: newTableCount } = await supabase
    .from('email_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('email_id', emailId);

  console.log('email_extractions (NEW) for this email:', newTableCount || 0);

  if ((oldTableCount || 0) === 0 && (newTableCount || 0) > 0) {
    console.log('\n✅ Successfully isolated from old entity_extractions table!');
  }
}

testNewLinkingFlow().catch(console.error);
