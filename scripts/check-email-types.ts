async function check() {
  const response = await fetch('http://localhost:3000/api/emails?limit=200');
  const data = await response.json();

  if (!data.emails) {
    console.log('No emails field in response');
    console.log(JSON.stringify(data).substring(0, 500));
    return;
  }

  // Count by document type
  const types: Record<string, number> = {};
  data.emails.forEach((e: any) => {
    const t = e.document_type || '(none)';
    const sub = e.document_subtype ? ` / ${e.document_subtype}` : '';
    const key = t + sub;
    types[key] = (types[key] || 0) + 1;
  });

  console.log('Email document types:');
  Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => {
      console.log(`  ${v}x ${k}`);
    });

  // Find booking confirmations and arrival notices
  const bookingConfirmations = data.emails.filter((e: any) =>
    e.document_type === 'booking_confirmation' ||
    e.subject?.toLowerCase().includes('booking confirm')
  );

  const arrivalNotices = data.emails.filter((e: any) =>
    e.document_type === 'arrival_notice' ||
    e.subject?.toLowerCase().includes('arrival')
  );

  console.log(`\nBooking Confirmations: ${bookingConfirmations.length}`);
  console.log(`Arrival Notices: ${arrivalNotices.length}`);

  // Show sample subjects
  if (bookingConfirmations.length > 0) {
    console.log('\nSample booking confirmation subjects:');
    bookingConfirmations.slice(0, 5).forEach((e: any) => {
      console.log(`  - ${e.subject?.substring(0, 80)}`);
    });
  }
}

check().catch(console.error);
