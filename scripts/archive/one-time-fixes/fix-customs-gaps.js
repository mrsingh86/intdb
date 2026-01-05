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

async function analyzeAndFix() {
  console.log('='.repeat(100));
  console.log('CUSTOMS/ENTRY DOCUMENT ANALYSIS AND FIX');
  console.log('='.repeat(100));

  const docs = await getAllRows('shipment_documents', 'id, shipment_id, document_type, email_id');
  const emails = await getAllRows('raw_emails', 'id, subject, email_direction, sender_email');

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  // Customs-related document types
  const customsTypes = [
    'customs_document', 'entry_summary', 'draft_entry', 'duty_invoice',
    'customs_clearance', 'isf_submission', 'isf_confirmation'
  ];

  console.log('\n=== CUSTOMS DOCUMENTS WITH DIRECTIONS ===\n');

  const customsDocs = docs.filter(d => customsTypes.includes(d.document_type));

  console.log('Found ' + customsDocs.length + ' customs-related documents:\n');

  const byTypeAndDir = {};

  for (const doc of customsDocs) {
    const email = emailMap.get(doc.email_id);
    const dir = email?.email_direction || 'unknown';
    const key = doc.document_type + ':' + dir;

    if (!byTypeAndDir[key]) {
      byTypeAndDir[key] = [];
    }
    byTypeAndDir[key].push({
      doc,
      email,
    });

    console.log('Type: ' + doc.document_type.padEnd(20) + 'Dir: ' + dir.padEnd(10));
    console.log('  Subject: ' + (email?.subject || '').substring(0, 80));
    console.log('  From: ' + (email?.sender_email || ''));
    console.log('');
  }

  console.log('\n=== SUMMARY BY TYPE:DIRECTION ===\n');
  Object.entries(byTypeAndDir).forEach(([key, docs]) => {
    console.log(key.padEnd(35) + docs.length + ' docs');
  });

  // Check what's NOT mapping to workflow states
  const WORKFLOW_STATE_MAP = {
    'customs_document:inbound': 'duty_invoice_received',
    'customs_document:outbound': 'duty_summary_shared',
    'duty_invoice:inbound': 'duty_invoice_received',
    'duty_invoice:outbound': 'duty_summary_shared',
    'entry_summary:inbound': 'entry_summary_received',
    'entry_summary:outbound': 'entry_summary_shared',
    'draft_entry:inbound': 'entry_draft_received',
    'draft_entry:outbound': 'entry_draft_shared',
    'customs_clearance:inbound': 'customs_cleared',
    'isf_submission:outbound': 'isf_filed',
    'isf_submission:inbound': 'isf_confirmed',
    'isf_confirmation:inbound': 'isf_confirmed',
  };

  console.log('\n=== MAPPING STATUS ===\n');
  Object.entries(byTypeAndDir).forEach(([key, docs]) => {
    const mapping = WORKFLOW_STATE_MAP[key];
    const status = mapping ? '✅ Maps to: ' + mapping : '❌ NO MAPPING';
    console.log(key.padEnd(35) + status);
  });

  // Find emails that should have customs documents but don't
  console.log('\n\n=== EMAILS WITH ENTRY/CUSTOMS KEYWORDS (NOT YET LINKED TO CUSTOMS DOCS) ===\n');

  const customsEmailIds = new Set(customsDocs.map(d => d.email_id));

  const entryPatterns = [
    /entry\s*(approval|summary|draft)/i,
    /7501/i,
    /draft\s*entry/i,
    /entry\s*9[A-Z]{2}/i,
  ];

  const isfPatterns = [
    /isf\s*(filing|file|error|details)/i,
    /importer\s*security\s*filing/i,
  ];

  const potentialEntryEmails = emails.filter(e => {
    if (customsEmailIds.has(e.id)) return false;
    const subject = e.subject || '';
    return entryPatterns.some(p => p.test(subject));
  });

  const potentialIsfEmails = emails.filter(e => {
    if (customsEmailIds.has(e.id)) return false;
    const subject = e.subject || '';
    return isfPatterns.some(p => p.test(subject));
  });

  console.log('Potential ENTRY emails needing classification: ' + potentialEntryEmails.length);
  for (const email of potentialEntryEmails.slice(0, 10)) {
    console.log('  [' + email.email_direction + '] ' + email.subject?.substring(0, 80));
  }

  console.log('\nPotential ISF emails needing classification: ' + potentialIsfEmails.length);
  for (const email of potentialIsfEmails.slice(0, 10)) {
    console.log('  [' + email.email_direction + '] ' + email.subject?.substring(0, 80));
  }

  // Check what shipment_documents exist for these emails
  console.log('\n\n=== DOCUMENTS LINKED TO POTENTIAL ENTRY/ISF EMAILS ===\n');

  const potentialEmailIds = new Set([...potentialEntryEmails, ...potentialIsfEmails].map(e => e.id));
  const linkedDocs = docs.filter(d => potentialEmailIds.has(d.email_id));

  const linkedDocTypes = {};
  for (const doc of linkedDocs) {
    linkedDocTypes[doc.document_type] = (linkedDocTypes[doc.document_type] || 0) + 1;
  }

  console.log('Document types found in potential entry/ISF emails:');
  Object.entries(linkedDocTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type.padEnd(30) + count);
    });

  // RECOMMENDATIONS
  console.log('\n\n=== RECOMMENDATIONS ===');
  console.log('='.repeat(100));

  console.log('\n1. DOCUMENTS THAT NEED DIRECTION FIX:');
  Object.entries(byTypeAndDir).forEach(([key, docs]) => {
    if (key.endsWith(':unknown')) {
      console.log('   ' + key + ' - ' + docs.length + ' docs need direction assigned');
    }
  });

  console.log('\n2. DOCUMENTS THAT NEED RECLASSIFICATION:');
  console.log('   ' + potentialEntryEmails.length + ' emails with "entry" keywords → should be entry_summary or draft_entry');
  console.log('   ' + potentialIsfEmails.length + ' emails with "ISF" keywords → should be isf_submission');

  console.log('\n3. WORKFLOW STATE MAPPING GAPS:');
  const unmappedKeys = Object.keys(byTypeAndDir).filter(k => !WORKFLOW_STATE_MAP[k]);
  for (const key of unmappedKeys) {
    console.log('   ' + key + ' - needs mapping added');
  }

  console.log('\n' + '='.repeat(100));
}

analyzeAndFix().catch(console.error);
