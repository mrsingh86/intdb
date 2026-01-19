#!/usr/bin/env npx tsx
/**
 * Analyze why emails aren't linked to shipments
 *
 * FIXED: Uses pagination to avoid Supabase 1000-row limit
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BATCH_SIZE = 1000;

async function getAllUniqueValues(table: string, column: string): Promise<Set<string>> {
  const values = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.from(table).select(column).range(offset, offset + BATCH_SIZE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      if (row[column]) values.add(row[column]);
    }
    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;
  }

  return values;
}

async function getAllRows<T>(table: string, columns: string): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + BATCH_SIZE - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...(data as T[]));
    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;
  }

  return allRows;
}

async function analyzeUnlinkedEmails() {
  console.log('ANALYZING UNLINKED EMAILS');
  console.log('═'.repeat(70));

  // Get ALL linked email IDs (with pagination)
  const linkedIds = await getAllUniqueValues('shipment_documents', 'email_id');
  console.log(`Total linked emails: ${linkedIds.size}`);

  // Get ALL emails (with pagination)
  type EmailRow = { id: string; subject: string | null; sender_email: string | null; true_sender_email: string | null };
  const allEmails = await getAllRows<EmailRow>('raw_emails', 'id, subject, sender_email, true_sender_email');
  console.log(`Total emails: ${allEmails.length}`);

  const unlinked = allEmails.filter(e => !linkedIds.has(e.id));

  console.log('');
  console.log(`Unlinked emails sample (${unlinked.length} of first 500):`);
  console.log('─'.repeat(70));

  // Categorize by sender domain
  const byDomain: Record<string, number> = {};
  for (const e of unlinked) {
    const sender = e.true_sender_email || e.sender_email || 'unknown';
    const domain = sender.split('@')[1] || 'unknown';
    byDomain[domain] = (byDomain[domain] || 0) + 1;
  }

  console.log('');
  console.log('By sender domain (top 10):');
  const sorted = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [domain, count] of sorted) {
    console.log(`  ${domain.padEnd(35)} ${count}`);
  }

  // Check if unlinked emails have booking numbers extracted
  console.log('');
  console.log('Checking if unlinked emails have booking_number entities...');

  const unlinkedIds = unlinked.slice(0, 100).map(e => e.id);
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', unlinkedIds)
    .eq('entity_type', 'booking_number');

  const emailsWithBooking = new Set(entities?.map(e => e.email_id) || []);

  console.log(`  Unlinked emails checked: ${unlinkedIds.length}`);
  console.log(`  Have booking_number entity: ${emailsWithBooking.size}`);
  console.log(`  Missing booking_number: ${unlinkedIds.length - emailsWithBooking.size}`);

  // Show sample booking numbers that SHOULD have linked
  if (entities && entities.length > 0) {
    console.log('');
    console.log('Sample booking numbers from UNLINKED emails:');
    for (const e of entities.slice(0, 10)) {
      // Check if this booking exists in shipments
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, booking_number')
        .eq('booking_number', e.entity_value)
        .single();

      const status = shipment ? 'SHIPMENT EXISTS - should be linked!' : 'No matching shipment';
      console.log(`  ${e.entity_value} → ${status}`);
    }
  }

  // Check document classifications of unlinked emails
  console.log('');
  console.log('Document types of unlinked emails:');
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', unlinkedIds);

  const byType: Record<string, number> = {};
  for (const c of classifications || []) {
    byType[c.document_type] = (byType[c.document_type] || 0) + 1;
  }

  const sortedTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }
}

analyzeUnlinkedEmails().catch(console.error);
