async function check() {
  const response = await fetch('http://localhost:3000/api/emails?limit=100');
  const data = await response.json();

  // Find Hapag-Lloyd emails (HL- prefix)
  const hapagEmails = data.emails.filter((e: any) =>
    e.subject?.startsWith('HL-') || e.sender_email?.includes('hapag')
  );

  console.log(`Found ${hapagEmails.length} Hapag-Lloyd emails\n`);

  for (const email of hapagEmails.slice(0, 3)) {
    console.log('='.repeat(80));
    console.log('Subject:', email.subject);
    console.log('From:', email.sender_email);
    console.log('\nBody (first 2000 chars):');

    const body = email.body_text || '';

    // Look for ETA patterns
    const patterns = [
      /ETA[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/gi,
      /Arrival[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/gi,
      /(\d{1,2}[-\/]\w{3}[-\/]\d{4})/g
    ];

    console.log('\nDate patterns found:');
    patterns.forEach((pattern, i) => {
      const matches = body.match(pattern);
      if (matches) {
        console.log(`  Pattern ${i + 1}: ${matches.slice(0, 5).join(', ')}`);
      }
    });

    // Show relevant portion
    const lowerBody = body.toLowerCase();
    const keywords = ['eta', 'arrival', 'vessel', 'schedule', 'discharge', 'pod'];
    for (const kw of keywords) {
      const idx = lowerBody.indexOf(kw);
      if (idx >= 0) {
        console.log(`\n"${kw}" context:`);
        console.log(body.substring(Math.max(0, idx - 50), idx + 200).replace(/\n{2,}/g, '\n'));
        break;
      }
    }
    console.log('\n');
  }
}

check().catch(console.error);
