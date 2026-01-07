#!/usr/bin/env npx tsx
/**
 * Debug extraction to understand why document_extractions = 0
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  createUnifiedExtractionService,
  getSupportedDocumentTypes,
  extractFromDocument,
} from '../lib/services/extraction';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function debug() {
  console.log('=== Debugging Document Extraction ===\n');

  // 1. Check supported document types
  const supported = getSupportedDocumentTypes();
  console.log('Supported document types:', supported.length);
  console.log(supported.slice(0, 10).join(', ') + '...\n');

  // 2. Find an arrival_notice with PDF (we know this schema exists)
  const { data: email } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      body_text,
      document_classifications!inner(document_type),
      raw_attachments!inner(id, filename, extracted_text)
    `)
    .eq('document_classifications.document_type', 'arrival_notice')
    .not('raw_attachments.extracted_text', 'is', null)
    .limit(1)
    .single();

  if (!email) {
    console.log('No arrival_notice with PDF found');
    return;
  }

  console.log('Found email:', email.id.substring(0, 8));
  console.log('Subject:', email.subject?.substring(0, 60));

  const att = (email.raw_attachments as any[])?.[0];
  const docType = (email.document_classifications as any[])?.[0]?.document_type;

  console.log('Document type:', docType);
  console.log('Attachment:', att?.filename);
  console.log('OCR text length:', att?.extracted_text?.length);

  // 3. Test schema extraction directly
  console.log('\n--- Testing schema extraction ---');
  const schemaResult = extractFromDocument(docType, att?.extracted_text || '');

  if (schemaResult) {
    console.log('Schema extraction SUCCESS');
    console.log('  Confidence:', schemaResult.confidence);
    console.log('  Fields extracted:', Object.keys(schemaResult.fields).length);
    console.log('  Parties extracted:', Object.keys(schemaResult.parties).length);
    console.log('  Tables extracted:', Object.keys(schemaResult.tables).length);

    // Show some fields
    console.log('\n  Sample fields:');
    for (const [k, v] of Object.entries(schemaResult.fields).slice(0, 5)) {
      console.log(`    ${k}: ${String(v.value).substring(0, 50)}`);
    }
  } else {
    console.log('Schema extraction returned NULL - no schema for', docType);
  }

  // 4. Test unified extraction service
  console.log('\n--- Testing UnifiedExtractionService ---');
  const service = createUnifiedExtractionService(supabase);
  const result = await service.extract({
    emailId: email.id,
    attachmentId: att?.id,
    documentType: docType,
    emailSubject: email.subject || '',
    emailBody: email.body_text || '',
    pdfContent: att?.extracted_text || '',
  });

  console.log('Unified extraction result:');
  console.log('  Success:', result.success);
  console.log('  Email extractions saved:', result.emailExtractions);
  console.log('  Document extractions saved:', result.documentExtractions);
  console.log('  Schema confidence:', result.schemaConfidence);
  console.log('  Total unique entities:', Object.keys(result.entities).length);

  if (result.errors && result.errors.length > 0) {
    console.log('  Errors:', result.errors);
  }

  // 5. Check database
  console.log('\n--- Checking database ---');
  const { count: emailCount } = await supabase
    .from('email_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('email_id', email.id);

  const { count: docCount } = await supabase
    .from('document_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('email_id', email.id);

  console.log('  email_extractions for this email:', emailCount);
  console.log('  document_extractions for this email:', docCount);
}

debug().catch(console.error);
