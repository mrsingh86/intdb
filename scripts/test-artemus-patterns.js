/**
 * Test extraction patterns with Artemus broker subjects
 */

function extractIdentifiersFromSubject(subject) {
  const result = {};

  // Booking number patterns
  const bookingPatterns = [
    { pattern: /\b([A-Z]{5,7}\d{8,12}_I)\b/, name: 'Intoglo Deal ID' },
    { pattern: /(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i, name: 'Customer Reference' },
    { pattern: /\b(26\d{7})\b/, name: 'Maersk 9-digit' },
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

  // Entry number patterns (Artemus format: 9JW-04219104)
  const entryPatterns = [
    { pattern: /ENTRY\s*(\d{1,3}[A-Z]{1,3}[-\s]*\d{8})/i, name: 'Artemus Entry' },
    { pattern: /\b(\d{3}-\d{7}-\d)\b/, name: 'Portside Entry' },
  ];

  for (const { pattern, name } of entryPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      result.entry_number = match[1].replace(/\s+/g, '').toUpperCase();
      result.entry_method = name;
      break;
    }
  }

  // HBL number patterns (explicit HBL: or HBL NO.: prefix)
  const hblPatterns = [
    { pattern: /HBL(?:\s*NO\.?)?:?\s*([A-Z0-9]{6,})/i, name: 'HBL prefix' },
    { pattern: /\b(INTOGLO[-/]?[A-Z0-9]{4,})\b/i, name: 'Intoglo HBL' },
    { pattern: /\b(SWLLUD\d+)\b/i, name: 'SWL HBL' },
    { pattern: /\b(LUDSE\d+)\b/i, name: 'LUD HBL' },
  ];

  for (const { pattern, name } of hblPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      result.hbl_number = match[1].toUpperCase();
      result.hbl_method = name;
      break;
    }
  }

  // BL/MBL patterns
  const blPatterns = [
    { pattern: /BL#?\s*(\d{9,})/i, name: 'BL# prefix' },
    { pattern: /\b(SE\d{10,})\b/i, name: 'SE prefix' },
    { pattern: /\b(MAEU\d{9,}[A-Z0-9]*)\b/i, name: 'Maersk BL' },
    { pattern: /\b(MEDU[A-Z]{2}\d{6})\b/i, name: 'MSC BL' },
  ];

  for (const { pattern, name } of blPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      result.bl_number = match[1].toUpperCase();
      result.bl_method = name;
      break;
    }
  }

  return result;
}

// Artemus subject lines from the database
const artemusSubjects = [
  'Re: PRE-ALERT // SEINUS17112502710_I // Shipper - SRI VENKATESH AROMAS',
  'Re: ENTRY 9JW-04219104 PRE-ALERT // SEINUS28102502603_I // Shipper -RESILIENT',
  'Re: ENTRY 9JW-04219070 PRE-ALERT // HBL: SWLLUD000344 // Shipper -RESILIENT',
  'Re: ENTRY 9JW- 04219062 PRE-ALERT // SEINUS03112502638_I // Shipper -ROBUST',
  'Re: ISF ERROR | HBL NO.: MEDUJS569930',
  'Re: AMS ERROR | HBL NO.: SE1225003155',
  'Re: PRE-ALERT // HBL: LUDSE0313 // Shipper -RESILIENT AUTOCOMP PVT.LTD',
  'Re: Entry 9JW-04216159 PRE-ALERT // HBL: LUDSE0313 // Shipper -RESILIENT',
  'Payment Receipt 123125-TN from ARTEMUS Transportation Solutions',
  'Re: URGENT PRE-ALERT // SEINUS07102502489_I // Shipper - Emmbros // CONTAINER TEMU1234567',
];

console.log('='.repeat(100));
console.log('TESTING ARTEMUS BROKER SUBJECT PATTERNS');
console.log('='.repeat(100));

for (const subject of artemusSubjects) {
  console.log('\n' + '─'.repeat(80));
  console.log('Subject:', subject.substring(0, 70) + (subject.length > 70 ? '...' : ''));

  const result = extractIdentifiersFromSubject(subject);

  if (result.booking_number) {
    console.log(`  📦 Booking: ${result.booking_number} (${result.booking_method})`);
  }
  if (result.entry_number) {
    console.log(`  📋 Entry#: ${result.entry_number} (${result.entry_method})`);
  }
  if (result.hbl_number) {
    console.log(`  📄 HBL#: ${result.hbl_number} (${result.hbl_method})`);
  }
  if (result.bl_number) {
    console.log(`  📄 BL#: ${result.bl_number} (${result.bl_method})`);
  }
  if (result.container_number) {
    console.log(`  📦 Container: ${result.container_number}`);
  }

  const hasAny = result.booking_number || result.entry_number || result.hbl_number || result.bl_number || result.container_number;
  if (!hasAny) {
    console.log('  ⚠️  NO IDENTIFIERS EXTRACTED');
  }
}

console.log('\n' + '='.repeat(100));
