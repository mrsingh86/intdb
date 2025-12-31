#!/usr/bin/env npx tsx
/**
 * Deep dive into missing classification patterns
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      DEEP DIVE: MISSING CLASSIFICATION PATTERNS                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // ============= MAERSK =============
  console.log('\n' + '═'.repeat(80));
  console.log('📧 MAERSK - Looking for BL, SI patterns');
  console.log('═'.repeat(80));

  const { data: maerskEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%');

  const maerskPatterns: Record<string, string[]> = {};

  for (const e of maerskEmails || []) {
    const s = e.subject || '';
    // Skip already classified
    if (/^Booking Confirmation\s*:/i.test(s)) continue;
    if (/^Booking Amendment/i.test(s)) continue;
    if (/^Arrival notice/i.test(s)) continue;
    if (/^New invoice/i.test(s)) continue;
    if (/^RE:|^Re:|^FW:|^Fw:/i.test(s)) continue;

    // Normalize for grouping
    let norm = s.substring(0, 40)
      .replace(/\d{8,}/g, 'NNN')
      .replace(/[A-Z]{4}\d{7}/g, 'XXX');

    if (!maerskPatterns[norm]) maerskPatterns[norm] = [];
    if (maerskPatterns[norm].length < 2) {
      maerskPatterns[norm].push(s);
    }
  }

  console.log('\nUNCLASSIFIED MAERSK PATTERNS:');
  const sortedMaersk = Object.entries(maerskPatterns).sort((a, b) => b[1].length - a[1].length);
  for (const [pattern, samples] of sortedMaersk.slice(0, 15)) {
    console.log(`\n[${samples.length}x] ${pattern}`);
    console.log(`    Sample: ${samples[0]?.substring(0, 70)}`);
  }

  // ============= HAPAG-LLOYD =============
  console.log('\n\n' + '═'.repeat(80));
  console.log('📧 HAPAG-LLOYD - Looking for Arrival Notice patterns');
  console.log('═'.repeat(80));

  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('sender_email.ilike.%hlag%,sender_email.ilike.%hapag%,true_sender_email.ilike.%hlag%,true_sender_email.ilike.%hapag%');

  const hapagPatterns: Record<string, string[]> = {};

  for (const e of hapagEmails || []) {
    const s = e.subject || '';
    // Skip already classified
    if (/^HL-\d+\s+[A-Z]{5}/i.test(s)) continue;
    if (/^\[Update\]\s+Booking/i.test(s)) continue;
    if (/^Shipping Instruction Submitted/i.test(s)) continue;
    if (/^BL HLCL|^HLCL Sh#|^SW HLCL/i.test(s)) continue;
    if (/^\d+\s+INTOG/i.test(s)) continue;
    if (/^RE:|^Re:|^FW:|^Fw:/i.test(s)) continue;

    let norm = s.substring(0, 40)
      .replace(/\d{8,}/g, 'NNN')
      .replace(/HL-\d+/g, 'HL-XXX');

    if (!hapagPatterns[norm]) hapagPatterns[norm] = [];
    if (hapagPatterns[norm].length < 2) {
      hapagPatterns[norm].push(s);
    }
  }

  console.log('\nUNCLASSIFIED HAPAG PATTERNS:');
  const sortedHapag = Object.entries(hapagPatterns).sort((a, b) => b[1].length - a[1].length);
  for (const [pattern, samples] of sortedHapag.slice(0, 15)) {
    console.log(`\n[${samples.length}x] ${pattern}`);
    console.log(`    Sample: ${samples[0]?.substring(0, 70)}`);
  }

  // ============= CMA CGM =============
  console.log('\n\n' + '═'.repeat(80));
  console.log('📧 CMA CGM - Looking for more patterns');
  console.log('═'.repeat(80));

  const { data: cmaEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('sender_email.ilike.%cma-cgm%,true_sender_email.ilike.%cma-cgm%');

  const cmaPatterns: Record<string, string[]> = {};

  for (const e of cmaEmails || []) {
    const s = e.subject || '';
    // Skip already classified
    if (/^CMA CGM - Booking confirmation/i.test(s)) continue;
    if (/^CMA CGM - Shipping instruction/i.test(s)) continue;
    if (/^CMA CGM - Arrival notice/i.test(s)) continue;
    if (/^My Customer Service.*BL Request/i.test(s)) continue;
    if (/^CMA-CGM Freight Invoice/i.test(s)) continue;
    if (/^RE:|^Re:|^FW:|^Fw:/i.test(s)) continue;

    let norm = s.substring(0, 40)
      .replace(/[A-Z]{3}\d{7}/g, 'XXX');

    if (!cmaPatterns[norm]) cmaPatterns[norm] = [];
    if (cmaPatterns[norm].length < 2) {
      cmaPatterns[norm].push(s);
    }
  }

  console.log('\nUNCLASSIFIED CMA CGM PATTERNS:');
  const sortedCma = Object.entries(cmaPatterns).sort((a, b) => b[1].length - a[1].length);
  for (const [pattern, samples] of sortedCma.slice(0, 15)) {
    console.log(`\n[${samples.length}x] ${pattern}`);
    console.log(`    Sample: ${samples[0]?.substring(0, 70)}`);
  }

  // ============= COSCO =============
  console.log('\n\n' + '═'.repeat(80));
  console.log('📧 COSCO - Looking for more patterns');
  console.log('═'.repeat(80));

  const { data: coscoEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('sender_email.ilike.%coscon%,true_sender_email.ilike.%coscon%');

  const coscoPatterns: Record<string, string[]> = {};

  for (const e of coscoEmails || []) {
    const s = e.subject || '';
    // Skip already classified
    if (/^Cosco Shipping Line Booking Confirmation/i.test(s)) continue;
    if (/^Cosco Shipping Line\s*-Shipment Notice/i.test(s)) continue;
    if (/^COSCO Arrival Notice/i.test(s)) continue;
    if (/^COSCON\s*-\s*(Proforma |Copy )?Bill of Lading/i.test(s)) continue;
    if (/^PROD_Invoice/i.test(s)) continue;
    if (/^COSCO SHIPPING LINES.*Document Shipping Instruction/i.test(s)) continue;
    if (/^RE:|^Re:|^FW:|^Fw:/i.test(s)) continue;

    let norm = s.substring(0, 40)
      .replace(/COSU\d+/g, 'COSU-XXX')
      .replace(/\d{10}/g, 'NNN');

    if (!coscoPatterns[norm]) coscoPatterns[norm] = [];
    if (coscoPatterns[norm].length < 2) {
      coscoPatterns[norm].push(s);
    }
  }

  console.log('\nUNCLASSIFIED COSCO PATTERNS:');
  const sortedCosco = Object.entries(coscoPatterns).sort((a, b) => b[1].length - a[1].length);
  for (const [pattern, samples] of sortedCosco.slice(0, 15)) {
    console.log(`\n[${samples.length}x] ${pattern}`);
    console.log(`    Sample: ${samples[0]?.substring(0, 70)}`);
  }
}

main().catch(console.error);
