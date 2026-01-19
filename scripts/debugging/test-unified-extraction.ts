#!/usr/bin/env npx tsx
/**
 * Test script to verify unified extraction populates entity_extractions for linking
 *
 * This confirms:
 * 1. UnifiedExtractionService extracts entities correctly
 * 2. entity_extractions table is populated (for shipment linking)
 * 3. email_extractions/document_extractions new tables are populated
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function testUnifiedExtraction() {
  console.log('=== Testing Unified Extraction (No AI) ===\n');

  // Find a pending email to test with
  const { data: pendingEmail } = await supabase
    .from('raw_emails')
    .select('id, subject, processing_status')
    .eq('processing_status', 'classified')
    .limit(1)
    .single();

  if (!pendingEmail) {
    console.log('No pending emails found. Looking for a recent processed email to re-test...');

    const { data: processedEmail } = await supabase
      .from('raw_emails')
      .select('id, subject, processing_status')
      .eq('processing_status', 'processed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!processedEmail) {
      console.log('No emails found to test');
      return;
    }

    // Reset status to test processing
    await supabase
      .from('raw_emails')
      .update({ processing_status: 'classified' })
      .eq('id', processedEmail.id);

    console.log(`Reset email ${processedEmail.id.substring(0, 8)} for testing`);
    console.log(`Subject: ${processedEmail.subject?.substring(0, 60)}\n`);

    await testEmail(processedEmail.id);
  } else {
    console.log(`Testing email: ${pendingEmail.id.substring(0, 8)}`);
    console.log(`Subject: ${pendingEmail.subject?.substring(0, 60)}\n`);

    await testEmail(pendingEmail.id);
  }
}

async function testEmail(emailId: string) {
  // Delete existing extractions for clean test
  await supabase.from('entity_extractions').delete().eq('email_id', emailId);
  await supabase.from('email_extractions').delete().eq('email_id', emailId);
  await supabase.from('document_extractions').delete().eq('email_id', emailId);

  console.log('Cleared existing extractions for clean test\n');

  // Initialize orchestrator (without anthropic key!)
  const orchestrator = new EmailProcessingOrchestrator(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
    // NO anthropicKey - AI extraction deprecated
  );
  await orchestrator.initialize();

  console.log('Processing email with UnifiedExtractionService...\n');
  const result = await orchestrator.processEmail(emailId);

  console.log('=== Processing Result ===');
  console.log('  Success:', result.success);
  console.log('  Stage:', result.stage);
  console.log('  Shipment ID:', result.shipmentId || 'none');
  console.log('  Fields extracted:', result.fieldsExtracted || 0);
  if (result.error) console.log('  Error:', result.error);

  // Check entity_extractions (for linking)
  const { data: entityExtractions, count: entityCount } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, extraction_method', { count: 'exact' })
    .eq('email_id', emailId);

  console.log('\n=== entity_extractions (for shipment linking) ===');
  console.log(`Total: ${entityCount || 0} extractions`);
  for (const e of entityExtractions || []) {
    console.log(`  ${e.entity_type}: ${e.entity_value} [${e.extraction_method}]`);
  }

  // Check email_extractions (new table)
  const { count: emailCount } = await supabase
    .from('email_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('email_id', emailId);

  console.log(`\n=== email_extractions (new table): ${emailCount || 0} extractions ===`);

  // Check document_extractions (new table)
  const { count: docCount } = await supabase
    .from('document_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('email_id', emailId);

  console.log(`=== document_extractions (new table): ${docCount || 0} extractions ===`);

  // Verify key identifiers for linking
  console.log('\n=== Linking Identifiers Check ===');
  const linkingTypes = ['booking_number', 'container_number', 'bl_number', 'hbl_number', 'mbl_number'];
  const linkingEntities = entityExtractions?.filter(e => linkingTypes.includes(e.entity_type)) || [];

  if (linkingEntities.length > 0) {
    console.log('Found linking identifiers:');
    for (const e of linkingEntities) {
      console.log(`  ${e.entity_type}: ${e.entity_value}`);
    }
    console.log('\nShipment linking should work correctly.');
  } else {
    console.log('No linking identifiers found (booking_number, container_number, bl_number)');
    console.log('This email may not link to a shipment.');
  }
}

testUnifiedExtraction().catch(console.error);
