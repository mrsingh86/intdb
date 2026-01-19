require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function diagnose() {
  console.log('='.repeat(120));
  console.log('DIAGNOSING BROKER/TRUCKING EMAIL CLASSIFICATION GAPS');
  console.log('='.repeat(120));

  // 1. Get Portside emails with their processing status
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, processing_status, processing_error, email_direction')
    .order('received_at', { ascending: false });

  // Filter for Portside
  const portsideEmails = allEmails?.filter(e =>
    (e.sender_email || '').toLowerCase().includes('portside')
  ) || [];

  console.log('\n=== PORTSIDE EMAILS ===');
  console.log('Total:', portsideEmails.length);

  for (const email of portsideEmails) {
    console.log('\n─'.repeat(80));
    console.log('Subject:', email.subject);
    console.log('Status:', email.processing_status);
    console.log('Error:', email.processing_error || 'none');
    console.log('Direction:', email.email_direction);
    console.log('ID:', email.id);
  }

  // 2. Check document_classifications table for these emails
  console.log('\n\n=== DOCUMENT CLASSIFICATIONS ===');
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, confidence, classification_method');

  const portsideIds = new Set(portsideEmails.map(e => e.id));
  const portsideClassifications = classifications?.filter(c => portsideIds.has(c.email_id)) || [];

  console.log('Portside emails with classifications:', portsideClassifications.length);
  for (const c of portsideClassifications) {
    const email = portsideEmails.find(e => e.id === c.email_id);
    console.log(`  ${c.document_type} (${c.confidence}%) - ${email?.subject?.substring(0, 60)}`);
  }

  // 3. Check shipment_documents for these emails
  console.log('\n\n=== SHIPMENT DOCUMENTS ===');
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type, shipment_id');

  const portsideDocs = docs?.filter(d => portsideIds.has(d.email_id)) || [];

  console.log('Portside emails with shipment_documents:', portsideDocs.length);
  for (const d of portsideDocs) {
    const email = portsideEmails.find(e => e.id === d.email_id);
    console.log(`  ${d.document_type} - ${email?.subject?.substring(0, 60)}`);
  }

  // 4. Test the subject pattern matching
  console.log('\n\n=== PATTERN MATCHING TEST ===');

  const testPatterns = [
    { name: 'entry_summary (7501)', pattern: /\b7501\b/i },
    { name: 'entry_summary (XXX-XXXXXXX-X-7501)', pattern: /\b\d{3}-\d{7}-\d-7501\b/ },
    { name: 'draft_entry (3461)', pattern: /\b3461\b/i },
    { name: 'duty_invoice (Invoice-XXXX)', pattern: /Invoice[- ]?\d+/i },
    { name: 'customs_clearance (release)', pattern: /release/i },
    { name: 'cargo_release', pattern: /cargo\s*release/i },
  ];

  for (const email of portsideEmails) {
    console.log('\n─'.repeat(60));
    console.log('Subject:', email.subject);
    console.log('Matches:');
    let matched = false;
    for (const { name, pattern } of testPatterns) {
      if (pattern.test(email.subject || '')) {
        console.log('  ✅', name);
        matched = true;
      }
    }
    if (!matched) {
      console.log('  ❌ NO PATTERNS MATCHED');
    }
  }

  // 5. Check Transjet trucking emails
  console.log('\n\n=== TRANSJET TRUCKING EMAILS ===');
  const transjetEmails = allEmails?.filter(e =>
    (e.sender_email || '').toLowerCase().includes('transjet')
  ) || [];

  console.log('Total:', transjetEmails.length);

  const transjetIds = new Set(transjetEmails.map(e => e.id));
  const transjetClassifications = classifications?.filter(c => transjetIds.has(c.email_id)) || [];
  const transjetDocs = docs?.filter(d => transjetIds.has(d.email_id)) || [];

  console.log('With classifications:', transjetClassifications.length);
  console.log('With shipment_documents:', transjetDocs.length);

  // 6. Check processing_logs for recent runs
  console.log('\n\n=== PROCESSING LOGS (Recent) ===');
  const { data: logs } = await supabase
    .from('processing_logs')
    .select('run_type, status, processed_count, error_count, started_at')
    .order('started_at', { ascending: false })
    .limit(5);

  for (const log of logs || []) {
    console.log(`  ${log.run_type}: ${log.status} - ${log.processed_count} processed, ${log.error_count} errors (${log.started_at})`);
  }

  // 7. Root cause analysis
  console.log('\n\n=== ROOT CAUSE ANALYSIS ===');
  console.log('='.repeat(120));

  const unprocessedPortside = portsideEmails.filter(e =>
    e.processing_status !== 'processed' && e.processing_status !== 'classified'
  );
  const noDocPortside = portsideEmails.filter(e =>
    !portsideDocs.some(d => d.email_id === e.id)
  );

  console.log('\n1. PORTSIDE EMAILS NOT PROCESSED:');
  if (unprocessedPortside.length > 0) {
    console.log('   Found', unprocessedPortside.length, 'unprocessed emails');
    console.log('   CAUSE: Emails not going through processing pipeline');
  } else {
    console.log('   All Portside emails have been processed');
  }

  console.log('\n2. PORTSIDE EMAILS WITHOUT DOCUMENTS:');
  console.log('   Found', noDocPortside.length, '/', portsideEmails.length, 'without shipment_documents');

  if (noDocPortside.length > 0) {
    console.log('\n   Subjects without documents:');
    for (const e of noDocPortside) {
      console.log('   -', e.subject);
    }
  }

  console.log('\n3. LIKELY ISSUES:');
  console.log('   a) Portside not recognized as carrier domain → emails may skip extraction');
  console.log('   b) Document type patterns exist but shipment_id is NULL → document not linked');
  console.log('   c) Classification happens but document not created in shipment_documents');

  console.log('\n' + '='.repeat(120));
}

diagnose().catch(console.error);
