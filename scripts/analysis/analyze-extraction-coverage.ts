#!/usr/bin/env npx tsx
/**
 * Analyze Entity Extraction Coverage Across All Document Types
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

async function analyze() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          ENTITY EXTRACTION COVERAGE ANALYSIS                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all classifications
  const { data: classifications, error: classError } = await supabase
    .from('document_classifications')
    .select('document_type, email_id, confidence_score');

  if (classError) {
    console.error('Error fetching classifications:', classError);
    return;
  }

  // Get all extractions
  const { data: extractions, error: extractError } = await supabase
    .from('entity_extractions')
    .select('email_id, source_document_type, entity_type');

  if (extractError) {
    console.error('Error fetching extractions:', extractError);
    return;
  }

  // Count by document type
  const byType: Record<string, number> = {};
  classifications?.forEach(c => {
    byType[c.document_type] = (byType[c.document_type] || 0) + 1;
  });

  // Count extractions by email
  const extractedEmails = new Set(extractions?.map(e => e.email_id));

  // Count extractions by document type
  const extractionsByType: Record<string, number> = {};
  classifications?.forEach(c => {
    if (extractedEmails.has(c.email_id)) {
      extractionsByType[c.document_type] = (extractionsByType[c.document_type] || 0) + 1;
    }
  });

  console.log('DOCUMENT TYPE DISTRIBUTION:');
  console.log('═'.repeat(70));
  console.log('Type'.padEnd(35) + 'Total'.padStart(8) + 'Extracted'.padStart(12) + 'Coverage'.padStart(15));
  console.log('─'.repeat(70));

  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  let totalEmails = 0;
  let totalExtracted = 0;

  sorted.forEach(([type, total]) => {
    const extracted = extractionsByType[type] || 0;
    const pct = ((extracted / total) * 100).toFixed(1);
    const status = extracted > 0 ? '✓' : '✗';
    console.log(
      `${status} ${type.padEnd(32)} ${total.toString().padStart(6)} ${extracted.toString().padStart(10)}    ${pct.padStart(5)}%`
    );
    totalEmails += total;
    totalExtracted += extracted;
  });

  console.log('─'.repeat(70));
  const overallPct = ((totalExtracted / totalEmails) * 100).toFixed(1);
  console.log(`TOTAL`.padEnd(35) + totalEmails.toString().padStart(6) + totalExtracted.toString().padStart(10) + `    ${overallPct.padStart(5)}%`);
  console.log('═'.repeat(70));

  // Show gap analysis
  console.log('\n\nGAP ANALYSIS - Document Types Without Extraction:');
  console.log('═'.repeat(70));

  const noExtraction = sorted.filter(([type, _]) => !extractionsByType[type] || extractionsByType[type] === 0);

  if (noExtraction.length === 0) {
    console.log('✓ All document types have some extraction coverage!');
  } else {
    noExtraction.forEach(([type, count]) => {
      console.log(`✗ ${type.padEnd(35)} ${count} emails (0% coverage)`);
    });
    console.log(`\nTotal emails without extraction: ${noExtraction.reduce((sum, [_, count]) => sum + count, 0)}`);
  }

  // Show which document types should be extractable
  console.log('\n\nEXTRACTABLE DOCUMENT TYPES (per run-entity-extraction.ts):');
  console.log('═'.repeat(70));

  const EXTRACTABLE_TYPES = [
    'booking_confirmation',
    'shipping_instruction',
    'si_draft',
    'bill_of_lading',
    'arrival_notice',
    'vgm_confirmation',
    'packing_list',
    'commercial_invoice'
  ];

  EXTRACTABLE_TYPES.forEach(type => {
    const total = byType[type] || 0;
    const extracted = extractionsByType[type] || 0;
    const pct = total > 0 ? ((extracted / total) * 100).toFixed(1) : '0.0';
    const status = extracted > 0 ? '✓' : '✗';
    console.log(`${status} ${type.padEnd(35)} ${total.toString().padStart(6)} ${extracted.toString().padStart(10)}    ${pct.padStart(5)}%`);
  });

  // Show recommendations
  console.log('\n\nRECOMMENDATIONS:');
  console.log('═'.repeat(70));

  const extractableWithNoData = EXTRACTABLE_TYPES.filter(type => {
    const total = byType[type] || 0;
    const extracted = extractionsByType[type] || 0;
    return total > 0 && extracted === 0;
  });

  const extractableWithLowCoverage = EXTRACTABLE_TYPES.filter(type => {
    const total = byType[type] || 0;
    const extracted = extractionsByType[type] || 0;
    return total > 0 && extracted > 0 && (extracted / total) < 0.5;
  });

  if (extractableWithNoData.length > 0) {
    console.log(`\n1. RUN EXTRACTION ON THESE TYPES (${extractableWithNoData.length} types with 0% coverage):`);
    extractableWithNoData.forEach(type => {
      console.log(`   - ${type} (${byType[type]} emails)`);
    });
  }

  if (extractableWithLowCoverage.length > 0) {
    console.log(`\n2. IMPROVE EXTRACTION FOR THESE TYPES (${extractableWithLowCoverage.length} types with <50% coverage):`);
    extractableWithLowCoverage.forEach(type => {
      const total = byType[type];
      const extracted = extractionsByType[type];
      const pct = ((extracted / total) * 100).toFixed(1);
      console.log(`   - ${type} (${extracted}/${total} = ${pct}%)`);
    });
  }

  // Count potential new extractions
  const potentialNewExtractions = EXTRACTABLE_TYPES.reduce((sum, type) => {
    const total = byType[type] || 0;
    const extracted = extractionsByType[type] || 0;
    return sum + (total - extracted);
  }, 0);

  console.log(`\n3. POTENTIAL IMPACT:`);
  console.log(`   Current coverage: ${totalExtracted}/${totalEmails} emails (${overallPct}%)`);
  console.log(`   Extractable types have: ${potentialNewExtractions} unprocessed emails`);
  console.log(`   If all extractable types processed: ${totalExtracted + potentialNewExtractions}/${totalEmails} emails (${(((totalExtracted + potentialNewExtractions) / totalEmails) * 100).toFixed(1)}%)`);
}

analyze().catch(console.error);
