/**
 * Test extraction patterns for HBL, container, and booking from various broker subjects
 */

// Current extraction patterns from email-processing-orchestrator.ts
function extractIdentifiersFromSubject(subject) {
  const result = {};

  // Booking number patterns
  const bookingPatterns = [
    { pattern: /\b([A-Z]{5,7}\d{8,12}_I)\b/, name: 'Intoglo Deal ID' },
    { pattern: /(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i, name: 'Customer Reference' },
    { pattern: /\b(26\d{7})\b/, name: 'Maersk 9-digit' },
    { pattern: /\b(\d{9})\b/, name: 'Generic 9-digit' },
  ];

  for (const { pattern, name } of bookingPatterns) {
    const match = subject.match(pattern);
    if (match && match[1] && match[1].length >= 5) {
      result.booking_number = match[1].toUpperCase();
      result.booking_method = name;
      break;
    }
  }

  // Container number: 4 letters + 7 digits (ISO 6346)
  const containerMatch = subject.match(/\b([A-Z]{4}\d{7})\b/);
  if (containerMatch && containerMatch[1]) {
    result.container_number = containerMatch[1].toUpperCase();
  }

  // BL number patterns
  const blPatterns = [
    { pattern: /BL#?\s*(\d{9,})/i, name: 'BL# prefix' },
    { pattern: /\b(SE\d{10,})\b/i, name: 'SE prefix' },
    { pattern: /\b(MAEU\d{9,}[A-Z0-9]*)\b/i, name: 'Maersk BL' },
    { pattern: /\b(HLCU[A-Z0-9]{10,})\b/i, name: 'Hapag BL' },
    { pattern: /\b(\d{9})\b/, name: 'Generic 9-digit BL' },  // Like 261708626
  ];

  for (const { pattern, name } of blPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      result.bl_number = match[1].toUpperCase();
      result.bl_method = name;
      break;
    }
  }

  // HBL patterns
  const hblPatterns = [
    /\b(INTOGLO[-/]?[A-Z0-9]{4,})\b/i,
    /HBL#?\s*([A-Z0-9-]{6,})/i,
  ];

  for (const pattern of hblPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      result.hbl_number = match[1].toUpperCase();
      break;
    }
  }

  return result;
}

// Test subjects from various brokers
const testSubjects = [
  // JMD Customs (Canada)
  'RE: Please file E-Manifest || BL# 261708626 || Shipper : M&B || SEINOT17112502704_I',
  'RE: Arrival Notice // 261708626 // SEINOT17112502704_I // M&B // MRKU2660917 , TCNU7501437',
  'Re: Transload & Flatbed planning : Container MRKU2660917, TCNU7501437, SUDU8833629',

  // Portside (already tested)
  '165-0625612-8-7501, Cust. Ref. SEINUS26112502782_I',
  'Invoice-0625541, CR#: SECNUS08122502815_I',

  // Trucking with containers
  'RE: Work Order : SEINUS25082502326_I // MSKU1234567 // Houston to OKLAHOMA',
  'Container is out - TEMU7654321',
  'POD attached - HLCU1234567',

  // Arrival notices with multiple identifiers
  'Arrival Notice // BKG# 263522431 // BL# MAEU261708626 // MSKU9876543',
];

console.log('='.repeat(100));
console.log('TESTING EXTRACTION PATTERNS FOR HBL, CONTAINER, BL');
console.log('='.repeat(100));

for (const subject of testSubjects) {
  console.log('\n' + '─'.repeat(80));
  console.log('Subject:', subject.substring(0, 70) + (subject.length > 70 ? '...' : ''));

  const result = extractIdentifiersFromSubject(subject);

  if (result.booking_number) {
    console.log(`  📦 Booking: ${result.booking_number} (${result.booking_method})`);
  }
  if (result.bl_number) {
    console.log(`  📄 BL#: ${result.bl_number} (${result.bl_method})`);
  }
  if (result.hbl_number) {
    console.log(`  📋 HBL#: ${result.hbl_number}`);
  }
  if (result.container_number) {
    console.log(`  📦 Container: ${result.container_number}`);
  }

  if (!result.booking_number && !result.bl_number && !result.container_number) {
    console.log('  ⚠️  NO IDENTIFIERS EXTRACTED');
  }
}

console.log('\n' + '='.repeat(100));
