/**
 * Test Chronicle V2 Deep Search
 *
 * Tests the upgraded search that now searches 30+ fields
 * including containers, parties, routes, content, and attachments.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const API_URL = 'http://localhost:3000/api/chronicle-v2/shipments';

interface TestCase {
  query: string;
  description: string;
  expectedToFind: boolean;
}

const testCases: TestCase[] = [
  // Identifiers (should work before and after)
  { query: '262226938', description: 'Booking number', expectedToFind: true },

  // NEW: Container search
  { query: 'MRKU', description: 'Container prefix (partial)', expectedToFind: true },
  { query: 'TCLU', description: 'Container prefix (TCLU)', expectedToFind: true },

  // NEW: Carrier search
  { query: 'Hapag', description: 'Carrier name', expectedToFind: true },
  { query: 'Maersk', description: 'Carrier name', expectedToFind: true },

  // NEW: Port/Route search
  { query: 'Mumbai', description: 'Port name', expectedToFind: true },
  { query: 'INNSA', description: 'Port code', expectedToFind: true },

  // NEW: Commodity search
  { query: 'garment', description: 'Commodity type', expectedToFind: true },

  // NEW: Conceptual/semantic search
  { query: 'customs', description: 'Conceptual - customs', expectedToFind: true },
  { query: 'delay', description: 'Conceptual - delay', expectedToFind: true },

  // Party names (should work before and after)
  { query: 'Pearl', description: 'Shipper name partial', expectedToFind: true },
];

async function testSearch(testCase: TestCase): Promise<{ passed: boolean; count: number; time: number }> {
  const startTime = Date.now();

  try {
    const url = `${API_URL}?search=${encodeURIComponent(testCase.query)}&pageSize=50`;
    const response = await fetch(url);
    const data = await response.json();

    const count = data.shipments?.length || 0;
    const time = Date.now() - startTime;

    const passed = testCase.expectedToFind ? count > 0 : count === 0;

    return { passed, count, time };
  } catch (error) {
    return { passed: false, count: 0, time: Date.now() - startTime };
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('CHRONICLE V2 DEEP SEARCH TEST');
  console.log('═'.repeat(70));
  console.log('Testing search across 30+ fields...\n');

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = await testSearch(testCase);

    const status = result.passed ? '✅' : '❌';
    const countStr = result.count.toString().padStart(3);
    const timeStr = `${result.time}ms`.padStart(6);

    console.log(`${status} "${testCase.query.padEnd(15)}" (${testCase.description.padEnd(25)}) → ${countStr} results ${timeStr}`);

    if (result.passed) passed++;
    else failed++;
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
