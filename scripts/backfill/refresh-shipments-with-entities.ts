/**
 * Delete existing shipments and re-process all emails with enhanced entity extraction
 *
 * This will populate shipments with ALL entity data from Layer 2:
 * - Ports (POL, POD)
 * - Dates (ETD, ETA)
 * - Vessel/voyage info
 * - Cargo details
 * - etc.
 */

async function refreshShipments() {
  console.log('🗑️  Deleting existing shipments...\n');

  // Delete all shipments via API
  const deleteResponse = await fetch('http://localhost:3000/api/shipments/delete-all', {
    method: 'DELETE',
  });

  if (!deleteResponse.ok) {
    console.error('Error deleting shipments:', await deleteResponse.text());
    process.exit(1);
  }

  console.log('✅ Deleted all shipments\n');
  console.log('🔄 Triggering AI linking with enhanced entity extraction...\n');

  // Call the linking API to reprocess all emails
  const response = await fetch('http://localhost:3000/api/shipments/process-linking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    console.error('Error triggering linking:', await response.text());
    process.exit(1);
  }

  const result = await response.json();

  console.log('✅ Linking complete!\n');
  console.log('📊 Results:');
  console.log(`   Emails Processed:       ${result.processed}`);
  console.log(`   Auto-Linked (≥85%):     ${result.linked}`);
  console.log(`   Suggestions (60-84%):   ${result.candidates_created}`);

  console.log('\n✅ Done! Shipments now have complete entity data from Layer 2.');
  console.log('   Visit http://localhost:3000/shipments to see the enriched shipments.\n');
}

refreshShipments()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
