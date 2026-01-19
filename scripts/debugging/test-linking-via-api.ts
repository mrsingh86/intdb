/**
 * Test script to trigger the linking service via the API endpoint
 *
 * This script calls the POST /api/shipments/process-linking endpoint
 * which will process all unlinked emails through the linking service.
 *
 * Run with: npx tsx scripts/test-linking-via-api.ts
 */

async function testLinkingViaAPI() {
  console.log('🚀 Testing Shipment Linking Service via API\n');
  console.log('='.repeat(60));

  const apiUrl = 'http://localhost:3000/api/shipments/process-linking';

  console.log(`\n📡 Calling API: ${apiUrl}`);
  console.log('   Method: POST');
  console.log('   Body: {} (process all unlinked emails)\n');

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    console.log('✅ API Response:\n');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 LINKING RESULTS SUMMARY\n');
    console.log('='.repeat(60));
    console.log(`Success:                ${result.success}`);
    console.log(`Emails Processed:       ${result.processed || 0}`);
    console.log(`Auto-Linked (≥85%):     ${result.linked || 0}`);
    console.log(`Suggestions (60-84%):   ${result.candidates_created || 0}`);
    console.log('='.repeat(60));

    if (result.results && result.results.length > 0) {
      console.log('\n📋 Detailed Results (first 10):');
      result.results.slice(0, 10).forEach((r: any, i: number) => {
        console.log(`\n[${i + 1}] Email: ${r.email_id}`);
        console.log(`    Subject: ${r.subject?.substring(0, 60)}...`);
        console.log(`    Matched: ${r.result.matched}`);
        console.log(`    Confidence: ${r.result.confidence_score}%`);
        console.log(`    Reasoning: ${r.result.reasoning}`);
      });
    }

    console.log('\n✅ Test complete!\n');
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error('\nMake sure the Next.js dev server is running:');
    console.error('  npm run dev:dashboard\n');
    process.exit(1);
  }
}

// Run the test
testLinkingViaAPI()
  .then(() => {
    console.log('✅ Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
