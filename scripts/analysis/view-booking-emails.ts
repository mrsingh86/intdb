async function check() {
  const response = await fetch('http://localhost:3000/api/emails?limit=100');
  const data = await response.json();

  // Find booking confirmations by subject
  const bookingEmails = data.emails.filter((e: any) =>
    e.subject?.toLowerCase().includes('booking confirm')
  );

  console.log(`Found ${bookingEmails.length} booking confirmation emails\n`);

  for (const email of bookingEmails.slice(0, 3)) {
    console.log('='.repeat(80));
    console.log('Subject:', email.subject);
    console.log('From:', email.sender_email);
    console.log('Date:', email.received_at?.split('T')[0]);
    console.log('\nBody excerpt:');

    const body = email.body_text || '';
    // Look for ETD/ETA patterns in body
    const etdMatch = body.match(/ETD[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i);
    const etaMatch = body.match(/ETA[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i);

    console.log('  ETD pattern found:', etdMatch ? etdMatch[1] : 'none');
    console.log('  ETA pattern found:', etaMatch ? etaMatch[1] : 'none');

    // Show relevant section
    const vesselIdx = body.toLowerCase().indexOf('vessel');
    const scheduleIdx = body.toLowerCase().indexOf('schedule');
    const etdIdx = body.toLowerCase().indexOf('etd');
    const etaIdx = body.toLowerCase().indexOf('eta');

    const startIdx = Math.min(
      vesselIdx >= 0 ? vesselIdx : 9999,
      scheduleIdx >= 0 ? scheduleIdx : 9999,
      etdIdx >= 0 ? etdIdx : 9999,
      etaIdx >= 0 ? etaIdx : 9999
    );

    if (startIdx < 9999) {
      console.log('\nRelevant section:');
      console.log(body.substring(startIdx, startIdx + 500).replace(/\n{3,}/g, '\n\n'));
    }
    console.log();
  }
}

check().catch(console.error);
