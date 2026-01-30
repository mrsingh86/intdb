/**
 * Test Unified Search Service
 *
 * Validates query classification and search routing.
 * Run: npx tsx scripts/test-unified-search.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  classifyQuery,
  createEmbeddingService,
  createUnifiedSearchService,
} from '../lib/chronicle';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTests() {
  console.log('='.repeat(70));
  console.log('UNIFIED SEARCH SERVICE TEST');
  console.log('='.repeat(70));

  // Initialize services
  const embeddingService = createEmbeddingService(supabase);
  const unifiedSearch = createUnifiedSearchService(supabase, embeddingService);

  // =========================================================================
  // TEST 1: Query Classification
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('TEST 1: Query Classification');
  console.log('-'.repeat(70));

  const testQueries = [
    // Identifiers (should be keyword)
    { query: '2038256270', expectedType: 'booking_number', expectedStrategy: 'keyword' },
    { query: 'MAEU262822342', expectedType: 'mbl_number', expectedStrategy: 'keyword' },
    { query: 'MRKU1234567', expectedType: 'container_number', expectedStrategy: 'keyword' },
    { query: 'INNSA', expectedType: 'port_code', expectedStrategy: 'keyword' },

    // Names (should be hybrid)
    { query: 'Walmart', expectedType: 'party_name', expectedStrategy: 'hybrid' },
    { query: 'ABC Corporation Ltd', expectedType: 'party_name', expectedStrategy: 'hybrid' },
    { query: 'New York', expectedType: 'port_name', expectedStrategy: 'hybrid' },

    // Concepts (should be semantic)
    { query: 'delayed shipments', expectedType: 'conceptual', expectedStrategy: 'semantic' },
    { query: 'customs hold issues', expectedType: 'conceptual', expectedStrategy: 'semantic' },
    { query: 'urgent pending actions', expectedType: 'conceptual', expectedStrategy: 'semantic' },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of testQueries) {
    const result = classifyQuery(test.query);
    const typeMatch = result.queryType === test.expectedType;
    const strategyMatch = result.searchStrategy === test.expectedStrategy;
    const success = typeMatch && strategyMatch;

    if (success) {
      passed++;
      console.log(`✅ "${test.query}"`);
      console.log(`   Type: ${result.queryType} | Strategy: ${result.searchStrategy}`);
    } else {
      failed++;
      console.log(`❌ "${test.query}"`);
      console.log(`   Expected: ${test.expectedType}/${test.expectedStrategy}`);
      console.log(`   Got: ${result.queryType}/${result.searchStrategy}`);
    }
  }

  console.log(`\nClassification: ${passed}/${testQueries.length} passed`);

  // =========================================================================
  // TEST 2: Unified Search - Identifier (Keyword)
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('TEST 2: Unified Search - Identifier (Keyword)');
  console.log('-'.repeat(70));

  // Get a real booking number
  const { data: sampleBooking } = await supabase
    .from('chronicle')
    .select('booking_number')
    .not('booking_number', 'is', null)
    .limit(10);

  let testBooking: string | null = null;
  for (const row of sampleBooking || []) {
    const bn = row.booking_number;
    if (typeof bn === 'string' && /^\d{6,15}$/.test(bn)) {
      testBooking = bn;
      break;
    }
  }

  if (testBooking) {
    const response = await unifiedSearch.search(testBooking);
    console.log(`Query: "${testBooking}"`);
    console.log(`Strategy: ${response.strategy}`);
    console.log(`Results: ${response.totalFound}`);
    console.log(`Time: ${response.searchTime}ms`);
    if (response.results.length > 0) {
      console.log(`First result: ${response.results[0].documentType} - ${response.results[0].subject?.slice(0, 50)}`);
    }
  } else {
    console.log('No valid booking number found for test');
  }

  // =========================================================================
  // TEST 3: Unified Search - Concept (Semantic)
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('TEST 3: Unified Search - Concept (Semantic)');
  console.log('-'.repeat(70));

  const conceptQuery = 'shipping delay notification';
  const conceptResponse = await unifiedSearch.search(conceptQuery);

  console.log(`Query: "${conceptQuery}"`);
  console.log(`Strategy: ${conceptResponse.strategy}`);
  console.log(`Results: ${conceptResponse.totalFound}`);
  console.log(`Time: ${conceptResponse.searchTime}ms`);

  if (conceptResponse.results.length > 0) {
    console.log('Top 3 results:');
    for (const result of conceptResponse.results.slice(0, 3)) {
      console.log(`  • [${result.matchType}] ${result.documentType}: ${result.subject?.slice(0, 50)}`);
    }
  }

  // =========================================================================
  // TEST 4: Unified Search - Party Name (Hybrid)
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('TEST 4: Unified Search - Party Name (Hybrid)');
  console.log('-'.repeat(70));

  // Get a real shipper name
  const { data: sampleShipper } = await supabase
    .from('chronicle')
    .select('shipper_name')
    .not('shipper_name', 'is', null)
    .limit(1)
    .single();

  if (sampleShipper?.shipper_name) {
    // Take first word of shipper name
    const shipperWord = sampleShipper.shipper_name.split(' ')[0];
    const hybridResponse = await unifiedSearch.search(shipperWord);

    console.log(`Query: "${shipperWord}" (from shipper: ${sampleShipper.shipper_name})`);
    console.log(`Strategy: ${hybridResponse.strategy}`);
    console.log(`Results: ${hybridResponse.totalFound}`);
    console.log(`Time: ${hybridResponse.searchTime}ms`);

    if (hybridResponse.results.length > 0) {
      const byType = hybridResponse.results.reduce((acc, r) => {
        acc[r.matchType] = (acc[r.matchType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log('Results by match type:', byType);
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`\nQuery Classification: ${passed}/${testQueries.length} tests passed`);
  console.log('\nSearch Routing:');
  console.log('  • Identifiers → Keyword search (fast, precise)');
  console.log('  • Party names → Hybrid search (keyword + semantic RRF)');
  console.log('  • Concepts → Semantic search (vector similarity)');
}

runTests().catch(e => console.error('Test error:', e.message));
