/**
 * Phase 2 Cross-Validation Test
 *
 * Run: npx tsx scripts/test-phase2-validation.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  createEmbeddingService,
  createHybridSearchService,
} from '../lib/chronicle';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runValidation() {
  console.log('='.repeat(70));
  console.log('HYBRID SEARCH VALIDATION');
  console.log('='.repeat(70));

  const embeddingService = createEmbeddingService(supabase);
  const hybridSearchService = createHybridSearchService(supabase, embeddingService);

  // Get a proper single booking number
  const { data: samples } = await supabase
    .from('chronicle')
    .select('booking_number')
    .not('booking_number', 'is', null)
    .limit(20);

  let bookingNum: string | null = null;
  for (const row of samples || []) {
    const bn = row.booking_number;
    if (typeof bn === 'string' && bn.length > 0 && bn.length < 20) {
      bookingNum = bn;
      break;
    }
  }

  console.log('\nTest 1: Exact booking number search');
  console.log('-'.repeat(50));

  if (bookingNum) {
    const results = await hybridSearchService.searchByReference(bookingNum);
    console.log(`Search: "${bookingNum}"`);
    console.log(`  Results: ${results.length}`);
    if (results.length > 0) {
      const keywordCount = results.filter(r => r.matchSource === 'keyword').length;
      const semanticCount = results.filter(r => r.matchSource === 'semantic').length;
      console.log(`  Keyword matches: ${keywordCount}`);
      console.log(`  Semantic matches: ${semanticCount}`);
      console.log(`  Top types: ${results.slice(0, 3).map(r => r.documentType).join(', ')}`);
    }
  } else {
    console.log('No valid booking number found');
  }

  console.log('\nTest 2: Semantic fallback (non-existent reference)');
  console.log('-'.repeat(50));

  const fallbackResults = await hybridSearchService.searchByReference('ZZZZNOTEXIST999');
  console.log('Search: "ZZZZNOTEXIST999"');
  console.log(`  Keyword results: 0 (expected - no match)`);
  console.log(`  Semantic fallback: ${fallbackResults.length} results`);
  if (fallbackResults.length > 0) {
    console.log(`  Semantic found: ${fallbackResults.slice(0, 2).map(r => r.documentType).join(', ')}`);
  }

  console.log('\nTest 3: Free-text query (hybrid)');
  console.log('-'.repeat(50));

  const queryResults = await hybridSearchService.searchByQuery('urgent VGM submission');
  console.log('Search: "urgent VGM submission"');
  console.log(`  Total results: ${queryResults.length}`);
  if (queryResults.length > 0) {
    const keywordCount = queryResults.filter(r => r.matchSource === 'keyword').length;
    const semanticCount = queryResults.filter(r => r.matchSource === 'semantic').length;
    console.log(`  Keyword: ${keywordCount}, Semantic: ${semanticCount}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('VALIDATION COMPLETE');
  console.log('='.repeat(70));
}

runValidation().catch(e => console.error('Error:', e.message));
