/**
 * Test Deep Dossier Search
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const API_URL = 'http://localhost:3000/api/pulse/dossier-search';

async function testDeepSearch() {
  console.log('═'.repeat(70));
  console.log('TESTING DEEP DOSSIER SEARCH');
  console.log('═'.repeat(70));

  const bookingNumber = '262226938';

  const testQueries = [
    { query: 'MRKU', description: 'Container prefix (identifier search)' },
    { query: 'SEBAROK', description: 'Vessel name (route search)' },
    { query: 'Pearl Global', description: 'Shipper name (party search)' },
    { query: 'Kohl', description: 'Consignee name (party search)' },
    { query: 'customs', description: 'Conceptual search (semantic)' },
    { query: 'delay', description: 'Conceptual search (semantic)' },
  ];

  for (const { query, description } of testQueries) {
    console.log(`\n📝 Search: "${query}" (${description})`);
    console.log('─'.repeat(60));

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingNumber, keyword: query }),
      });

      const data = await response.json();

      if (data.success) {
        console.log(`   Search depth: ${data.searchDepth}`);
        console.log(`   Query type: ${data.queryType}`);
        console.log(`   Strategy: ${data.searchStrategy}`);
        console.log(`   Total results: ${data.count}`);
        console.log(`   Keyword matches: ${data.keywordMatches}`);
        console.log(`   Semantic matches: ${data.semanticMatches}`);

        if (data.matchSummary && Object.keys(data.matchSummary).length > 0) {
          console.log(`   Match breakdown:`, data.matchSummary);
        }

        // Show first 3 results
        if (data.results?.length > 0) {
          console.log(`\n   Top results:`);
          for (const r of data.results.slice(0, 3)) {
            console.log(`   • [${r.matchType}] ${r.matchedField}: ${r.snippet?.substring(0, 50)}...`);
          }
        }
      } else {
        console.log(`   Error: ${data.error}`);
      }
    } catch (error) {
      console.log(`   Failed: ${error}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('TEST COMPLETE');
  console.log('═'.repeat(70));
}

testDeepSearch().catch(console.error);
