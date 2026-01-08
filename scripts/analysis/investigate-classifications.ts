/**
 * Investigate Classification Data Structure
 * Check if reclassification persisted and understand available fields
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CLASSIFICATION DATA INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Get sample record with all columns
  console.log('1. CHECKING TABLE STRUCTURE...\n');

  const { data: sample, error: sampleError } = await supabase
    .from('document_classifications')
    .select('*')
    .limit(1);

  if (sampleError) {
    console.error('Error fetching sample:', sampleError);
    return;
  }

  if (!sample || sample.length === 0) {
    console.log('No records found');
    return;
  }

  console.log('Available columns:');
  const columns = Object.keys(sample[0]);
  columns.forEach(col => {
    const val = sample[0][col];
    const type = val === null ? 'null' : typeof val;
    console.log(`  - ${col}: ${type}`);
  });

  // 2. Check what classification fields are populated
  console.log('\n2. CHECKING CLASSIFICATION FIELDS...\n');

  const { data: stats, error: statsError } = await supabase
    .from('document_classifications')
    .select('document_type, email_type, sender_party_type, document_direction, confidence_score')
    .not('document_type', 'is', null)
    .limit(100);

  if (stats) {
    // Check which fields are populated
    const fieldCounts = {
      document_type: 0,
      email_type: 0,
      sender_party_type: 0,
      document_direction: 0,
      confidence_score: 0,
    };

    for (const row of stats) {
      if (row.document_type) fieldCounts.document_type++;
      if (row.email_type) fieldCounts.email_type++;
      if (row.sender_party_type) fieldCounts.sender_party_type++;
      if (row.document_direction) fieldCounts.document_direction++;
      if (row.confidence_score) fieldCounts.confidence_score++;
    }

    console.log('Field population (out of 100 samples):');
    Object.entries(fieldCounts).forEach(([field, count]) => {
      console.log(`  - ${field}: ${count}/100`);
    });
  }

  // 3. Check document type distribution with email_type
  console.log('\n3. DOCUMENT TYPE + EMAIL TYPE DISTRIBUTION...\n');

  const { data: distData, error: distError } = await supabase
    .from('document_classifications')
    .select('document_type, email_type, sender_party_type, document_direction')
    .not('document_type', 'is', null)
    .not('document_type', 'eq', 'unknown')
    .limit(2000);

  if (distData) {
    const distribution = new Map<string, number>();

    for (const row of distData) {
      const key = `${row.document_type} | ${row.email_type || 'null'} | ${row.sender_party_type || 'null'} | ${row.document_direction || 'null'}`;
      distribution.set(key, (distribution.get(key) || 0) + 1);
    }

    const sorted = Array.from(distribution.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

    console.log('Top 30 (document_type | email_type | sender_party | direction):');
    sorted.forEach(([key, count]) => {
      console.log(`  ${count.toString().padStart(4)} | ${key}`);
    });
  }

  // 4. Check a few samples of different document types
  console.log('\n4. SAMPLE EMAILS BY DOCUMENT TYPE...\n');

  const docTypes = ['booking_confirmation', 'arrival_notice', 'payment_receipt', 'invoice'];

  for (const docType of docTypes) {
    const { data: samples } = await supabase
      .from('document_classifications')
      .select(`
        document_type,
        email_type,
        sender_party_type,
        confidence_score,
        raw_emails!inner (
          subject,
          sender_email
        )
      `)
      .eq('document_type', docType)
      .limit(3);

    console.log(`\n--- ${docType.toUpperCase()} ---`);
    if (samples) {
      samples.forEach((s: any, i: number) => {
        console.log(`  ${i + 1}. Subject: ${s.raw_emails?.subject?.substring(0, 80)}...`);
        console.log(`     Sender: ${s.raw_emails?.sender_email}`);
        console.log(`     Email Type: ${s.email_type}, Party: ${s.sender_party_type}, Conf: ${s.confidence_score}`);
      });
    }
  }

  // 5. Check if there's a classification_output or metadata field
  console.log('\n5. CHECKING FOR ENHANCED CLASSIFICATION DATA...\n');

  const jsonFields = columns.filter(c =>
    c.includes('metadata') || c.includes('output') || c.includes('context') || c.includes('json')
  );

  if (jsonFields.length > 0) {
    console.log('Found potential JSON/metadata fields:', jsonFields);

    const { data: jsonSample } = await supabase
      .from('document_classifications')
      .select(jsonFields.join(', '))
      .not(jsonFields[0], 'is', null)
      .limit(1);

    if (jsonSample && jsonSample[0]) {
      console.log('Sample JSON data:');
      console.log(JSON.stringify(jsonSample[0], null, 2));
    }
  } else {
    console.log('No JSON/metadata fields found in table');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  INVESTIGATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
