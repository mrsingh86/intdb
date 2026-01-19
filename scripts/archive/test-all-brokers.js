/**
 * Test extraction patterns with all three customs brokers:
 * - Portside (portsidecustoms.com)
 * - Artemus (artemus.us, CHBentries@outlook.com)
 * - Seven Seas (sssusainc.com)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Current extraction patterns from email-processing-orchestrator.ts
function extractIdentifiersFromSubject(subject) {
  const result = {};

  // Booking number patterns
  const bookingPatterns = [
    /\b([A-Z]{5,7}\d{8,12}_I)\b/,              // Intoglo Deal ID
    /(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i,
    /\b(26\d{7})\b/,                           // Maersk 9-digit
  ];

  for (const pattern of bookingPatterns) {
    const match = subject.match(pattern);
    if (match && match[1] && match[1].length >= 5) {
      result.booking_number = match[1].toUpperCase();
      break;
    }
  }

  // Container number: 4 letters + 7 digits (ISO 6346)
  const containerMatch = subject.match(/\b([A-Z]{4}\d{7})\b/);
  if (containerMatch && containerMatch[1]) {
    result.container_number = containerMatch[1].toUpperCase();
  }

  // Entry number patterns (US Customs)
  const entryPatterns = [
    /ENTRY\s*(\d{1,3}[A-Z]{1,3}[-\s]*\d{8})/i,   // Artemus: 9JW-04219104
    /\b(\d{3}-\d{7}-\d)(?:-\d{4})?\b/,            // Portside: 165-0625612-8
  ];

  for (const pattern of entryPatterns) {
    const entryMatch = subject.match(pattern);
    if (entryMatch && entryMatch[1]) {
      result.entry_number = entryMatch[1].replace(/\s+/g, '').toUpperCase();
      break;
    }
  }

  // HBL patterns
  const hblPatterns = [
    /HBL(?:\s*NO\.?)?:?\s*([A-Z0-9]{6,})/i,    // Explicit HBL: prefix
    /\b(INTOGLO[-/]?[A-Z0-9]{4,})\b/i,
    /\b(SWLLUD\d{6,})\b/i,
    /\b(LUDSE\d{4,})\b/i,
  ];

  for (const pattern of hblPatterns) {
    const hblMatch = subject.match(pattern);
    if (hblMatch && hblMatch[1]) {
      result.hbl_number = hblMatch[1].toUpperCase();
      break;
    }
  }

  // BL/MBL patterns
  const blPatterns = [
    /BL#?\s*(\d{9,})/i,
    /\b(SE\d{10,})\b/i,
    /\b(MAEU\d{9,}[A-Z0-9]*)\b/i,
    /\b(MEDU[A-Z]{2}\d{6})\b/i,
  ];

  for (const pattern of blPatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      result.bl_number = match[1].toUpperCase();
      break;
    }
  }

  return result;
}

// Classification patterns
const SUBJECT_PATTERNS = [
  // Portside patterns
  { pattern: /\d{3}-\d{7}-\d-3461\b/, type: 'draft_entry', confidence: 95 },
  { pattern: /\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary', confidence: 95 },
  { pattern: /\b7501\b/, type: 'entry_summary', confidence: 85 },
  { pattern: /^Invoice-\d{6,}/i, type: 'duty_invoice', confidence: 95 },
  { pattern: /Cargo\s+Release\s+Update/i, type: 'customs_clearance', confidence: 95 },
  { pattern: /ACE\s+RELEASE/i, type: 'customs_clearance', confidence: 95 },
  // Artemus patterns
  { pattern: /ENTRY\s*\d{1,3}[A-Z]{1,3}[-\s]*\d{8}/i, type: 'entry_summary', confidence: 90 },
  { pattern: /ISF\s+ERROR/i, type: 'isf_filing', confidence: 90 },
  { pattern: /AMS\s+ERROR/i, type: 'ams_filing', confidence: 90 },
  { pattern: /E-Manifest/i, type: 'manifest', confidence: 85 },
  // Trucking patterns
  { pattern: /Work\s+Order\s*:/i, type: 'work_order', confidence: 90 },
  { pattern: /Container\s+(is\s+)?out\b/i, type: 'pickup_confirmation', confidence: 95 },
  { pattern: /\bPOD\b\s*(attached|confirm|received)?/i, type: 'proof_of_delivery', confidence: 95 },
  { pattern: /PRE-ALERT/i, type: 'pre_alert', confidence: 85 },
  { pattern: /Arrival\s+Notice/i, type: 'arrival_notice', confidence: 90 },
];

function classifySubject(subject) {
  for (const { pattern, type, confidence } of SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return { type, confidence };
    }
  }
  return null;
}

async function testBrokers() {
  console.log('='.repeat(100));
  console.log('TESTING ALL THREE CUSTOMS BROKERS');
  console.log('='.repeat(100));

  const brokers = [
    { name: 'Portside', pattern: '%portside%' },
    { name: 'Artemus', pattern: '%artemus%' },
    { name: 'Seven Seas', pattern: '%sssusainc%' },
  ];

  for (const broker of brokers) {
    console.log(`\n\n${'═'.repeat(80)}`);
    console.log(`📋 ${broker.name.toUpperCase()} EMAILS`);
    console.log('═'.repeat(80));

    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email')
      .or(`sender_email.ilike.${broker.pattern},true_sender_email.ilike.${broker.pattern}`)
      .order('received_at', { ascending: false })
      .limit(8);

    console.log(`Found: ${emails?.length || 0} emails\n`);

    let successCount = 0;
    let failCount = 0;

    for (const email of emails || []) {
      const subject = email.subject || '';
      console.log('─'.repeat(70));
      console.log(`Subject: ${subject.substring(0, 65)}${subject.length > 65 ? '...' : ''}`);

      // Test classification
      const classification = classifySubject(subject);
      if (classification) {
        console.log(`  ✅ Classified: ${classification.type} (${classification.confidence}%)`);
        successCount++;
      } else {
        console.log(`  ⚠️  No classification match`);
      }

      // Test extraction
      const extracted = extractIdentifiersFromSubject(subject);
      const hasExtraction = Object.keys(extracted).length > 0;

      if (hasExtraction) {
        if (extracted.booking_number) console.log(`  📦 Booking: ${extracted.booking_number}`);
        if (extracted.entry_number) console.log(`  📋 Entry#: ${extracted.entry_number}`);
        if (extracted.hbl_number) console.log(`  📄 HBL#: ${extracted.hbl_number}`);
        if (extracted.bl_number) console.log(`  📄 BL#: ${extracted.bl_number}`);
        if (extracted.container_number) console.log(`  📦 Container: ${extracted.container_number}`);
        successCount++;
      } else {
        console.log(`  ⚠️  No identifiers extracted`);
        failCount++;
      }
    }

    console.log(`\n📊 ${broker.name} Summary: ${successCount} patterns matched, ${failCount} missed`);
  }

  console.log('\n\n' + '='.repeat(100));
  console.log('TEST COMPLETE');
  console.log('='.repeat(100));
}

testBrokers().catch(console.error);
