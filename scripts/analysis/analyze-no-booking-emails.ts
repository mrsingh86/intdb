import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fetchAll<T>(table: string, select: string, filter?: { column: string; op: string; value: any }): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    if (filter) {
      if (filter.op === 'eq') query = query.eq(filter.column, filter.value);
    }
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('ANALYZING EMAILS WITH NO BOOKING # EXTRACTED');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get all classified email IDs
  const classifications = await fetchAll<{ email_id: string; document_type: string }>(
    'document_classifications', 'email_id, document_type'
  );
  const classifiedEmails = new Map<string, string>();
  for (const c of classifications) {
    classifiedEmails.set(c.email_id, c.document_type);
  }

  // Get all emails with booking extractions
  const extractions = await fetchAll<{ email_id: string }>(
    'entity_extractions', 'email_id', { column: 'entity_type', op: 'eq', value: 'booking_number' }
  );
  const emailsWithBooking = new Set(extractions.map(e => e.email_id));

  // Find classified emails WITHOUT booking extraction
  const noBookingEmailIds: string[] = [];
  for (const [emailId, docType] of classifiedEmails) {
    if (!emailsWithBooking.has(emailId)) {
      noBookingEmailIds.push(emailId);
    }
  }

  console.log('\nTotal classified emails without booking #: ' + noBookingEmailIds.length);

  // Analyze by document type
  const byDocType = new Map<string, number>();
  for (const emailId of noBookingEmailIds) {
    const docType = classifiedEmails.get(emailId) || 'unknown';
    byDocType.set(docType, (byDocType.get(docType) || 0) + 1);
  }

  console.log('\n1. BY DOCUMENT TYPE:');
  console.log('─'.repeat(60));
  [...byDocType.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log('   ' + type.padEnd(30) + count);
  });

  // Sample emails to see what they contain
  console.log('\n2. SAMPLE EMAILS BY TYPE:');
  console.log('─'.repeat(60));

  const typesToCheck = ['booking_confirmation', 'bill_of_lading', 'shipping_instruction', 'arrival_notice', 'invoice', 'not_shipping'];

  for (const docType of typesToCheck) {
    const emailsOfType = noBookingEmailIds.filter(id => classifiedEmails.get(id) === docType);
    if (emailsOfType.length === 0) continue;

    console.log('\n   === ' + docType.toUpperCase() + ' (' + emailsOfType.length + ' without booking #) ===');

    // Get sample emails
    const sampleIds = emailsOfType.slice(0, 5);
    const { data: samples } = await supabase
      .from('raw_emails')
      .select('id, subject, true_sender_email')
      .in('id', sampleIds);

    for (const s of samples || []) {
      // Check if subject contains what looks like a booking number
      const subject = s.subject || '';
      const bookingPattern = /\b(\d{9}|\d{10}|[A-Z]{2,4}\d{7,10}|HL-?\d{8}|HLCU\d+|MAEU\d+|COSU\d+|[A-Z]{3}\d{7})\b/g;
      const matches = subject.match(bookingPattern);

      console.log('\n   Subject: ' + subject.substring(0, 70));
      console.log('   From: ' + (s.true_sender_email || 'unknown'));
      console.log('   Booking patterns in subject: ' + (matches ? matches.join(', ') : 'NONE'));
    }
  }

  // Check how many have booking-like patterns in subject but extraction missed
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('3. EXTRACTION GAPS - Booking patterns in subject but not extracted');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  let hasPatternNoExtraction = 0;
  let noPatternAtAll = 0;
  const missedExtractions: { subject: string; patterns: string[] }[] = [];

  // Check first 500 emails without booking
  const sampleIds = noBookingEmailIds.slice(0, 500);
  const { data: sampleEmails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .in('id', sampleIds);

  const bookingPattern = /\b(\d{9}|\d{10}|[A-Z]{2,4}\d{7,10}|HL-?\d{8}|HLCU\d+|MAEU\d+|COSU\d+|[A-Z]{3}\d{7}|SE\d{10,}|CAD\d{7}|EID\d{7}|CEI\d{7}|AMC\d{7})\b/gi;

  for (const e of sampleEmails || []) {
    const subject = e.subject || '';
    const matches = subject.match(bookingPattern);

    if (matches && matches.length > 0) {
      hasPatternNoExtraction++;
      if (missedExtractions.length < 20) {
        missedExtractions.push({ subject: subject.substring(0, 80), patterns: matches });
      }
    } else {
      noPatternAtAll++;
    }
  }

  console.log('\n   Sample of 500 emails without booking extraction:');
  console.log('   - Has booking-like pattern in subject: ' + hasPatternNoExtraction + ' (extraction missed!)');
  console.log('   - No booking pattern found: ' + noPatternAtAll);

  if (missedExtractions.length > 0) {
    console.log('\n   Examples where extraction MISSED booking # in subject:');
    for (const m of missedExtractions.slice(0, 15)) {
      console.log('   - [' + m.patterns.join(', ') + '] ' + m.subject);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const estimatedMissed = Math.round((hasPatternNoExtraction / 500) * noBookingEmailIds.length);
  console.log('\n   Emails without booking # extracted: ' + noBookingEmailIds.length);
  console.log('   Estimated with booking pattern but missed: ~' + estimatedMissed);
  console.log('   Estimated truly no booking #: ~' + (noBookingEmailIds.length - estimatedMissed));
}

main().catch(console.error);
