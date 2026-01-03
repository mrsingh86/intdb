/**
 * Test Script: Debug Carrier Detection Functions
 *
 * Tests the exact logic that determines if an email is from a carrier
 */

// Simulate the orchestrator's carrier detection logic
const FALLBACK_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com',
  'cosco.com', 'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];

function isDirectCarrierEmail(trueSenderEmail: string | null, senderEmail: string): boolean {
  const domains = FALLBACK_CARRIER_DOMAINS;

  // First check true_sender_email (preferred - actual sender before forwarding)
  if (trueSenderEmail) {
    const domain = trueSenderEmail.toLowerCase().split('@')[1] || '';
    if (domains.some(d => domain.includes(d))) {
      return true;
    }
  }
  // Fallback to sender_email for direct sends
  if (senderEmail) {
    const domain = senderEmail.toLowerCase().split('@')[1] || '';
    return domains.some(d => domain.includes(d));
  }
  return false;
}

function isKnownCarrierDisplayName(senderEmail: string): boolean {
  const senderLower = senderEmail.toLowerCase();

  // Known Maersk display name patterns
  const maerskPatterns = [
    'in.export',
    'maersk line export',
    'donotreply.*maersk',
    'customer service.*maersk',
  ];
  for (const pattern of maerskPatterns) {
    if (new RegExp(pattern, 'i').test(senderLower)) {
      console.log(`    Maersk pattern match: ${pattern}`);
      return true;
    }
  }

  // Known Hapag-Lloyd patterns
  if (/india@service\.hlag|hapag|hlcu/i.test(senderLower)) {
    console.log('    Hapag-Lloyd pattern match');
    return true;
  }

  // Known CMA CGM patterns (display name only, no domain)
  if (/cma cgm website|cma cgm.*noreply/i.test(senderLower)) {
    console.log('    CMA CGM pattern match');
    return true;
  }

  return false;
}

function isCarrierContentBasedEmail(content: string, detectedCarrier: string, subject?: string): boolean {
  // If we detected a carrier from content, and the content has booking confirmation markers
  if (detectedCarrier !== 'default') {
    const hasBookingConfirmation = /BOOKING CONFIRMATION/i.test(content);
    const hasCarrierBranding = /CMA CGM|MAERSK|HAPAG|MSC|COSCO|EVERGREEN|ONE|YANG MING/i.test(content);
    if (hasBookingConfirmation && hasCarrierBranding) {
      console.log('    Content-based match: BC heading + carrier branding');
      return true;
    }
  }

  // Subject-based detection for known carrier patterns
  if (subject) {
    // Maersk: "Booking Confirmation : 263xxxxxx" (9-digit booking number starting with 26)
    if (/^Booking Confirmation\s*:\s*26\d{7}$/i.test(subject.trim())) {
      console.log('    Subject pattern match: Maersk BC format');
      return true;
    }
    // Hapag-Lloyd: Subject contains HLCU or HL booking patterns
    if (/HLCU\d{7}|HL-?\d{8}/i.test(subject)) {
      console.log('    Subject pattern match: Hapag HL format');
      return true;
    }
    // CMA CGM: "CMA CGM - Booking confirmation available"
    if (/CMA CGM.*Booking confirmation/i.test(subject)) {
      console.log('    Subject pattern match: CMA CGM BC format');
      return true;
    }
  }

  return false;
}

