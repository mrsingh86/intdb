/**
 * Test Semantic Context Service
 *
 * Verifies the semantic context integration is working correctly.
 * Tests similar emails, sender patterns, and related documents lookup.
 *
 * Run: npx tsx scripts/test-semantic-context.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  createEmbeddingService,
  createSemanticContextService,
} from '../lib/chronicle';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTests() {
  console.log('='.repeat(60));
  console.log('SEMANTIC CONTEXT SERVICE TEST');
  console.log('='.repeat(60));

  // Initialize services
  const embeddingService = createEmbeddingService(supabase);
  const semanticContextService = createSemanticContextService(supabase, embeddingService);

  console.log('\n✓ Services initialized successfully\n');

  // Test 1: Similar emails by text
  console.log('--- Test 1: Similar Emails by Text ---');
  const testSubject = 'Booking Confirmation: 2038256270';
  const testBody = 'Maersk booking confirmed for shipment from INNSA to USNYC';

  try {
    const similarEmails = await semanticContextService.getSimilarEmailsByText(
      testSubject,
      testBody,
      3
    );

    console.log(`Found ${similarEmails.length} similar emails:`);
    for (const email of similarEmails) {
      console.log(`  • [${email.documentType}] ${Math.round(email.similarity * 100)}% - ${email.summary?.slice(0, 60) || email.subject?.slice(0, 60)}`);
    }
    console.log('✓ Test 1 passed\n');
  } catch (error) {
    console.error('✗ Test 1 failed:', error);
  }

  // Test 2: Sender pattern history
  console.log('--- Test 2: Sender Pattern History ---');
  const testSender = 'maersk.com';

  try {
    const senderHistory = await semanticContextService.getSenderPatternHistory(testSender);

    if (senderHistory) {
      console.log(`Sender: @${senderHistory.senderDomain}`);
      console.log(`Total emails: ${senderHistory.totalEmails}`);
      console.log(`Avg confidence: ${senderHistory.avgConfidence}%`);
      console.log('Document type distribution:');
      for (const dt of senderHistory.documentTypes) {
        console.log(`  • ${dt.documentType}: ${dt.percentage}% (${dt.count})`);
      }
    } else {
      console.log('No history found for sender');
    }
    console.log('✓ Test 2 passed\n');
  } catch (error) {
    console.error('✗ Test 2 failed:', error);
  }

  // Test 3: Related shipment documents
  console.log('--- Test 3: Related Shipment Documents ---');

  try {
    // Get a sample booking number from database
    const { data: sample } = await supabase
      .from('chronicle')
      .select('booking_number, mbl_number')
      .not('booking_number', 'is', null)
      .limit(1)
      .single();

    if (sample?.booking_number) {
      const relatedDocs = await semanticContextService.getRelatedShipmentDocs(
        sample.booking_number,
        sample.mbl_number
      );

      console.log(`Booking: ${sample.booking_number}`);
      console.log(`Found ${relatedDocs.length} related documents:`);
      for (const doc of relatedDocs) {
        console.log(`  • [${doc.documentType}] from ${doc.fromParty}: ${doc.summary?.slice(0, 50) || ''}`);
      }
    } else {
      console.log('No sample booking found in database');
    }
    console.log('✓ Test 3 passed\n');
  } catch (error) {
    console.error('✗ Test 3 failed:', error);
  }

  // Test 4: Full context for new email
  console.log('--- Test 4: Full Context for New Email ---');

  try {
    const context = await semanticContextService.getContextForNewEmail(
      'SI Confirmation: 2038256270',
      'Your shipping instructions have been confirmed for vessel EMMA MAERSK',
      'donotreply@maersk.com',
      '2038256270',
      null
    );

    console.log('Context retrieved:');
    console.log(`  Similar emails: ${context.similarEmails.length}`);
    console.log(`  Sender history: ${context.senderHistory ? 'Yes' : 'No'}`);
    console.log(`  Related docs: ${context.relatedDocs.length}`);

    // Test prompt section building
    const promptSection = semanticContextService.buildPromptSection(context);
    if (promptSection) {
      console.log('\nGenerated prompt section:');
      console.log(promptSection.slice(0, 500) + (promptSection.length > 500 ? '...' : ''));
    } else {
      console.log('\nNo prompt section generated (no context found)');
    }
    console.log('✓ Test 4 passed\n');
  } catch (error) {
    console.error('✗ Test 4 failed:', error);
  }

  // Summary
  console.log('='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
  console.log('\nThe SemanticContextService is now integrated into ChronicleService.');
  console.log('When AI Analyzer runs, it will automatically receive:');
  console.log('  1. Similar emails (by content similarity)');
  console.log('  2. Sender history (document type patterns)');
  console.log('  3. Related shipment docs (by booking/MBL)');
  console.log('\nThis context helps AI make better classification decisions.');
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
