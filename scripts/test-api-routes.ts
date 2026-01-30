/**
 * Test API Routes - Verify search APIs work with UnifiedSearchService
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

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const embeddingService = createEmbeddingService(supabase);
const unifiedSearch = createUnifiedSearchService(supabase, embeddingService);

async function testPulseSearch() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: /api/pulse/search (simulated)');
  console.log('='.repeat(70));

  const testQueries = [
    { query: '261140854', expected: 'booking_number → single dossier' },
    { query: 'INNSA', expected: 'port_code → shipment list' },
    { query: 'Marathon Brake', expected: 'party_name → shipment list' },
    { query: 'customs hold', expected: 'conceptual → email list' },
  ];

  for (const { query, expected } of testQueries) {
    const response = await unifiedSearch.search(query, { limit: 10 });
    const classification = response.query;

    console.log(`\n📝 Query: "${query}"`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual: ${classification.queryType}/${classification.searchStrategy}`);
    console.log(`   Results: ${response.totalFound} in ${response.searchTime}ms`);

    // Show sample booking numbers
    const bookings = [...new Set(response.results.map(r => r.bookingNumber).filter(Boolean))];
    if (bookings.length > 0) {
      console.log(`   Bookings found: ${bookings.slice(0, 3).join(', ')}...`);
    }
  }
}

async function testDossierSearch() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: /api/pulse/dossier-search (simulated)');
  console.log('='.repeat(70));

  // Get a booking number to test with
  const { data } = await supabase
    .from('chronicle')
    .select('booking_number')
    .not('booking_number', 'is', null)
    .limit(1)
    .single();

  if (!data?.booking_number) {
    console.log('No booking found for test');
    return;
  }

  const bookingNumber = data.booking_number;
  console.log(`\nUsing booking: ${bookingNumber}`);

  const testKeywords = [
    { keyword: 'confirmation', expected: 'conceptual → semantic' },
    { keyword: 'Maersk', expected: 'party_name → hybrid' },
    { keyword: 'draft', expected: 'conceptual → semantic' },
  ];

  for (const { keyword, expected } of testKeywords) {
    const classification = classifyQuery(keyword);
    console.log(`\n📝 Keyword: "${keyword}"`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual: ${classification.queryType}/${classification.searchStrategy}`);
  }
}

async function testGeneralSearch() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST: /api/search (simulated)');
  console.log('='.repeat(70));

  const query = 'booking confirmation';
  const response = await unifiedSearch.search(query, { limit: 10 });

  console.log(`\n📝 Query: "${query}"`);
  console.log(`   Strategy: ${response.strategy}`);
  console.log(`   Results: ${response.totalFound}`);
  console.log(`   Time: ${response.searchTime}ms`);

  if (response.results.length > 0) {
    console.log('\n   Top 3 results:');
    for (const r of response.results.slice(0, 3)) {
      console.log(`     [${r.matchType}] ${r.documentType}: ${r.subject?.substring(0, 40)}...`);
    }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║          API ROUTES TEST - UnifiedSearchService Integration          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  await testPulseSearch();
  await testDossierSearch();
  await testGeneralSearch();

  console.log('\n' + '='.repeat(70));
  console.log('ALL TESTS COMPLETE');
  console.log('='.repeat(70));
}

main().catch(e => console.error('Test error:', e));