// Test cases from the investigation
const testCases = [
  {
    name: 'Maersk via ops - in.export',
    senderEmail: '"in.export via Operations Intoglo" <ops@intoglo.com>',
    trueSenderEmail: null,
    subject: 'Booking Confirmation : 263805268',
    content: 'Some PDF content with BOOKING CONFIRMATION heading from MAERSK',
  },
  {
    name: 'COSCO via ops - coscon',
    senderEmail: 'coscon via Operations Intoglo <ops@intoglo.com>',
    trueSenderEmail: null,
    subject: 'Booking Details Received from Carrier for COSCO SHIPPING Line',
    content: 'COSCO booking details',
  },
  {
    name: 'CMA CGM via pricing',
    senderEmail: "'CMA CGM Website' via pricing <pricing@intoglo.com>",
    trueSenderEmail: null,
    subject: 'CMA CGM - Export Invoice available - INEPBC26016106',
    content: 'CMA CGM invoice content',
  },
  {
    name: 'Direct Maersk email',
    senderEmail: 'in.export@maersk.com',
    trueSenderEmail: null,
    subject: 'Booking Confirmation : 263825280',
    content: 'Direct Maersk BC',
  },
];

console.log('='.repeat(80));
console.log('CARRIER DETECTION LOGIC TEST');
console.log('='.repeat(80));
console.log('');

for (const test of testCases) {
  console.log(`\nTest: ${test.name}`);
  console.log('-'.repeat(40));
  console.log(`  sender_email: ${test.senderEmail}`);
  console.log(`  true_sender_email: ${test.trueSenderEmail || 'NULL'}`);
  console.log(`  subject: ${test.subject}`);
  console.log('');

  // Test each detection method
  const result1 = isDirectCarrierEmail(test.trueSenderEmail, test.senderEmail);
  console.log(`  isDirectCarrierEmail(): ${result1}`);

  const result2 = isKnownCarrierDisplayName(test.senderEmail);
  console.log(`  isKnownCarrierDisplayName(): ${result2}`);

  const detectedCarrier = test.content.toLowerCase().includes('maersk') ? 'maersk'
    : test.content.toLowerCase().includes('cosco') ? 'cosco'
    : test.content.toLowerCase().includes('cma cgm') ? 'cma-cgm'
    : 'default';

  const result3 = isCarrierContentBasedEmail(test.content, detectedCarrier, test.subject);
  console.log(`  isCarrierContentBasedEmail(): ${result3}`);

  const finalResult = result1 || result2 || result3;
  console.log('');
  console.log(`  >>> FINAL isCarrierEmail: ${finalResult}`);

  if (!finalResult) {
    console.log('  >>> PROBLEM: This carrier BC will NOT create a shipment!');
  }
}

console.log('\n');
console.log('='.repeat(80));
console.log('MISSING CARRIER PATTERNS TO ADD');
console.log('='.repeat(80));
console.log(`
The isKnownCarrierDisplayName() function is MISSING patterns for:

1. COSCO: "coscon via ..." - need pattern: /coscon|cosco/i
2. CMA CGM: "'CMA CGM Website' via pricing" - current pattern requires "noreply"
3. Hapag: "NO_REPLY@HLAG.COM via ..." - need to check for hlag in display name

The function checks senderEmail which includes the display name for "via" emails.

For example:
  - "in.export via Operations Intoglo" <ops@intoglo.com>
    senderEmail.toLowerCase() = '"in.export via operations intoglo" <ops@intoglo.com>'
    Pattern 'in.export' should match... let's see why it doesn't.
`);

// Debug the actual matching
console.log('\nDEBUG: Why "in.export" pattern is not matching:');
const testSender = '"in.export via Operations Intoglo" <ops@intoglo.com>';
const testLower = testSender.toLowerCase();
console.log(`  Input: ${testSender}`);
console.log(`  Lowercase: ${testLower}`);
console.log(`  Pattern: in.export`);
const regex = new RegExp('in.export', 'i');
console.log(`  Regex test: ${regex.test(testLower)}`);
console.log(`  >>> The pattern SHOULD match!`);

// Test without the quotes
console.log('\nLet me test the exact string from database:');
const dbSender = '"in.export via Operations Intoglo" <ops@intoglo.com>';
console.log(`  Database value: ${dbSender}`);
console.log(`  'in.export' in string: ${dbSender.includes('in.export')}`);
console.log(`  Regex match: ${/in\.export/i.test(dbSender)}`);
