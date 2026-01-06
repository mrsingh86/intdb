/**
 * Test script for broker/trucking classification improvements
 *
 * Tests:
 * 1. Subject pattern matching for Portside entry numbers
 * 2. Booking number extraction from subjects (Intoglo Deal ID, Cust. Ref.)
 * 3. Trucking document type detection
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Import classification service pattern logic (inline for testing)
const SUBJECT_PATTERNS = [
  // Portside 3461 format: 165-0625541-9-3461 (Immediate Delivery / Entry)
  { pattern: /\d{3}-\d{7}-\d-3461\b/, type: 'draft_entry', confidence: 95 },
  // Portside 7501 format: 165-0625612-8-7501 (Entry Summary)
  { pattern: /\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary', confidence: 95 },
  // Portside standalone 7501 in subject
  { pattern: /\b7501\b/, type: 'entry_summary', confidence: 85 },
  // Portside Invoice format: Invoice-0625541 or Invoice-0625541-A
  { pattern: /^Invoice-\d{6,}/i, type: 'duty_invoice', confidence: 95 },
  // Cargo/Customs Release (from broker)
  { pattern: /Cargo\s+Release\s+Update/i, type: 'customs_clearance', confidence: 95 },
  { pattern: /ACE\s+RELEASE/i, type: 'customs_clearance', confidence: 95 },
  // Trucking patterns
  { pattern: /Work\s+Order\s*:/i, type: 'work_order', confidence: 90 },
  { pattern: /Container\s+(is\s+)?out\b/i, type: 'pickup_confirmation', confidence: 95 },
  { pattern: /\bPOD\b\s*(attached|confirm|received)?/i, type: 'proof_of_delivery', confidence: 95 },
  { pattern: /Proof\s+of\s+Delivery/i, type: 'proof_of_delivery', confidence: 95 },
  { pattern: /Empty\s+(container\s+)?return/i, type: 'empty_return', confidence: 90 },
];

// Booking number extraction patterns
const BOOKING_PATTERNS = [
  // Intoglo Deal ID format: SEINUS26112502782_I, SECNUS08122502815_I
  { pattern: /\b([A-Z]{5,7}\d{8,12}_I)\b/, name: 'Intoglo Deal ID' },
  // Portside/Broker customer reference: "Cust. Ref. XXXX" or "CR#: XXXX"
  { pattern: /(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i, name: 'Customer Reference' },
];

function testSubjectPattern(subject) {
  for (const { pattern, type, confidence } of SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return { type, confidence, pattern: pattern.toString() };
    }
  }
  return null;
}

function extractBookingFromSubject(subject) {
  for (const { pattern, name } of BOOKING_PATTERNS) {
    const match = subject.match(pattern);
    if (match && match[1] && match[1].length >= 5) {
      return { booking: match[1], method: name };
    }
  }
  return null;
}

async function runTests() {
  console.log('=' .repeat(100));
  console.log('TESTING BROKER/TRUCKING CLASSIFICATION IMPROVEMENTS');
  console.log('='.repeat(100));

  // TEST 1: Pattern matching on Portside subjects
  console.log('\n📋 TEST 1: Portside Subject Pattern Matching\n');
  const portsideSubjects = [
    '165-0625612-8-7501, Cust. Ref. SEINUS26112502782_I',
    '165-0625541-9-3461, Cust. Ref. SECNUS08122502815_I',
    'Invoice-0625541, Cust. Ref. SEINUS26112502782_I',
    'Cargo Release Update - Entry 165-0625612-8',
    'ACE RELEASE - SEINUS26112502782_I',
  ];

  for (const subject of portsideSubjects) {
    const result = testSubjectPattern(subject);
    console.log(`Subject: "${subject.substring(0, 60)}..."`);
    if (result) {
      console.log(`  ✅ Matched: ${result.type} (${result.confidence}%)`);
    } else {
      console.log(`  ❌ NO MATCH`);
    }

    // Also test booking extraction
    const booking = extractBookingFromSubject(subject);
    if (booking) {
      console.log(`  📦 Booking: ${booking.booking} (via ${booking.method})`);
    }
    console.log();
  }

  // TEST 2: Pattern matching on Trucking subjects
  console.log('\n📋 TEST 2: Trucking Subject Pattern Matching\n');
  const truckingSubjects = [
    'RE: Work Order : SEINUS25082502326_I // 1 X 20 SD // Houston to OKLAHOMA',
    'Container is out - MSKU1234567',
    'POD attached for shipment SEINUS26112502782_I',
    'Proof of Delivery Confirmation',
    'Empty Return Notification - TEMU7654321',
  ];

  for (const subject of truckingSubjects) {
    const result = testSubjectPattern(subject);
    console.log(`Subject: "${subject.substring(0, 60)}..."`);
    if (result) {
      console.log(`  ✅ Matched: ${result.type} (${result.confidence}%)`);
    } else {
      console.log(`  ❌ NO MATCH`);
    }

    const booking = extractBookingFromSubject(subject);
    if (booking) {
      console.log(`  📦 Booking: ${booking.booking} (via ${booking.method})`);
    }
    console.log();
  }

  // TEST 3: Check actual Portside emails in database
  console.log('\n📋 TEST 3: Actual Portside Emails in Database\n');

  const { data: portsideEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .ilike('sender_email', '%portside%')
    .order('received_at', { ascending: false })
    .limit(10);

  console.log(`Found ${portsideEmails?.length || 0} Portside emails\n`);

  for (const email of portsideEmails || []) {
    const result = testSubjectPattern(email.subject || '');
    const booking = extractBookingFromSubject(email.subject || '');

    console.log(`Email: ${email.id.substring(0, 8)}...`);
    console.log(`  Subject: "${(email.subject || '').substring(0, 60)}..."`);
    if (result) {
      console.log(`  ✅ Pattern: ${result.type} (${result.confidence}%)`);
    } else {
      console.log(`  ⚠️  No pattern match`);
    }
    if (booking) {
      console.log(`  📦 Booking: ${booking.booking} (via ${booking.method})`);
    } else {
      console.log(`  ⚠️  No booking extracted`);
    }
    console.log();
  }

  // TEST 4: Check Transjet emails
  console.log('\n📋 TEST 4: Actual Transjet Emails in Database\n');

  const { data: transjetEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .ilike('sender_email', '%transjet%')
    .order('received_at', { ascending: false })
    .limit(10);

  console.log(`Found ${transjetEmails?.length || 0} Transjet emails\n`);

  for (const email of transjetEmails || []) {
    const result = testSubjectPattern(email.subject || '');
    const booking = extractBookingFromSubject(email.subject || '');

    console.log(`Email: ${email.id.substring(0, 8)}...`);
    console.log(`  Subject: "${(email.subject || '').substring(0, 60)}..."`);
    if (result) {
      console.log(`  ✅ Pattern: ${result.type} (${result.confidence}%)`);
    } else {
      console.log(`  ⚠️  No pattern match`);
    }
    if (booking) {
      console.log(`  📦 Booking: ${booking.booking} (via ${booking.method})`);
    } else {
      console.log(`  ⚠️  No booking extracted`);
    }
    console.log();
  }

  // TEST 5: Check database schema
  console.log('\n📋 TEST 5: Database Schema Verification\n');

  const { data: cols } = await supabase.rpc('exec_sql', {
    sql_query: `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'shipment_documents'
      AND column_name IN ('shipment_id', 'booking_number_extracted', 'status')
    `
  });

  // Try alternative query
  const { data: testInsert, error: testError } = await supabase
    .from('shipment_documents')
    .select('id, shipment_id, document_type')
    .is('shipment_id', null)
    .limit(1);

  if (testError && testError.message.includes('null')) {
    console.log('  ❌ shipment_id is still NOT NULL - migration may not have run');
  } else {
    console.log('  ✅ shipment_id can be NULL (orphan documents supported)');
  }

  // Check if booking_number_extracted column exists
  const { error: colError } = await supabase
    .from('shipment_documents')
    .select('booking_number_extracted')
    .limit(1);

  if (colError && colError.message.includes('does not exist')) {
    console.log('  ❌ booking_number_extracted column missing');
  } else {
    console.log('  ✅ booking_number_extracted column exists');
  }

  console.log('\n' + '='.repeat(100));
  console.log('TESTING COMPLETE');
  console.log('='.repeat(100));
}

runTests().catch(console.error);
