async function check() {
  // Check entity extractions via database (through shipments API detail)
  // First get all emails with their entities
  const response = await fetch('http://localhost:3000/api/emails?limit=100');
  const data = await response.json();

  console.log('Checking entity types from all emails...\n');

  // Fetch entities for a few emails
  const entityTypes: Record<string, number> = {};

  for (const email of data.emails.slice(0, 10)) {
    try {
      const entityResponse = await fetch(`http://localhost:3000/api/emails/${email.id}`);
      const emailData = await entityResponse.json();

      if (emailData.entities) {
        emailData.entities.forEach((e: any) => {
          entityTypes[e.entity_type] = (entityTypes[e.entity_type] || 0) + 1;
        });
      }
    } catch (e) {
      // Skip errors
    }
  }

  console.log('Entity types found:');
  Object.entries(entityTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => {
      console.log(`  ${v}x ${k}`);
    });

  // Now specifically check for ETD/ETA entities
  console.log('\n\nChecking all 74 emails for ETD/ETA...');

  let etdCount = 0;
  let etaCount = 0;

  for (const email of data.emails) {
    try {
      const entityResponse = await fetch(`http://localhost:3000/api/emails/${email.id}`);
      const emailData = await entityResponse.json();

      const hasEtd = emailData.entities?.some((e: any) => e.entity_type === 'etd');
      const hasEta = emailData.entities?.some((e: any) => e.entity_type === 'eta');

      if (hasEtd) etdCount++;
      if (hasEta) etaCount++;

      if (hasEtd || hasEta) {
        const etd = emailData.entities?.find((e: any) => e.entity_type === 'etd')?.entity_value;
        const eta = emailData.entities?.find((e: any) => e.entity_type === 'eta')?.entity_value;
        console.log(`  ${email.subject?.substring(0, 50)}`);
        console.log(`    ETD: ${etd || '-'}, ETA: ${eta || '-'}`);
      }
    } catch (e) {
      // Skip errors
    }
  }

  console.log(`\n\nSummary: ${etdCount} emails with ETD, ${etaCount} emails with ETA`);
}

check().catch(console.error);
