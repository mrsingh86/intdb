#!/usr/bin/env npx tsx
/**
 * Analyze which document types have cutoff entities
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyze() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('WHERE DO CUTOFFS COME FROM?');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all cutoff entities with their email IDs
  const cutoffTypes = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];
  const cutoffEmails = new Map<string, string[]>();

  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type')
      .in('entity_type', cutoffTypes)
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    for (const e of data) {
      if (!cutoffEmails.has(e.email_id)) {
        cutoffEmails.set(e.email_id, []);
      }
      cutoffEmails.get(e.email_id)!.push(e.entity_type);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Emails with cutoff entities: ${cutoffEmails.size}`);
  console.log('');

  // 2. Get document classifications for those emails
  const emailIds = [...cutoffEmails.keys()];
  const docTypes = new Map<string, number>();
  const docTypesPerCutoff = {
    si_cutoff: new Map<string, number>(),
    vgm_cutoff: new Map<string, number>(),
    cargo_cutoff: new Map<string, number>(),
    gate_cutoff: new Map<string, number>(),
  };

  // Process in batches
  for (let i = 0; i < emailIds.length; i += 100) {
    const batch = emailIds.slice(i, i + 100);
    const { data } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', batch);

    for (const c of data || []) {
      docTypes.set(c.document_type, (docTypes.get(c.document_type) || 0) + 1);

      // Track which cutoffs came from which doc types
      const emailCutoffs = cutoffEmails.get(c.email_id) || [];
      for (const cutoff of emailCutoffs) {
        const map = docTypesPerCutoff[cutoff as keyof typeof docTypesPerCutoff];
        if (map) {
          map.set(c.document_type, (map.get(c.document_type) || 0) + 1);
        }
      }
    }
  }

  console.log('DOCUMENT TYPES containing cutoffs:');
  console.log('─'.repeat(60));
  const sortedTypes = [...docTypes.entries()].sort((a, b) => b[1] - a[1]);
  for (const [docType, count] of sortedTypes.slice(0, 15)) {
    const pct = Math.round((count / cutoffEmails.size) * 100);
    console.log(`  ${docType.padEnd(30)} ${String(count).padStart(4)} (${pct}%)`);
  }

  console.log('');
  console.log('');
  console.log('WHERE EACH CUTOFF TYPE COMES FROM:');
  console.log('─'.repeat(60));

  for (const [cutoff, map] of Object.entries(docTypesPerCutoff)) {
    console.log(`\n${cutoff.toUpperCase()}:`);
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    for (const [docType, count] of sorted.slice(0, 5)) {
      console.log(`  ${docType.padEnd(30)} ${count}`);
    }
  }

  // 3. Check: Do booking confirmations typically have cutoffs?
  console.log('');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('BOOKING CONFIRMATION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all booking confirmation emails
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bookingEmailIds = new Set((bookingEmails || []).map(e => e.email_id));
  console.log(`Total booking confirmation emails: ${bookingEmailIds.size}`);

  // How many booking confirmations have cutoffs?
  let bookingsWithCutoffs = 0;
  for (const emailId of bookingEmailIds) {
    if (cutoffEmails.has(emailId)) {
      bookingsWithCutoffs++;
    }
  }

  const pct = Math.round((bookingsWithCutoffs / bookingEmailIds.size) * 100);
  console.log(`Booking confirmations WITH cutoff data: ${bookingsWithCutoffs} (${pct}%)`);
  console.log(`Booking confirmations WITHOUT cutoff data: ${bookingEmailIds.size - bookingsWithCutoffs} (${100 - pct}%)`);
  console.log('');

  // Sample booking confirmations without cutoffs
  console.log('SAMPLE: Booking confirmations WITHOUT cutoffs:');
  console.log('─'.repeat(60));

  let samples = 0;
  for (const emailId of bookingEmailIds) {
    if (!cutoffEmails.has(emailId) && samples < 5) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email')
        .eq('id', emailId)
        .single();

      console.log(`  Subject: ${(email?.subject || 'N/A').substring(0, 55)}`);
      console.log(`  Sender:  ${email?.sender_email}`);
      console.log('');
      samples++;
    }
  }

  // By carrier/sender
  console.log('');
  console.log('BOOKING CONFIRMATIONS BY SENDER (cutoff presence):');
  console.log('─'.repeat(60));

  const bySender: Record<string, { total: number; withCutoffs: number }> = {};

  for (const emailId of bookingEmailIds) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email')
      .eq('id', emailId)
      .single();

    if (email) {
      const domain = email.sender_email.split('@')[1] || email.sender_email;
      if (!bySender[domain]) {
        bySender[domain] = { total: 0, withCutoffs: 0 };
      }
      bySender[domain].total++;
      if (cutoffEmails.has(emailId)) {
        bySender[domain].withCutoffs++;
      }
    }
  }

  const sortedSenders = Object.entries(bySender)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  for (const [domain, stats] of sortedSenders) {
    const pct = Math.round((stats.withCutoffs / stats.total) * 100);
    console.log(`  ${domain.padEnd(30)} ${stats.withCutoffs}/${stats.total} with cutoffs (${pct}%)`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
