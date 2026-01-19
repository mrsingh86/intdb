require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function deepAnalysis() {
  console.log('='.repeat(120));
  console.log('DEEP PATTERN ANALYSIS - CUSTOMS BROKER & TRUCKING');
  console.log('='.repeat(120));

  // Get all emails with body text
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, email_direction, body_text, received_at')
    .order('received_at', { ascending: false });

  // Get all attachments
  const { data: allAttachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, content_type, file_size');

  console.log('\nTotal emails:', allEmails?.length);
  console.log('Total attachments:', allAttachments?.length);

  // Filter for broker and trucking emails
  const brokerPatterns = ['portside', 'artimus', 'sevenseas'];
  const truckingPatterns = ['transjet', 'armen', 'wolverine', 'kiswani', 'buckland'];

  const brokerEmails = allEmails?.filter(e => {
    const sender = (e.sender_email || '').toLowerCase();
    return brokerPatterns.some(p => sender.includes(p));
  }) || [];

  const truckingEmails = allEmails?.filter(e => {
    const sender = (e.sender_email || '').toLowerCase();
    return truckingPatterns.some(p => sender.includes(p));
  }) || [];

  // ============================================
  // PORTSIDE CUSTOMS BROKER ANALYSIS
  // ============================================
  console.log('\n\n' + '═'.repeat(120));
  console.log('PORTSIDE CUSTOMS BROKER - DETAILED ANALYSIS');
  console.log('═'.repeat(120));

  for (const email of brokerEmails.slice(0, 10)) {
    console.log('\n' + '─'.repeat(100));
    console.log('Subject: ' + email.subject);
    console.log('From: ' + email.sender_email);
    console.log('Direction: ' + email.email_direction);
    console.log('Date: ' + email.received_at);

    // Check for attachments
    const attachments = allAttachments?.filter(a => a.email_id === email.id) || [];
    console.log('Attachments: ' + attachments.length);
    for (const att of attachments) {
      console.log('  - ' + att.filename + ' (' + att.content_type + ', ' + Math.round(att.file_size/1024) + 'KB)');
    }

    // Show body preview
    const body = (email.body_text || '').substring(0, 500);
    console.log('\nBody Preview:');
    console.log(body.replace(/\n/g, '\n  '));

    // Extract key patterns from subject
    const subject = email.subject || '';
    console.log('\n--- Pattern Extraction ---');

    // Entry number pattern: XXX-XXXXXXX-X
    const entryMatch = subject.match(/(\d{3}-\d{7}-\d)/);
    if (entryMatch) console.log('  Entry Number: ' + entryMatch[1]);

    // 7501 form detection
    if (subject.includes('7501')) console.log('  Document Type: 7501 Entry Summary');

    // 3461 form detection
    if (subject.includes('3461')) console.log('  Document Type: 3461 Entry/Immediate Delivery');

    // Invoice pattern
    const invoiceMatch = subject.match(/Invoice[- ]?(\d+)/i);
    if (invoiceMatch) console.log('  Invoice Number: ' + invoiceMatch[1]);

    // Customer reference pattern
    const custRefMatch = subject.match(/(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i);
    if (custRefMatch) console.log('  Customer Ref (Booking#): ' + custRefMatch[1]);

    // Cargo release detection
    if (subject.toLowerCase().includes('release')) console.log('  Event Type: Cargo Release');
  }

  // ============================================
  // SUBJECT PATTERN CLASSIFICATION
  // ============================================
  console.log('\n\n' + '═'.repeat(120));
  console.log('PORTSIDE SUBJECT PATTERN CLASSIFICATION');
  console.log('═'.repeat(120));

  const portsidePatterns = {
    'entry_summary (7501)': /7501/i,
    'entry_immediate (3461)': /3461/i,
    'duty_invoice': /Invoice[- ]?\d+/i,
    'cargo_release': /release/i,
  };

  console.log('\nPattern matches:');
  for (const [docType, pattern] of Object.entries(portsidePatterns)) {
    const matches = brokerEmails.filter(e => pattern.test(e.subject || ''));
    console.log(`  ${docType}: ${matches.length} emails`);
    for (const m of matches) {
      console.log(`    - ${m.subject}`);
    }
  }

  // ============================================
  // TRANSJET TRUCKING ANALYSIS
  // ============================================
  console.log('\n\n' + '═'.repeat(120));
  console.log('TRANSJET TRUCKING - DETAILED ANALYSIS');
  console.log('═'.repeat(120));

  const transjetEmails = truckingEmails.filter(e =>
    (e.sender_email || '').toLowerCase().includes('transjet')
  );

  console.log('\nTransjet emails:', transjetEmails.length);

  for (const email of transjetEmails.slice(0, 5)) {
    console.log('\n' + '─'.repeat(100));
    console.log('Subject: ' + email.subject);
    console.log('From: ' + email.sender_email);

    const attachments = allAttachments?.filter(a => a.email_id === email.id) || [];
    console.log('Attachments: ' + attachments.length);
    for (const att of attachments) {
      console.log('  - ' + att.filename + ' (' + att.content_type + ')');
    }

    // Show body preview
    const body = (email.body_text || '').substring(0, 800);
    console.log('\nBody Preview:');
    console.log(body);

    // Extract patterns
    const subject = email.subject || '';
    console.log('\n--- Pattern Extraction ---');

    // Booking reference pattern
    const bookingMatch = subject.match(/([A-Z]{5,7}\d{8,12}_I)/);
    if (bookingMatch) console.log('  Booking Ref: ' + bookingMatch[1]);

    // Container pattern
    const containerMatch = subject.match(/([A-Z]{4}\d{7})/);
    if (containerMatch) console.log('  Container: ' + containerMatch[1]);
  }

  // ============================================
  // SEARCH FOR POD EMAILS
  // ============================================
  console.log('\n\n' + '═'.repeat(120));
  console.log('SEARCHING FOR POD PATTERNS IN ALL EMAILS');
  console.log('═'.repeat(120));

  const podPatterns = [
    /pod/i,
    /proof\s*(of)?\s*delivery/i,
    /delivered\s*to/i,
    /delivery\s*confirmation/i,
    /delivery\s*complete/i,
    /signed\s*bol/i,
    /signed\s*delivery/i,
  ];

  const podEmails = allEmails?.filter(e => {
    const text = (e.subject || '') + ' ' + (e.body_text || '');
    return podPatterns.some(p => p.test(text));
  }) || [];

  console.log('\nEmails mentioning POD/delivery: ' + podEmails.length);

  // Group by sender domain
  const podBySender = {};
  for (const e of podEmails) {
    const domain = (e.sender_email || '').split('@')[1]?.replace('>', '') || 'unknown';
    if (!podBySender[domain]) podBySender[domain] = [];
    podBySender[domain].push(e);
  }

  console.log('\nPOD emails by sender domain:');
  for (const [domain, emails] of Object.entries(podBySender).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${domain}: ${emails.length} emails`);
    for (const e of emails.slice(0, 3)) {
      console.log(`    [${e.email_direction}] ${(e.subject || '').substring(0, 80)}`);
    }
  }

  // ============================================
  // RECOMMENDED PRODUCTION CODE CHANGES
  // ============================================
  console.log('\n\n' + '═'.repeat(120));
  console.log('RECOMMENDED DOCUMENT TYPE DETECTION PATTERNS');
  console.log('═'.repeat(120));

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ CUSTOMS BROKER DETECTION (Portside, Artimus, Seven Seas)                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Sender Patterns:                                                                    │
│   - *@portsidecustoms.com                                                          │
│   - *@artimus*.com                                                                 │
│   - *@sevenseas*.com                                                               │
│                                                                                     │
│ Document Type Detection:                                                            │
│   entry_summary:     Subject contains "7501"                                        │
│   draft_entry:       Subject contains "3461" OR "draft entry"                       │
│   duty_invoice:      Subject matches /Invoice[- ]?\\d+/i                            │
│   customs_clearance: Subject contains "release" OR "cleared"                        │
│                                                                                     │
│ Booking Number Extraction:                                                          │
│   Pattern: /(Cust\\.?\\s*Ref\\.?|CR#):?\\s*([A-Z0-9_]+)/i                            │
│   Entry #: /(\\d{3}-\\d{7}-\\d)/                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│ TRUCKING COMPANY DETECTION (Transjet, Armen Freight, etc.)                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Sender Patterns:                                                                    │
│   - *@transjetcargo.com                                                            │
│   - *@armenfreight.com                                                             │
│   - *@wolverinefreightways.com                                                     │
│   - *@kiswanifreight.com                                                           │
│   - *@buckland.com                                                                 │
│                                                                                     │
│ Document Type Detection:                                                            │
│   pod:               Subject/body contains "POD" OR "proof of delivery" OR         │
│                      "delivered" OR attachment named "*POD*" OR "*proof*"          │
│   pickup_confirmation: Subject contains "picked up" OR "pickup complete"           │
│   delivery_order:    Subject contains "work order" OR "D/O"                        │
│                                                                                     │
│ Booking Number Extraction:                                                          │
│   Pattern: /([A-Z]{5,7}\\d{8,12}_I)/                                                │
│   Container: /([A-Z]{4}\\d{7})/                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
`);

  console.log('\n' + '='.repeat(120));
}

deepAnalysis().catch(console.error);
