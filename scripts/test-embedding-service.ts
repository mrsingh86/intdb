/**
 * Test Script: Embedding Service
 *
 * Tests the vector embedding and semantic search functionality.
 * Run with: npx tsx scripts/test-embedding-service.ts
 *
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 * - Migration 062 applied (gte-small 384 dimensions)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createEmbeddingService } from '../lib/chronicle/embedding-service';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Use service role key for Edge Function calls (has elevated permissions)
const SUPABASE_EDGE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

async function testDatabaseSetup(): Promise<boolean> {
  console.log('\n[TEST 1] Database Setup Verification');
  console.log('-'.repeat(50));

  // Check embedding column exists
  const { data: extCheck } = await supabase
    .from('chronicle')
    .select('embedding')
    .limit(1);

  if (extCheck === null) {
    console.log('FAIL: Cannot query embedding column - migration may not be applied');
    return false;
  }

  console.log('PASS: Embedding column exists');

  // Check count
  const { count } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true });

  console.log(`INFO: Chronicle table has ${count} records`);

  return true;
}

async function testEdgeFunction(): Promise<boolean> {
  console.log('\n[TEST 2] Edge Function Test');
  console.log('-'.repeat(50));

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_EDGE_KEY}`,
        },
        body: JSON.stringify({ text: 'booking confirmation for container shipment' }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`FAIL: Edge function returned ${response.status}: ${errorText}`);
      return false;
    }

    const data = await response.json();

    if (!data.embedding || !Array.isArray(data.embedding)) {
      console.log('FAIL: Edge function did not return embedding array');
      return false;
    }

    console.log(`PASS: Edge function returned embedding with ${data.embedding.length} dimensions`);

    if (data.embedding.length !== 384) {
      console.log(`WARN: Expected 384 dimensions, got ${data.embedding.length}`);
    }

    return true;
  } catch (error) {
    console.log(`FAIL: Edge function error: ${error}`);
    return false;
  }
}

async function testEmbeddingGeneration(): Promise<boolean> {
  console.log('\n[TEST 3] Embedding Generation');
  console.log('-'.repeat(50));

  const embeddingService = createEmbeddingService(supabase, {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_EDGE_KEY,
  });

  // Get a few records without embeddings
  const { data: records } = await supabase
    .from('chronicle')
    .select('id, subject, document_type')
    .is('embedding', null)
    .not('subject', 'is', null)
    .limit(3);

  if (!records || records.length === 0) {
    console.log('WARN: No records without embeddings found');
    return true;
  }

  console.log(`Found ${records.length} records to test:`);
  for (const r of records) {
    console.log(`  - [${r.document_type}] ${r.subject?.substring(0, 50)}...`);
  }

  // Generate embeddings
  console.log('\nGenerating embeddings...');
  const results = await embeddingService.generateEmbeddingsBatch(records.map(r => r.id));

  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;

  console.log(`PASS: Generated ${successes} embeddings`);
  if (failures > 0) {
    console.log(`WARN: Failed ${failures}`);
    results.filter(r => !r.success).forEach(r => console.log(`  Error: ${r.error}`));
  }

  // Verify stored
  const { data: verified } = await supabase
    .from('chronicle')
    .select('id, embedding_generated_at')
    .in('id', records.map(r => r.id))
    .not('embedding', 'is', null);

  console.log(`PASS: Verified ${verified?.length || 0} embeddings stored in database`);

  return successes > 0;
}

async function testSemanticSearch(): Promise<boolean> {
  console.log('\n[TEST 4] Semantic Search');
  console.log('-'.repeat(50));

  const embeddingService = createEmbeddingService(supabase, {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_EDGE_KEY,
  });

  // Check if we have any embeddings to search
  const { count } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null);

  if (!count || count === 0) {
    console.log('WARN: No embeddings in database yet - skipping search test');
    console.log('      Run this script again after generating more embeddings');
    return true;
  }

  console.log(`Found ${count} records with embeddings`);

  // Test global search
  const searchQueries = [
    'booking confirmation',
    'VGM submission',
    'arrival notice',
    'invoice payment',
  ];

  for (const query of searchQueries) {
    console.log(`\nSearching: "${query}"`);
    const results = await embeddingService.searchGlobal(query, { limit: 3 });

    if (results.length === 0) {
      console.log('  No results found (similarity threshold may be too high)');
    } else {
      for (const r of results) {
        console.log(`  MATCH: [${r.documentType}] ${r.subject?.substring(0, 40)}... (${(r.similarity * 100).toFixed(1)}%)`);
      }
    }
  }

  return true;
}

async function testBackfill(): Promise<boolean> {
  console.log('\n[TEST 5] Backfill Capability');
  console.log('-'.repeat(50));

  const embeddingService = createEmbeddingService(supabase, {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_EDGE_KEY,
  });

  const unembeddedCount = await embeddingService.getUnembeddedCount();
  console.log(`Records without embeddings: ${unembeddedCount}`);

  if (unembeddedCount === 0) {
    console.log('PASS: All records have embeddings');
    return true;
  }

  // Backfill a small batch
  console.log('\nBackfilling 5 records as a test...');
  const result = await embeddingService.backfillEmbeddings(5);

  console.log(`PASS: Processed ${result.processed}`);
  if (result.errors > 0) {
    console.log(`WARN: Errors ${result.errors}`);
  }

  return result.processed > 0;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(50));
  console.log('EMBEDDING SERVICE TEST SUITE');
  console.log('Using: Supabase built-in gte-small (384 dimensions)');
  console.log('='.repeat(50));

  const results: { name: string; passed: boolean }[] = [];

  // Run tests
  results.push({ name: 'Database Setup', passed: await testDatabaseSetup() });
  results.push({ name: 'Edge Function', passed: await testEdgeFunction() });
  results.push({ name: 'Embedding Generation', passed: await testEmbeddingGeneration() });
  results.push({ name: 'Semantic Search', passed: await testSemanticSearch() });
  results.push({ name: 'Backfill', passed: await testBackfill() });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('TEST SUMMARY');
  console.log('='.repeat(50));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}`);
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  // Final stats
  const { count: embeddedCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null);

  const { count: totalCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true });

  console.log('\nCURRENT STATE');
  console.log('-'.repeat(50));
  console.log(`Total records: ${totalCount}`);
  console.log(`With embeddings: ${embeddedCount}`);
  console.log(`Without embeddings: ${(totalCount || 0) - (embeddedCount || 0)}`);
  console.log(`Coverage: ${((embeddedCount || 0) / (totalCount || 1) * 100).toFixed(2)}%`);
}

main().catch(console.error);
