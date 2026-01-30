/**
 * Debug Semantic Search
 * Checks each component of the semantic search pipeline
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function debugSemanticSearch() {
  console.log('='.repeat(70));
  console.log('SEMANTIC SEARCH DEBUG');
  console.log('='.repeat(70));

  // 1. Check if embeddings exist in database
  console.log('\n1. CHECKING EMBEDDINGS IN DATABASE...');
  const { data: embeddingCheck, error: embError } = await supabase
    .from('chronicle')
    .select('id, subject')
    .not('embedding', 'is', null)
    .limit(5);

  if (embError) {
    console.log('   ❌ Error checking embeddings:', embError.message);
  } else {
    console.log(`   ✅ Found ${embeddingCheck?.length || 0} records with embeddings`);
    if (embeddingCheck && embeddingCheck.length > 0) {
      console.log('   Sample subjects:');
      embeddingCheck.forEach(r => console.log(`     • ${r.subject?.substring(0, 60)}`));
    }
  }

  // Count total vs embedded
  const { count: totalCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true });

  const { count: embeddedCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null);

  console.log(`   Total records: ${totalCount}, With embeddings: ${embeddedCount}`);

  // 2. Check if RPC function exists
  console.log('\n2. CHECKING RPC FUNCTION (search_chronicle_semantic)...');

  // Create a dummy embedding (384 dimensions)
  const dummyEmbedding = Array(384).fill(0.1);

  const { data: rpcData, error: rpcError } = await supabase.rpc('search_chronicle_semantic', {
    query_embedding: dummyEmbedding,
    match_count: 5,
    similarity_threshold: 0.01, // Very low to see if anything returns
    p_document_type: null,
  });

  if (rpcError) {
    console.log('   ❌ RPC function error:', rpcError.message);
    console.log('   The RPC function may not exist or has different parameters');
  } else {
    console.log('   ✅ RPC function exists');
    console.log(`   Results with dummy embedding: ${rpcData?.length || 0}`);
    if (rpcData && rpcData.length > 0) {
      console.log('   Sample:');
      rpcData.slice(0, 2).forEach((r: any) => {
        console.log(`     • similarity=${r.similarity?.toFixed(3)} | ${r.subject?.substring(0, 50)}`);
      });
    }
  }

  // 3. Check Edge Function
  console.log('\n3. CHECKING EDGE FUNCTION (generate-embedding)...');

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ text: 'booking confirmation for Maersk shipment' }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`   ❌ Edge function error: ${response.status}`);
      console.log(`   Response: ${errorText.substring(0, 200)}`);
    } else {
      const data = await response.json();
      if (data.embedding && Array.isArray(data.embedding)) {
        console.log(`   ✅ Edge function works! Embedding dimensions: ${data.embedding.length}`);

        // Now try the full semantic search with this real embedding
        console.log('\n4. TESTING FULL SEMANTIC SEARCH WITH REAL EMBEDDING...');

        const { data: searchData, error: searchError } = await supabase.rpc('search_chronicle_semantic', {
          query_embedding: data.embedding,
          match_count: 10,
          similarity_threshold: 0.5,
          p_document_type: null,
        });

        if (searchError) {
          console.log('   ❌ Search error:', searchError.message);
        } else {
          console.log(`   ✅ Search returned ${searchData?.length || 0} results`);
          if (searchData && searchData.length > 0) {
            console.log('   Top results:');
            searchData.slice(0, 5).forEach((r: any, i: number) => {
              console.log(`     ${i + 1}. [${r.similarity?.toFixed(3)}] ${r.document_type}: ${r.subject?.substring(0, 50)}`);
            });
          } else {
            console.log('   ⚠️  No results found - checking similarity threshold...');

            // Try with lower threshold
            const { data: lowThreshData } = await supabase.rpc('search_chronicle_semantic', {
              query_embedding: data.embedding,
              match_count: 10,
              similarity_threshold: 0.1,
              p_document_type: null,
            });

            console.log(`   With threshold=0.1: ${lowThreshData?.length || 0} results`);
            if (lowThreshData && lowThreshData.length > 0) {
              console.log('   Top results at lower threshold:');
              lowThreshData.slice(0, 3).forEach((r: any) => {
                console.log(`     [${r.similarity?.toFixed(3)}] ${r.subject?.substring(0, 50)}`);
              });
            }
          }
        }
      } else {
        console.log('   ❌ Edge function returned unexpected format:', JSON.stringify(data).substring(0, 200));
      }
    }
  } catch (error: any) {
    console.log('   ❌ Edge function fetch error:', error.message);
  }

  console.log('\n' + '='.repeat(70));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(70));
}

debugSemanticSearch().catch(e => console.error('Debug error:', e));
