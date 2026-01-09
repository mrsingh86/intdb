/**
 * Test Database Patterns Migration
 *
 * Verifies that patterns are correctly stored in database and can be loaded
 * by the new services.
 *
 * Run: npx tsx scripts/test-db-patterns.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// Import the new services
import { ClassificationConfigRepository } from '../lib/repositories/classification-config-repository';
import { SchemaRepository } from '../lib/repositories/schema-repository';

async function testSenderPatterns() {
  console.log('\n=== TESTING SENDER PATTERNS ===\n');

  const repo = new ClassificationConfigRepository(supabase);

  // Test sender detection
  const testEmails = [
    'noreply@maersk.com',
    'booking@cma-cgm.com',
    'info@portsidecustoms.com',
    'test@unknown.com',
    'ops@intoglo.com',
  ];

  for (const email of testEmails) {
    const senderType = await repo.detectSenderType(email);
    console.log(`${email} => ${senderType}`);
  }

  // Get all sender patterns
  const patterns = await repo.getAllSenderPatterns();
  console.log(`\nTotal sender patterns in DB: ${patterns.length}`);
  for (const p of patterns) {
    console.log(`  - ${p.sender_type}: ${p.domains.length} domains`);
  }
}

async function testContentMarkers() {
  console.log('\n=== TESTING CONTENT MARKERS ===\n');

  const repo = new ClassificationConfigRepository(supabase);

  // Test content classification
  const testTexts = [
    'BOOKING CONFIRMATION - Your booking number BKG123456 has been confirmed',
    'ARRIVAL NOTICE - Vessel ETA December 15, 2025 at Port of Los Angeles',
    'COMMERCIAL INVOICE - Invoice No: INV-2025-001 Total Amount: $15,000 USD',
    'Random email content that should not match anything',
  ];

  for (const text of testTexts) {
    const result = await repo.classifyContent(text);
    if (result.matched) {
      console.log(`✓ Matched: ${result.documentType} (${result.confidence}%)`);
      console.log(`  Keywords: ${result.matchedKeywords?.join(', ')}`);
    } else {
      console.log(`✗ No match for: ${text.slice(0, 50)}...`);
    }
  }

  // Get all document types
  const docTypes = await repo.getDocumentTypes();
  console.log(`\nDocument types with markers: ${docTypes.length}`);
  console.log(`  ${docTypes.join(', ')}`);
}

async function testExtractionSchemas() {
  console.log('\n=== TESTING EXTRACTION SCHEMAS ===\n');

  const repo = new SchemaRepository(supabase);

  // Get all schemas
  const schemas = await repo.getAllSchemas();
  console.log(`Total extraction schemas in DB: ${schemas.length}`);

  for (const schema of schemas) {
    const fields = schema.fields as Array<{ name: string; type: string; required: boolean }>;
    console.log(`\n${schema.document_type}:`);
    console.log(`  Version: ${schema.version}`);
    console.log(`  Fields: ${fields.length}`);
    for (const field of fields.slice(0, 5)) {
      console.log(`    - ${field.name} (${field.type})${field.required ? ' *required' : ''}`);
    }
    if (fields.length > 5) {
      console.log(`    ... and ${fields.length - 5} more fields`);
    }
  }

  // Test getting a specific schema
  const bookingSchema = await repo.getSchema('booking_confirmation');
  if (bookingSchema) {
    console.log('\n✓ Successfully loaded booking_confirmation schema');
    const fields = bookingSchema.fields as Array<{ name: string; labelPatterns?: string[] }>;
    const vesselField = fields.find(f => f.name === 'vessel_name');
    if (vesselField) {
      console.log(`  vessel_name field has ${vesselField.labelPatterns?.length || 0} label patterns`);
    }
  } else {
    console.log('\n✗ Failed to load booking_confirmation schema');
  }
}

async function testDatabaseSchemaService() {
  console.log('\n=== TESTING DATABASE SCHEMA SERVICE ===\n');

  // Import dynamically to avoid import order issues
  const { DatabaseSchemaService } = await import('../lib/services/extraction/database-schema-service');

  const service = new DatabaseSchemaService(supabase);

  // Test getting a schema with compiled regex
  const schema = await service.getSchema('booking_confirmation');
  if (schema) {
    console.log('✓ Got compiled schema for booking_confirmation');
    console.log(`  Fields: ${schema.fields.length}`);
    console.log(`  fromDatabase: ${(schema as any).fromDatabase}`);

    // Test that regex patterns are compiled
    const vesselField = schema.fields.find(f => f.name === 'vessel_name');
    if (vesselField && vesselField.labelPatterns.length > 0) {
      const firstPattern = vesselField.labelPatterns[0];
      console.log(`  vessel_name pattern is RegExp: ${firstPattern instanceof RegExp}`);
      console.log(`  Pattern test "VESSEL:" = ${firstPattern.test('VESSEL:')}`);
    }
  } else {
    console.log('✗ Failed to get schema');
  }

  // Test supported document types
  const docTypes = await service.getSupportedDocumentTypes();
  console.log(`\nSupported document types: ${docTypes.length}`);
  console.log(`  ${docTypes.slice(0, 10).join(', ')}${docTypes.length > 10 ? '...' : ''}`);
}

async function testDatabaseClassificationService() {
  console.log('\n=== TESTING DATABASE CLASSIFICATION SERVICE ===\n');

  const { DatabaseClassificationService } = await import('../lib/services/classification/database-classification-service');

  const service = new DatabaseClassificationService(supabase);

  // Test sender detection
  const senderResult = await service.detectSenderType('booking@maersk.com');
  console.log(`Sender detection for booking@maersk.com:`);
  console.log(`  Type: ${senderResult.senderType}`);
  console.log(`  From DB: ${senderResult.fromDatabase}`);

  // Test content classification
  const contentResult = await service.classifyContent('BOOKING CONFIRMATION - Booking Number: BKG123456');
  console.log(`\nContent classification:`);
  console.log(`  Type: ${contentResult.documentType}`);
  console.log(`  Confidence: ${contentResult.confidence}`);
  console.log(`  From DB: ${contentResult.fromDatabase}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('DATABASE PATTERNS MIGRATION TEST');
  console.log('='.repeat(60));

  try {
    await testSenderPatterns();
    await testContentMarkers();
    await testExtractionSchemas();
    await testDatabaseSchemaService();
    await testDatabaseClassificationService();

    console.log('\n' + '='.repeat(60));
    console.log('ALL TESTS COMPLETED');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\nTEST FAILED:', error);
    process.exit(1);
  }
}

main();
