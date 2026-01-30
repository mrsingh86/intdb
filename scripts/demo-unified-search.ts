/**
 * Demo: Unified Search Examples
 * Shows classification → routing → results for various query types
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

async function demo(query: string, description: string) {
  console.log('\n' + '─'.repeat(70));
  console.log(`📝 Query: "${query}"`);
  console.log(`   ${description}`);
  console.log('─'.repeat(70));

  // Classification
  const classification = classifyQuery(query);
  console.log(`\n🔍 Classification:`);
  console.log(`   Type: ${classification.queryType}`);
  console.log(`   Strategy: ${classification.searchStrategy}`);
  console.log(`   Confidence: ${classification.confidence}%`);
  console.log(`   Pattern: ${classification.metadata.detectedPatterns?.join(', ')}`);

  // Search
  const response = await unifiedSearch.search(query, { limit: 5 });
  console.log(`\n📊 Results: ${response.totalFound} found in ${response.searchTime}ms`);

  if (response.results.length > 0) {
    console.log(`\n🎯 Top Results:`);
    for (const r of response.results.slice(0, 3)) {
      const booking = r.bookingNumber ? ` | BKG: ${r.bookingNumber}` : '';
      console.log(`   [${r.matchType.padEnd(8)}] ${r.documentType?.padEnd(20) || 'unknown'.padEnd(20)} | ${r.subject?.substring(0, 40)}...${booking}`);
    }
  }
}

async function runDemos() {
  console.log('═'.repeat(70));
  console.log('UNIFIED SEARCH DEMO - Live Examples');
  console.log('═'.repeat(70));

  // 1. IDENTIFIER QUERIES (Keyword Search)
  console.log('\n\n🏷️  IDENTIFIER QUERIES → Keyword Search (Precise Matching)');

  await demo('261140854', 'Booking number - searches booking_number field');
  await demo('MRKU8561193', 'Container number - searches container_numbers field');
  await demo('INNSA', 'Port code (UN/LOCODE) - searches pol/pod fields');

  // 2. PARTY NAME QUERIES (Hybrid Search)
  console.log('\n\n👥 PARTY NAME QUERIES → Hybrid Search (Keyword + Semantic)');

  await demo('INTOGLO', 'Shipper name - keyword matches + semantic related');
  await demo('Marathon Brake', 'Company name (2 words) - finds exact + related');
  await demo('Newark', 'Port city name - matches port fields + semantic context');

  // 3. CONCEPTUAL QUERIES (Semantic Search)
  console.log('\n\n💭 CONCEPTUAL QUERIES → Semantic Search (Meaning-Based)');

  await demo('booking confirmation', 'Document type concept - finds semantically similar');
  await demo('delayed shipment', 'Issue/problem concept - finds related discussions');
  await demo('customs hold', 'Operational issue - finds customs-related emails');

  console.log('\n\n' + '═'.repeat(70));
  console.log('DEMO COMPLETE');
  console.log('═'.repeat(70));
}

runDemos().catch(e => console.error('Demo error:', e));
