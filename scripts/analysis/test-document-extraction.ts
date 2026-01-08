/**
 * Test Document Type Extraction
 *
 * Tests the document-type-aware extractor on real document samples
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DocumentTypeExtractor,
  ExtractionResult
} from '../../lib/services/extraction/document-type-extractor';
import { getSupportedDocumentTypes } from '../../lib/services/extraction/document-extraction-schemas';

const SAMPLE_DIR = path.join(__dirname, 'document_samples');

interface TestResult {
  filename: string;
  documentType: string;
  success: boolean;
  fieldsExtracted: number;
  partiesExtracted: number;
  tablesExtracted: number;
  confidence: number;
  highlights: string[];
  errors: string[];
}

async function runTests(): Promise<void> {
  console.log('='.repeat(70));
  console.log('DOCUMENT TYPE EXTRACTION TEST');
  console.log('='.repeat(70));
  console.log(`\nSupported document types: ${getSupportedDocumentTypes().join(', ')}`);
  console.log(`\nSample directory: ${SAMPLE_DIR}\n`);

  // Read sample files
  const sampleFiles = fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith('.txt'));
  console.log(`Found ${sampleFiles.length} sample files\n`);

  const extractor = new DocumentTypeExtractor();
  const results: TestResult[] = [];

  for (const filename of sampleFiles) {
    const filepath = path.join(SAMPLE_DIR, filename);
    const content = fs.readFileSync(filepath, 'utf-8');

    // Parse document type from filename
    // Format: {type}_sample_{n}.txt
    const docTypeMatch = filename.match(/^(.+?)_sample_\d+\.txt$/);
    if (!docTypeMatch) {
      console.log(`Skipping ${filename} - doesn't match pattern`);
      continue;
    }

    const documentType = docTypeMatch[1];
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Testing: ${filename}`);
    console.log(`Document Type: ${documentType}`);
    console.log('─'.repeat(70));

    // Run extraction
    const result = extractor.extract(documentType, content);

    if (!result) {
      console.log('❌ No schema found for document type');
      results.push({
        filename,
        documentType,
        success: false,
        fieldsExtracted: 0,
        partiesExtracted: 0,
        tablesExtracted: 0,
        confidence: 0,
        highlights: [],
        errors: ['No schema found'],
      });
      continue;
    }

    // Analyze results
    const testResult = analyzeResult(filename, documentType, result);
    results.push(testResult);

    // Print results
    printExtractionResult(result, testResult);
  }

  // Print summary
  printSummary(results);
}

function analyzeResult(
  filename: string,
  documentType: string,
  result: ExtractionResult
): TestResult {
  const highlights: string[] = [];
  const errors: string[] = [];

  // Count extractions
  const fieldsExtracted = Object.keys(result.fields).length;
  const partiesExtracted = Object.keys(result.parties).length;
  const tablesExtracted = Object.keys(result.tables).length;

  // Highlight key extractions
  if (result.fields['bl_number']) {
    highlights.push(`BL: ${result.fields['bl_number'].value}`);
  }
  if (result.fields['booking_number']) {
    highlights.push(`Booking: ${result.fields['booking_number'].value}`);
  }
  if (result.fields['invoice_number']) {
    highlights.push(`Invoice: ${result.fields['invoice_number'].value}`);
  }
  if (result.fields['eta']) {
    highlights.push(`ETA: ${result.fields['eta'].value}`);
  }
  if (result.fields['etd']) {
    highlights.push(`ETD: ${result.fields['etd'].value}`);
  }
  if (result.fields['total_amount'] || result.fields['total']) {
    const total = result.fields['total_amount'] || result.fields['total'];
    highlights.push(`Total: ${total.value}`);
  }

  // Party highlights
  for (const [key, party] of Object.entries(result.parties)) {
    highlights.push(`${key}: ${party.name}`);
    if (party.country) highlights.push(`  Country: ${party.country}`);
  }

  // Table highlights
  for (const [tableName, rows] of Object.entries(result.tables)) {
    highlights.push(`Table ${tableName}: ${rows.length} rows`);
  }

  // Check for expected fields missing
  if (documentType === 'bill_of_lading' || documentType === 'mbl' || documentType === 'hbl') {
    if (!result.parties['shipper']) errors.push('Missing shipper');
    if (!result.parties['consignee']) errors.push('Missing consignee');
  }

  if (documentType === 'arrival_notice') {
    if (!result.fields['eta']) errors.push('Missing ETA');
    if (!result.fields['last_free_day']) errors.push('Missing LFD');
  }

  if (documentType === 'freight_invoice' || documentType === 'commercial_invoice') {
    if (!result.fields['total_amount'] && !result.fields['total']) {
      errors.push('Missing total amount');
    }
  }

  return {
    filename,
    documentType,
    success: fieldsExtracted > 0 || partiesExtracted > 0,
    fieldsExtracted,
    partiesExtracted,
    tablesExtracted,
    confidence: result.confidence,
    highlights,
    errors,
  };
}

function printExtractionResult(result: ExtractionResult, test: TestResult): void {
  console.log(`\nConfidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`Fields: ${test.fieldsExtracted} | Parties: ${test.partiesExtracted} | Tables: ${test.tablesExtracted}`);

  if (test.highlights.length > 0) {
    console.log('\n📋 Extracted:');
    for (const h of test.highlights) {
      console.log(`  ✓ ${h}`);
    }
  }

  if (test.errors.length > 0) {
    console.log('\n⚠️ Issues:');
    for (const e of test.errors) {
      console.log(`  ✗ ${e}`);
    }
  }

  // Print detailed fields
  if (Object.keys(result.fields).length > 0) {
    console.log('\n📄 All Fields:');
    for (const [name, field] of Object.entries(result.fields)) {
      const conf = (field.confidence * 100).toFixed(0);
      console.log(`  ${name}: ${JSON.stringify(field.value)} (${conf}%)`);
    }
  }

  // Print detailed parties
  if (Object.keys(result.parties).length > 0) {
    console.log('\n👥 Parties:');
    for (const [name, party] of Object.entries(result.parties)) {
      console.log(`  ${name}:`);
      console.log(`    Name: ${party.name}`);
      if (party.addressLine1) console.log(`    Address: ${party.addressLine1}`);
      if (party.city) console.log(`    City: ${party.city}`);
      if (party.country) console.log(`    Country: ${party.country}`);
      if (party.email) console.log(`    Email: ${party.email}`);
    }
  }

  // Print tables
  if (Object.keys(result.tables).length > 0) {
    console.log('\n📊 Tables:');
    for (const [name, rows] of Object.entries(result.tables)) {
      console.log(`  ${name} (${rows.length} rows):`);
      if (rows.length > 0) {
        // Show first 3 rows
        const showRows = rows.slice(0, 3);
        for (const row of showRows) {
          const values = Object.entries(row)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          console.log(`    - ${values}`);
        }
        if (rows.length > 3) {
          console.log(`    ... and ${rows.length - 3} more rows`);
        }
      }
    }
  }
}

function printSummary(results: TestResult[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('EXTRACTION TEST SUMMARY');
  console.log('='.repeat(70));

  const successful = results.filter(r => r.success).length;
  console.log(`\nTotal: ${results.length} | Successful: ${successful} | Failed: ${results.length - successful}`);

  // Group by document type
  const byType = new Map<string, TestResult[]>();
  for (const r of results) {
    const existing = byType.get(r.documentType) || [];
    existing.push(r);
    byType.set(r.documentType, existing);
  }

  console.log('\nBy Document Type:');
  for (const [type, typeResults] of byType.entries()) {
    const typeSuccess = typeResults.filter(r => r.success).length;
    const avgConf = typeResults.reduce((s, r) => s + r.confidence, 0) / typeResults.length;
    const avgFields = typeResults.reduce((s, r) => s + r.fieldsExtracted, 0) / typeResults.length;
    const avgParties = typeResults.reduce((s, r) => s + r.partiesExtracted, 0) / typeResults.length;

    console.log(`  ${type}:`);
    console.log(`    Success: ${typeSuccess}/${typeResults.length}`);
    console.log(`    Avg Confidence: ${(avgConf * 100).toFixed(0)}%`);
    console.log(`    Avg Fields: ${avgFields.toFixed(1)}`);
    console.log(`    Avg Parties: ${avgParties.toFixed(1)}`);
  }

  // List all errors
  const allErrors = results.flatMap(r => r.errors.map(e => `${r.filename}: ${e}`));
  if (allErrors.length > 0) {
    console.log('\n⚠️ All Issues:');
    for (const err of allErrors) {
      console.log(`  - ${err}`);
    }
  }
}

// Run tests
runTests().catch(console.error);
