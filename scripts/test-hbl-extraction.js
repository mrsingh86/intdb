/**
 * Test HBL extraction patterns
 */

const hblPatterns = [
  { pattern: /HBL[#:\s]+([A-Z]{2}\d{10,})/i, name: 'HBL# SE format' },
  { pattern: /\b(SE\d{10,})\b/i, name: 'Standalone SE format' },
  { pattern: /HBL(?:\s*NO\.?)?:?\s*([A-Z0-9]{6,})/i, name: 'HBL: prefix' },
  { pattern: /\b(SWLLUD\d{6,})\b/i, name: 'SWL format' },
  { pattern: /\b(LUDSE\d{4,})\b/i, name: 'LUD format' },
];

const testSubjects = [
  'Re: Arrival Notice : SEINUS15102502521_I // Shipper : Matangi // HBL# SE1025002852',
  'Re: Arrival Notice || HBL: SE1025002873 || Shipper : KIRSTUTT',
  'Re: Work Order : SEINUS15102502540_I // MBL# MAEU260612042 // SE1025002850',
  'Re: PRE-ALERT // HBL: SWLLUD000344 // Shipper -RESILIENT',
  'Re: ISF ERROR | HBL NO.: MEDUJS569930',
  'Re: Entry 9JW-04216159 PRE-ALERT // HBL: LUDSE0313 // Shipper',
  '165-0625612-8-7501, Cust. Ref. SEINUS26112502782_I',  // Portside - no HBL expected
];

console.log('TESTING HBL EXTRACTION\n');
console.log('='.repeat(80));

for (const subject of testSubjects) {
  console.log('\nSubject:', subject.substring(0, 65) + (subject.length > 65 ? '...' : ''));

  let found = false;
  for (const { pattern, name } of hblPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      console.log(`  ✅ HBL#: ${match[1].toUpperCase()} (${name})`);
      found = true;
      break;
    }
  }

  if (!found) {
    console.log('  ⚠️  No HBL found (expected for some emails)');
  }
}

console.log('\n' + '='.repeat(80));
