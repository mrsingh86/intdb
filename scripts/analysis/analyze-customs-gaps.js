require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getAllRows(table, selectCols = '*') {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table).select(selectCols).range(offset, offset + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allRows;
}

async function analyzeGaps() {
  console.log('='.repeat(100));
  console.log('CUSTOMS & ENTRY STATE GAP ANALYSIS');
  console.log('='.repeat(100));

  // Get all documents and emails
  const docs = await getAllRows('shipment_documents', 'id, shipment_id, document_type, email_id');
  const emails = await getAllRows('raw_emails', 'id, subject, email_direction, sender_email');

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  console.log('\nTotal documents:', docs.length);
  console.log('Total emails:', emails.length);

  // 1. Find all document types
  const docTypeCounts = {};
  for (const doc of docs) {
    const type = doc.document_type || 'unknown';
    docTypeCounts[type] = (docTypeCounts[type] || 0) + 1;
  }

  console.log('\n\n=== ALL DOCUMENT TYPES ===');
  Object.entries(docTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type.padEnd(40) + count);
    });

  // 2. Find emails with customs/entry related subjects
  console.log('\n\n=== EMAILS WITH CUSTOMS/ENTRY/ISF/DUTY KEYWORDS ===');

  const customsKeywords = [
    'entry', 'customs', 'isf', 'duty', 'clearance', 'cbp',
    'broker', 'import', 'tariff', 'hts', 'bond', '7501',
    'draft entry', 'entry summary', 'customs entry'
  ];

  const customsEmails = emails.filter(e => {
    const subject = (e.subject || '').toLowerCase();
    return customsKeywords.some(kw => subject.includes(kw));
  });

  console.log('\nFound ' + customsEmails.length + ' emails with customs keywords:\n');

  // Group by pattern
  const subjectPatterns = {};
  for (const email of customsEmails) {
    const subject = email.subject || '';
    // Normalize subject for grouping
    const normalized = subject
      .replace(/\d{6,}/g, 'XXXXXX')
      .replace(/[A-Z]{4}\d{7,}/g, 'XXXXXX')
      .substring(0, 80);

    if (!subjectPatterns[normalized]) {
      subjectPatterns[normalized] = [];
    }
    subjectPatterns[normalized].push(email);
  }

  Object.entries(subjectPatterns)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([pattern, emails]) => {
      const directions = emails.map(e => e.email_direction);
      const inCount = directions.filter(d => d === 'inbound').length;
      const outCount = directions.filter(d => d === 'outbound').length;
      console.log(`[${inCount}in/${outCount}out] ${pattern}`);
      // Show one example
      console.log('    Example: ' + emails[0].subject?.substring(0, 100));
      console.log('    From: ' + emails[0].sender_email);
      console.log('');
    });

  // 3. Check what documents are linked to customs emails
  console.log('\n\n=== DOCUMENTS LINKED TO CUSTOMS EMAILS ===');

  const customsEmailIds = new Set(customsEmails.map(e => e.id));
  const customsDocs = docs.filter(d => customsEmailIds.has(d.email_id));

  console.log('\nDocuments linked to customs emails: ' + customsDocs.length);

  const customsDocTypes = {};
  for (const doc of customsDocs) {
    const type = doc.document_type || 'unknown';
    customsDocTypes[type] = (customsDocTypes[type] || 0) + 1;
  }

  console.log('\nDocument types in customs emails:');
  Object.entries(customsDocTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type.padEnd(40) + count);
    });

  // 4. Find ISF related
  console.log('\n\n=== ISF SPECIFIC ANALYSIS ===');

  const isfEmails = emails.filter(e => {
    const subject = (e.subject || '').toLowerCase();
    return subject.includes('isf') || subject.includes('importer security');
  });

  console.log('\nISF emails found: ' + isfEmails.length);
  for (const email of isfEmails.slice(0, 10)) {
    console.log('  [' + email.email_direction + '] ' + email.subject?.substring(0, 80));
  }

  // 5. Find POD related
  console.log('\n\n=== POD SPECIFIC ANALYSIS ===');

  const podEmails = emails.filter(e => {
    const subject = (e.subject || '').toLowerCase();
    return subject.includes('pod') || subject.includes('proof of delivery') ||
           subject.includes('delivery confirmation') || subject.includes('delivered');
  });

  console.log('\nPOD emails found: ' + podEmails.length);
  for (const email of podEmails.slice(0, 10)) {
    console.log('  [' + email.email_direction + '] ' + email.subject?.substring(0, 80));
  }

  // 6. Check entry_summary documents
  console.log('\n\n=== ENTRY_SUMMARY DOCUMENTS ===');

  const entryDocs = docs.filter(d =>
    d.document_type === 'entry_summary' ||
    d.document_type === 'draft_entry' ||
    d.document_type === 'customs_entry'
  );

  console.log('\nEntry-related documents: ' + entryDocs.length);
  for (const doc of entryDocs) {
    const email = emailMap.get(doc.email_id);
    console.log('  Type: ' + doc.document_type);
    console.log('  Direction: ' + email?.email_direction);
    console.log('  Subject: ' + email?.subject?.substring(0, 80));
    console.log('');
  }

  // 7. Recommendations
  console.log('\n\n=== RECOMMENDATIONS ===');
  console.log('='.repeat(100));

  console.log('\n1. DOCUMENT TYPES THAT SHOULD MAP TO CUSTOMS STATES:');

  // Check if we have duty_invoice, customs_document, etc
  const relevantTypes = ['duty_invoice', 'customs_document', 'entry_summary', 'draft_entry', 'isf_submission', 'customs_clearance'];
  for (const type of relevantTypes) {
    const count = docTypeCounts[type] || 0;
    console.log('   ' + type.padEnd(30) + count + ' docs');
  }

  console.log('\n2. EMAILS THAT MAY NEED RECLASSIFICATION:');
  console.log('   Customs-related emails: ' + customsEmails.length);
  console.log('   ISF emails: ' + isfEmails.length);
  console.log('   POD emails: ' + podEmails.length);

  console.log('\n' + '='.repeat(100));
}

analyzeGaps().catch(console.error);
