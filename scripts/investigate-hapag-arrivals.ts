#!/usr/bin/env npx tsx
/**
 * Investigate why Hapag-Lloyd has 0 arrival notices
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get all Hapag emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('sender_email.ilike.%hlag%,sender_email.ilike.%hapag%,true_sender_email.ilike.%hlag%,true_sender_email.ilike.%hapag%');

  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      HAPAG-LLOYD ARRIVAL NOTICE INVESTIGATION                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Total Hapag emails:', emails?.length);
  console.log('');

  // Look for arrival-related subjects
  const arrivalKeywords = ['arrival', 'arrived', 'discharge', 'unload', 'pod', 'destination', 'delivered', 'delivery'];

  console.log('HAPAG EMAILS WITH ARRIVAL-RELATED KEYWORDS:');
  console.log('═'.repeat(80));

  const arrivalEmails = (emails || []).filter(e => {
    const subject = (e.subject || '').toLowerCase();
    return arrivalKeywords.some(kw => subject.includes(kw));
  });

  console.log('Found:', arrivalEmails.length, 'emails\n');

  for (const e of arrivalEmails.slice(0, 25)) {
    const isReFw = /^(RE|Re|FW|Fw):/i.test(e.subject || '');
    console.log((isReFw ? '[RE/FW] ' : '        ') + (e.subject || '').substring(0, 70));
  }

  console.log('\n');
  console.log('ALL UNIQUE HAPAG SUBJECT PATTERNS (non-RE/FW, top 40):');
  console.log('═'.repeat(80));

  const patterns = new Map<string, number>();
  for (const e of emails || []) {
    const subj = e.subject;
    if (!subj) continue;
    if (/^(RE|Re|FW|Fw):/i.test(subj)) continue;

    // Normalize subject to find patterns
    const norm = subj.substring(0, 55)
      .replace(/\d{7,}/g, 'NNN')
      .replace(/HL-\d+/g, 'HL-XXX')
      .replace(/HLCU[A-Z0-9]+/g, 'HLCUXXX')
      .replace(/Sh#\d+/g, 'Sh#NNN')
      .replace(/Doc#[A-Z0-9]+/g, 'Doc#XXX');

    patterns.set(norm, (patterns.get(norm) || 0) + 1);
  }

  // Sort by count
  const sorted = Array.from(patterns.entries()).sort((a, b) => b[1] - a[1]);
  for (const [p, count] of sorted.slice(0, 40)) {
    console.log(`[${String(count).padStart(3)}x] ${p}`);
  }

  // Check what patterns Hapag uses for arrival notices
  console.log('\n\n');
  console.log('SEARCHING FOR POTENTIAL ARRIVAL NOTICE PATTERNS:');
  console.log('═'.repeat(80));

  const potentialArrival = (emails || []).filter(e => {
    const subj = (e.subject || '').toLowerCase();
    // Common arrival notice patterns from other carriers
    return subj.includes('notice') ||
           subj.includes('notification') ||
           subj.includes('alert') ||
           subj.includes('eta') ||
           subj.includes('ata');
  });

  console.log('Emails with notice/notification/alert/eta/ata:', potentialArrival.length);
  for (const e of potentialArrival.slice(0, 15)) {
    const isReFw = /^(RE|Re|FW|Fw):/i.test(e.subject || '');
    if (!isReFw) {
      console.log('  ' + (e.subject || '').substring(0, 75));
    }
  }
}

main().catch(console.error);
