require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getAllRows(table, selectCols = '*', filters = {}) {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    let query = supabase.from(table).select(selectCols);
    if (filters.or) query = query.or(filters.or);
    const { data, error } = await query.range(offset, offset + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allRows;
}

async function analyze() {
  console.log('='.repeat(120));
  console.log('CUSTOMS BROKER & TRUCKING COMPANY EMAIL ANALYSIS');
  console.log('='.repeat(120));

  // ============================================
  // PART 1: CUSTOMS BROKERS
  // ============================================
  console.log('\n\n### PART 1: CUSTOMS BROKER EMAILS ###\n');

  // Search patterns for customs brokers
  const brokerPatterns = [
    'portside', 'artimus', 'sevenseas', 'seven seas'
  ];

  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, email_direction, received_at, body_text')
    .order('received_at', { ascending: false });

  // Filter for broker emails
  const brokerEmails = allEmails?.filter(e => {
    const sender = (e.sender_email || '').toLowerCase();
    return brokerPatterns.some(p => sender.includes(p));
  }) || [];

  console.log('Total broker emails found:', brokerEmails.length);

  // Group by sender domain
  const bySenderDomain = {};
  for (const e of brokerEmails) {
    const domain = (e.sender_email || '').split('@')[1] || 'unknown';
    if (!bySenderDomain[domain]) bySenderDomain[domain] = [];
    bySenderDomain[domain].push(e);
  }

  console.log('\n--- Broker Domains ---');
  for (const [domain, emails] of Object.entries(bySenderDomain)) {
    console.log(`  ${domain}: ${emails.length} emails`);
  }

  // Analyze subject patterns
  console.log('\n\n=== SUBJECT PATTERN ANALYSIS ===\n');

  for (const [domain, emails] of Object.entries(bySenderDomain)) {
    console.log('\n' + '─'.repeat(80));
    console.log(`DOMAIN: ${domain} (${emails.length} emails)`);
    console.log('─'.repeat(80));

    // Categorize by subject keywords
    const categories = {
      'ENTRY/7501': [],
      'ISF': [],
      'DUTY': [],
      'ARRIVAL': [],
      'DELIVERY': [],
      'POD': [],
      'CUSTOMS CLEARANCE': [],
      'RELEASE': [],
      'OTHER': []
    };

    for (const e of emails) {
      const subj = (e.subject || '').toLowerCase();
      if (subj.includes('entry') || subj.includes('7501') || subj.includes('draft')) {
        categories['ENTRY/7501'].push(e);
      } else if (subj.includes('isf')) {
        categories['ISF'].push(e);
      } else if (subj.includes('duty') || subj.includes('invoice')) {
        categories['DUTY'].push(e);
      } else if (subj.includes('arrival') || subj.includes('an ')) {
        categories['ARRIVAL'].push(e);
      } else if (subj.includes('delivery') || subj.includes('do ') || subj.includes('d/o')) {
        categories['DELIVERY'].push(e);
      } else if (subj.includes('pod') || subj.includes('proof')) {
        categories['POD'].push(e);
      } else if (subj.includes('clearance') || subj.includes('cleared')) {
        categories['CUSTOMS CLEARANCE'].push(e);
      } else if (subj.includes('release')) {
        categories['RELEASE'].push(e);
      } else {
        categories['OTHER'].push(e);
      }
    }

    for (const [cat, catEmails] of Object.entries(categories)) {
      if (catEmails.length === 0) continue;
      console.log(`\n  [${cat}] - ${catEmails.length} emails`);
      // Show sample subjects
      const samples = catEmails.slice(0, 5);
      for (const e of samples) {
        console.log(`    [${e.email_direction}] ${(e.subject || 'no subject').substring(0, 90)}`);
      }
    }
  }

  // ============================================
  // PART 2: TRUCKING COMPANIES
  // ============================================
  console.log('\n\n### PART 2: TRUCKING COMPANY EMAILS ###\n');

  const truckingPatterns = [
    'transjet', 'armen', 'freight', 'trucking', 'drayage', 'cartage'
  ];

  const truckingEmails = allEmails?.filter(e => {
    const sender = (e.sender_email || '').toLowerCase();
    return truckingPatterns.some(p => sender.includes(p));
  }) || [];

  console.log('Total trucking emails found:', truckingEmails.length);

  // Group by sender domain
  const byTruckDomain = {};
  for (const e of truckingEmails) {
    const domain = (e.sender_email || '').split('@')[1] || 'unknown';
    if (!byTruckDomain[domain]) byTruckDomain[domain] = [];
    byTruckDomain[domain].push(e);
  }

  console.log('\n--- Trucking Domains ---');
  for (const [domain, emails] of Object.entries(byTruckDomain)) {
    console.log(`  ${domain}: ${emails.length} emails`);
  }

  // Analyze subject patterns for trucking
  console.log('\n\n=== TRUCKING SUBJECT PATTERN ANALYSIS ===\n');

  for (const [domain, emails] of Object.entries(byTruckDomain)) {
    console.log('\n' + '─'.repeat(80));
    console.log(`DOMAIN: ${domain} (${emails.length} emails)`);
    console.log('─'.repeat(80));

    const categories = {
      'POD/DELIVERY CONFIRMATION': [],
      'PICKUP': [],
      'DELIVERY ORDER': [],
      'TRACKING': [],
      'INVOICE': [],
      'OTHER': []
    };

    for (const e of emails) {
      const subj = (e.subject || '').toLowerCase();
      if (subj.includes('pod') || subj.includes('proof') || subj.includes('delivered') || subj.includes('delivery confirmation')) {
        categories['POD/DELIVERY CONFIRMATION'].push(e);
      } else if (subj.includes('pickup') || subj.includes('pick up') || subj.includes('picked')) {
        categories['PICKUP'].push(e);
      } else if (subj.includes('delivery order') || subj.includes('d/o') || subj.includes('do ')) {
        categories['DELIVERY ORDER'].push(e);
      } else if (subj.includes('tracking') || subj.includes('status') || subj.includes('eta')) {
        categories['TRACKING'].push(e);
      } else if (subj.includes('invoice') || subj.includes('billing')) {
        categories['INVOICE'].push(e);
      } else {
        categories['OTHER'].push(e);
      }
    }

    for (const [cat, catEmails] of Object.entries(categories)) {
      if (catEmails.length === 0) continue;
      console.log(`\n  [${cat}] - ${catEmails.length} emails`);
      const samples = catEmails.slice(0, 5);
      for (const e of samples) {
        console.log(`    [${e.email_direction}] ${(e.subject || 'no subject').substring(0, 90)}`);
      }
    }
  }

  // ============================================
  // PART 3: DEEP PATTERN EXTRACTION
  // ============================================
  console.log('\n\n### PART 3: PATTERN EXTRACTION FOR PRODUCTION ###\n');

  // Extract unique sender emails
  const allBrokerSenders = [...new Set(brokerEmails.map(e => e.sender_email))];
  const allTruckingSenders = [...new Set(truckingEmails.map(e => e.sender_email))];

  console.log('=== CUSTOMS BROKER SENDER PATTERNS ===');
  for (const sender of allBrokerSenders) {
    console.log('  ' + sender);
  }

  console.log('\n=== TRUCKING SENDER PATTERNS ===');
  for (const sender of allTruckingSenders) {
    console.log('  ' + sender);
  }

  // Subject keyword extraction
  console.log('\n\n=== RECOMMENDED SUBJECT PATTERNS ===\n');

  console.log('Entry/7501 Detection:');
  const entrySubjects = brokerEmails.filter(e => {
    const s = (e.subject || '').toLowerCase();
    return s.includes('entry') || s.includes('7501') || s.includes('draft');
  });
  const entryPatterns = [...new Set(entrySubjects.map(e => {
    // Extract key phrases
    const s = e.subject || '';
    if (s.match(/entry\s*(summary|approval|draft)/i)) return s.match(/entry\s*(summary|approval|draft)/i)[0];
    if (s.match(/7501/i)) return '7501';
    if (s.match(/draft\s*entry/i)) return 'draft entry';
    return null;
  }).filter(Boolean))];
  console.log('  Patterns:', entryPatterns);

  console.log('\nPOD Detection:');
  const podSubjects = [...brokerEmails, ...truckingEmails].filter(e => {
    const s = (e.subject || '').toLowerCase();
    return s.includes('pod') || s.includes('proof of delivery') || s.includes('delivered');
  });
  for (const e of podSubjects.slice(0, 10)) {
    console.log('  ' + e.subject);
  }

  // ============================================
  // PART 4: DOCUMENT LINKAGE CHECK
  // ============================================
  console.log('\n\n### PART 4: EXISTING DOCUMENT CLASSIFICATIONS ###\n');

  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('id, document_type, email_id');

  const brokerEmailIds = new Set(brokerEmails.map(e => e.id));
  const truckingEmailIds = new Set(truckingEmails.map(e => e.id));

  const brokerDocs = docs?.filter(d => brokerEmailIds.has(d.email_id)) || [];
  const truckingDocs = docs?.filter(d => truckingEmailIds.has(d.email_id)) || [];

  console.log('Broker emails with classified documents:', brokerDocs.length, '/', brokerEmails.length);
  console.log('Trucking emails with classified documents:', truckingDocs.length, '/', truckingEmails.length);

  // Document type breakdown
  const brokerDocTypes = {};
  for (const d of brokerDocs) {
    brokerDocTypes[d.document_type] = (brokerDocTypes[d.document_type] || 0) + 1;
  }
  console.log('\nBroker document types:');
  for (const [type, count] of Object.entries(brokerDocTypes).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + type + ': ' + count);
  }

  const truckDocTypes = {};
  for (const d of truckingDocs) {
    truckDocTypes[d.document_type] = (truckDocTypes[d.document_type] || 0) + 1;
  }
  console.log('\nTrucking document types:');
  for (const [type, count] of Object.entries(truckDocTypes).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + type + ': ' + count);
  }

  // Find unclassified emails
  const unclassifiedBroker = brokerEmails.filter(e => !brokerDocs.some(d => d.email_id === e.id));
  const unclassifiedTrucking = truckingEmails.filter(e => !truckingDocs.some(d => d.email_id === e.id));

  console.log('\n=== UNCLASSIFIED EMAILS ===');
  console.log('Broker emails without documents:', unclassifiedBroker.length);
  console.log('Trucking emails without documents:', unclassifiedTrucking.length);

  console.log('\nSample unclassified broker emails:');
  for (const e of unclassifiedBroker.slice(0, 10)) {
    console.log('  [' + e.email_direction + '] ' + (e.subject || 'no subject').substring(0, 90));
  }

  console.log('\nSample unclassified trucking emails:');
  for (const e of unclassifiedTrucking.slice(0, 10)) {
    console.log('  [' + e.email_direction + '] ' + (e.subject || 'no subject').substring(0, 90));
  }

  console.log('\n' + '='.repeat(120));
}

analyze().catch(console.error);
