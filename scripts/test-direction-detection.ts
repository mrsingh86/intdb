/**
 * Test Direction Detection Service against real database data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  DirectionDetectionService,
  extractTrueSender,
  isIntogloDomain,
  isCarrierDomain,
  extractDomain,
} from '../lib/services/direction-detection';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const service = new DirectionDetectionService();

async function main() {
  console.log('='.repeat(70));
  console.log('DIRECTION DETECTION SERVICE - TEST AGAINST REAL DATA');
  console.log('='.repeat(70));

  // Test 1: Unit tests for true sender extraction
  console.log('\n--- TEST 1: True Sender Extraction ---\n');

  const testCases = [
    {
      sender: "'CMA CGM Website' via pricing <pricing@intoglo.com>",
      expected: 'cma-cgm.com',
    },
    {
      sender: "coscon via Operations Intoglo <ops@intoglo.com>",
      expected: 'coscon.com',
    },
    {
      sender: "'NUR KHAN' via Operations Intoglo <ops@intoglo.com>",
      expected: 'unknown', // Unknown external party
    },
    {
      sender: "CENFACTNOREPL via North America <nam@intoglo.com>",
      expected: 'maersk.com', // CENFACT is Maersk
    },
    {
      sender: "in.export@maersk.com",
      expected: 'maersk.com',
    },
    {
      sender: "ops@intoglo.com",
      expected: 'intoglo.com',
    },
  ];

  for (const tc of testCases) {
    const result = extractTrueSender(tc.sender);
    const status = result.trueSenderDomain.includes(tc.expected) ? '✓' : '✗';
    console.log(`${status} "${tc.sender.substring(0, 50)}..."`);
    console.log(`   → True sender: ${result.trueSender} (${result.method})`);
    console.log(`   → Expected domain: ${tc.expected}, Got: ${result.trueSenderDomain}`);
  }

  // Test 2: Fetch real emails and compare with existing directions
  console.log('\n--- TEST 2: Real Email Comparison ---\n');

  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      gmail_message_id,
      sender_email,
      sender_name,
      true_sender_email,
      subject,
      email_direction,
      headers
    `)
    .limit(100);

  if (error) {
    console.error('Error fetching emails:', error.message);
    return;
  }

  let matches = 0;
  let mismatches = 0;
  const mismatchSamples: any[] = [];

  for (const email of emails || []) {
    const newResult = service.detectDirection({
      senderEmail: email.sender_email,
      senderName: email.sender_name,
      trueSenderEmail: email.true_sender_email,
      subject: email.subject,
      headers: email.headers,
    });

    if (email.email_direction === newResult.direction) {
      matches++;
    } else {
      mismatches++;
      if (mismatchSamples.length < 10) {
        mismatchSamples.push({
          sender: email.sender_email,
          trueSender: email.true_sender_email,
          subject: email.subject?.substring(0, 50),
          existingDir: email.email_direction,
          newDir: newResult.direction,
          reasoning: newResult.reasoning,
        });
      }
    }
  }

  console.log(`Matches: ${matches}/${emails?.length} (${((matches / (emails?.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`Mismatches: ${mismatches}/${emails?.length}`);

  if (mismatchSamples.length > 0) {
    console.log('\nSample mismatches:');
    for (const sample of mismatchSamples) {
      console.log(`\n  Sender: ${sample.sender}`);
      console.log(`  True sender: ${sample.trueSender || 'N/A'}`);
      console.log(`  Subject: ${sample.subject}...`);
      console.log(`  Existing: ${sample.existingDir} → New: ${sample.newDir}`);
      console.log(`  Reason: ${sample.reasoning}`);
    }
  }

  // Test 3: Check document direction alignment
  console.log('\n--- TEST 3: Document Direction Alignment ---\n');

  const { data: docs } = await supabase
    .from('document_classifications')
    .select(`
      id,
      email_id,
      document_type,
      document_direction,
      raw_emails!inner(
        sender_email,
        sender_name,
        true_sender_email,
        subject,
        email_direction,
        headers
      )
    `)
    .limit(200);

  let docMatches = 0;
  let docMismatches = 0;
  const docMismatchSamples: any[] = [];

  for (const doc of docs || []) {
    const email = doc.raw_emails as any;
    const newResult = service.detectDirection({
      senderEmail: email.sender_email,
      senderName: email.sender_name,
      trueSenderEmail: email.true_sender_email,
      subject: email.subject,
      headers: email.headers,
    });

    const emailMatches = email.email_direction === newResult.direction;
    const docDirectionMatches = doc.document_direction === newResult.direction;

    if (emailMatches && docDirectionMatches) {
      docMatches++;
    } else {
      docMismatches++;
      if (docMismatchSamples.length < 5) {
        docMismatchSamples.push({
          docType: doc.document_type,
          sender: email.sender_email,
          trueSender: email.true_sender_email,
          emailDir: email.email_direction,
          docDir: doc.document_direction,
          newDir: newResult.direction,
          reasoning: newResult.reasoning,
        });
      }
    }
  }

  console.log(`Full alignment: ${docMatches}/${docs?.length} (${((docMatches / (docs?.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`Misalignments: ${docMismatches}/${docs?.length}`);

  if (docMismatchSamples.length > 0) {
    console.log('\nSample misalignments:');
    for (const sample of docMismatchSamples) {
      console.log(`\n  Doc type: ${sample.docType}`);
      console.log(`  Sender: ${sample.sender}`);
      console.log(`  True sender: ${sample.trueSender || 'N/A'}`);
      console.log(`  Email dir: ${sample.emailDir} | Doc dir: ${sample.docDir} | New: ${sample.newDir}`);
      console.log(`  Reason: ${sample.reasoning}`);
    }
  }

  // Test 4: "Via" pattern emails specifically
  console.log('\n--- TEST 4: Via Pattern Emails ---\n');

  const { data: viaEmails } = await supabase
    .from('raw_emails')
    .select('sender_email, sender_name, true_sender_email, subject, email_direction, headers')
    .ilike('sender_email', '%via%')
    .limit(20);

  console.log(`Found ${viaEmails?.length || 0} "via" pattern emails`);

  for (const email of viaEmails || []) {
    const result = service.detectDirection({
      senderEmail: email.sender_email,
      senderName: email.sender_name,
      trueSenderEmail: email.true_sender_email,
      subject: email.subject,
      headers: email.headers,
    });

    const status = email.email_direction === result.direction ? '✓' : '✗';
    console.log(`\n${status} "${email.sender_email.substring(0, 60)}..."`);
    console.log(`   True sender extracted: ${result.trueSender}`);
    console.log(`   Existing: ${email.email_direction} | New: ${result.direction}`);
    console.log(`   Reason: ${result.reasoning}`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`\nEmail direction accuracy with new service: ${((matches / (emails?.length || 1)) * 100).toFixed(1)}%`);
  console.log(`Full email+doc alignment: ${((docMatches / (docs?.length || 1)) * 100).toFixed(1)}%`);
  console.log(`\nRecommendation: ${mismatches > 10 ? 'Backfill required' : 'Minor updates needed'}`);
}

main().catch(console.error);
