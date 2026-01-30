/**
 * Comprehensive Unified Search Test
 *
 * Tests 20 real queries against the database.
 * Validates classification, search results, and performance.
 *
 * Run: npx tsx scripts/test-unified-search-comprehensive.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  classifyQuery,
  createEmbeddingService,
  createUnifiedSearchService,
  SearchStrategy,
  QueryType,
} from '../lib/chronicle';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// TEST CASES - 20 Real Queries
// ============================================================================

interface TestCase {
  id: number;
  query: string;
  description: string;
  expectedType: QueryType;
  expectedStrategy: SearchStrategy;
  expectResults: boolean;  // Should find results
}

const TEST_CASES: TestCase[] = [
  // === IDENTIFIERS (Keyword) ===
  {
    id: 1,
    query: '261140854',
    description: 'Booking number (numeric)',
    expectedType: 'booking_number',
    expectedStrategy: 'keyword',
    expectResults: true,
  },
  {
    id: 2,
    query: '6434943470',
    description: 'Booking number (10 digits)',
    expectedType: 'booking_number',
    expectedStrategy: 'keyword',
    expectResults: true,
  },
  {
    id: 3,
    query: 'MRKU8561193',
    description: 'Container number (Maersk)',
    expectedType: 'container_number',
    expectedStrategy: 'keyword',
    expectResults: true,
  },
  {
    id: 4,
    query: 'HASU1193235',
    description: 'Container number (Hapag)',
    expectedType: 'container_number',
    expectedStrategy: 'keyword',
    expectResults: true,
  },
  {
    id: 5,
    query: 'INNSA',
    description: 'Port code (Nhava Sheva)',
    expectedType: 'port_code',
    expectedStrategy: 'keyword',
    expectResults: true,
  },
  {
    id: 6,
    query: 'USNYC',
    description: 'Port code (New York)',
    expectedType: 'port_code',
    expectedStrategy: 'keyword',
    expectResults: true,
  },

  // === PARTY NAMES (Hybrid) ===
  {
    id: 7,
    query: 'INTOGLO',
    description: 'Shipper name (partial)',
    expectedType: 'party_name',
    expectedStrategy: 'hybrid',
    expectResults: true,
  },
  {
    id: 8,
    query: 'Marathon Brake',
    description: 'Consignee name (partial)',
    expectedType: 'party_name',
    expectedStrategy: 'hybrid',
    expectResults: true,
  },
  {
    id: 9,
    query: 'KHOSLA PROFIL',
    description: 'Shipper name (exact)',
    expectedType: 'party_name',
    expectedStrategy: 'hybrid',
    expectResults: true,
  },
  {
    id: 10,
    query: 'Newton',
    description: 'Consignee name (single word)',
    expectedType: 'party_name',
    expectedStrategy: 'hybrid',
    expectResults: true,
  },

  // === PORT NAMES (Hybrid) ===
  {
    id: 11,
    query: 'Nhava Sheva',
    description: 'Port name (India)',
    expectedType: 'port_name',
    expectedStrategy: 'hybrid',
    expectResults: true,
  },
  {
    id: 12,
    query: 'Newark',
    description: 'Port name (USA)',
    expectedType: 'port_name',
    expectedStrategy: 'hybrid',
    expectResults: true,
  },

  // === CONCEPTS (Semantic) ===
  {
    id: 13,
    query: 'booking confirmation',
    description: 'Document type concept',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,
  },
  {
    id: 14,
    query: 'VGM submission',
    description: 'Document type concept',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,
  },
  {
    id: 15,
    query: 'delayed shipment',
    description: 'Issue concept',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,  // May or may not find
  },
  {
    id: 16,
    query: 'urgent pending action',
    description: 'Action concept',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,
  },
  {
    id: 17,
    query: 'customs hold',
    description: 'Issue concept',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,
  },
  {
    id: 18,
    query: 'arrival notice',
    description: 'Document type phrase',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,
  },

  // === EDGE CASES ===
  {
    id: 19,
    query: 'draft_bl',
    description: 'Document type (exact enum)',
    expectedType: 'document_type',
    expectedStrategy: 'keyword',
    expectResults: true,
  },
  {
    id: 20,
    query: 'SOB confirmation Hazira',
    description: 'Mixed concept + location',
    expectedType: 'conceptual',
    expectedStrategy: 'semantic',
    expectResults: true,
  },
];

// ============================================================================
// TEST RUNNER
// ============================================================================

interface TestResult {
  id: number;
  query: string;
  description: string;
  classificationPassed: boolean;
  actualType: QueryType;
  actualStrategy: SearchStrategy;
  resultCount: number;
  searchTimeMs: number;
  matchTypes: Record<string, number>;
  sampleResults: string[];
}

async function runComprehensiveTests() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE UNIFIED SEARCH TEST - 20 Test Cases');
  console.log('='.repeat(80));
  console.log('');

  // Initialize services
  const embeddingService = createEmbeddingService(supabase);
  const unifiedSearch = createUnifiedSearchService(supabase, embeddingService);

  const results: TestResult[] = [];
  let classificationPassed = 0;
  let searchSucceeded = 0;

  for (const test of TEST_CASES) {
    process.stdout.write(`Running test ${test.id}/20: "${test.query.slice(0, 30)}"...`);

    // Classify
    const classification = classifyQuery(test.query);
    const classOk = classification.queryType === test.expectedType &&
                    classification.searchStrategy === test.expectedStrategy;

    // Search
    const startTime = Date.now();
    const response = await unifiedSearch.search(test.query, { limit: 10 });
    const searchTime = Date.now() - startTime;

    // Analyze results
    const matchTypes: Record<string, number> = {};
    for (const r of response.results) {
      matchTypes[r.matchType] = (matchTypes[r.matchType] || 0) + 1;
    }

    const sampleResults = response.results.slice(0, 3).map(r =>
      `[${r.matchType}] ${r.documentType || 'unknown'}: ${(r.subject || '').slice(0, 40)}`
    );

    const result: TestResult = {
      id: test.id,
      query: test.query,
      description: test.description,
      classificationPassed: classOk,
      actualType: classification.queryType,
      actualStrategy: classification.searchStrategy,
      resultCount: response.totalFound,
      searchTimeMs: searchTime,
      matchTypes,
      sampleResults,
    };

    results.push(result);

    if (classOk) classificationPassed++;
    if (response.totalFound > 0) searchSucceeded++;

    console.log(` ${classOk ? '✓' : '✗'} ${response.totalFound} results (${searchTime}ms)`);
  }

  // =========================================================================
  // DETAILED RESULTS
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(80));

  for (const r of results) {
    const icon = r.classificationPassed ? '✅' : '❌';
    console.log(`\n${icon} Test #${r.id}: "${r.query}"`);
    console.log(`   Description: ${r.description}`);
    console.log(`   Classification: ${r.actualType} → ${r.actualStrategy}`);
    console.log(`   Results: ${r.resultCount} (${r.searchTimeMs}ms)`);

    if (Object.keys(r.matchTypes).length > 0) {
      console.log(`   Match types: ${JSON.stringify(r.matchTypes)}`);
    }

    if (r.sampleResults.length > 0) {
      console.log(`   Samples:`);
      for (const sample of r.sampleResults) {
        console.log(`     • ${sample}`);
      }
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  // Classification summary
  console.log(`\n📊 Classification: ${classificationPassed}/${TEST_CASES.length} passed`);

  const byStrategy: Record<string, { total: number; withResults: number }> = {};
  for (const r of results) {
    if (!byStrategy[r.actualStrategy]) {
      byStrategy[r.actualStrategy] = { total: 0, withResults: 0 };
    }
    byStrategy[r.actualStrategy].total++;
    if (r.resultCount > 0) byStrategy[r.actualStrategy].withResults++;
  }

  console.log('\n📈 Search Results by Strategy:');
  for (const [strategy, stats] of Object.entries(byStrategy)) {
    const pct = Math.round((stats.withResults / stats.total) * 100);
    console.log(`   ${strategy}: ${stats.withResults}/${stats.total} found results (${pct}%)`);
  }

  // Performance summary
  const times = results.map(r => r.searchTimeMs);
  const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const maxTime = Math.max(...times);
  const minTime = Math.min(...times);

  console.log('\n⏱️  Performance:');
  console.log(`   Average: ${avgTime}ms`);
  console.log(`   Min: ${minTime}ms`);
  console.log(`   Max: ${maxTime}ms`);

  // Failed classifications
  const failed = results.filter(r => !r.classificationPassed);
  if (failed.length > 0) {
    console.log('\n⚠️  Classification Mismatches:');
    for (const f of failed) {
      console.log(`   #${f.id} "${f.query}": got ${f.actualType}/${f.actualStrategy}`);
    }
  }

  // Zero results
  const noResults = results.filter(r => r.resultCount === 0);
  if (noResults.length > 0) {
    console.log('\n⚠️  Zero Results:');
    for (const n of noResults) {
      console.log(`   #${n.id} "${n.query}" (${n.actualStrategy})`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`FINAL SCORE: ${classificationPassed}/20 classification, ${searchSucceeded}/20 with results`);
  console.log('='.repeat(80));
}

runComprehensiveTests().catch(e => console.error('Test error:', e));
