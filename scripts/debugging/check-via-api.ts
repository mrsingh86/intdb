async function check() {
  const response = await fetch('http://localhost:3000/api/shipments?limit=100');
  const data = await response.json();

  const withETD = data.shipments.filter((s: any) => s.etd !== null);
  const withETA = data.shipments.filter((s: any) => s.eta !== null);

  console.log('Shipments with ETD:', withETD.length);
  console.log('Shipments with ETA:', withETA.length);
  console.log('Total shipments:', data.pagination.total);

  // Show samples with dates
  const withDates = data.shipments.filter((s: any) => s.etd || s.eta).slice(0, 10);
  if (withDates.length > 0) {
    console.log('\nSample shipments with dates:');
    withDates.forEach((s: any) => {
      const etd = s.etd ? s.etd.split('T')[0] : '-';
      const eta = s.eta ? s.eta.split('T')[0] : '-';
      console.log(`  ${s.booking_number}: ETD=${etd}, ETA=${eta}`);
    });
  } else {
    console.log('\nNo shipments have ETD or ETA values.');
  }

  // Check entity extractions via intelligence endpoint (not available, so use shipments)
  console.log('\n---');
  console.log('Note: After the clear script ran, all invalid ETAs were cleared.');
  console.log('Need to re-extract ETA from booking confirmations and arrival notices.');
}

check().catch(console.error);
