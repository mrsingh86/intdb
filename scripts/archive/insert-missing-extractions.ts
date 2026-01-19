/**
 * Insert missing extractions (with proper duplicate handling)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Pagination helper
async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; value: any }
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

// Booking number regex patterns
function extractBookingFromSubject(subject: string): string | null {
  const patterns = [
    /\b(26\d{7})\b/,
    /\b(\d{9})\b/,
    /\b(HL-?\d{8})\b/i,
    /\b(HLCU\d{7,10})\b/i,
    /\b((?:CEI|AMC|CAD)\d{7})\b/i,
    /\b(COSU\d{10})\b/i,
    /\b(MAEU\d{9})\b/i,
    /\b([A-Z]{3}\d{7,10})\b/,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

function extractContainerFromSubject(subject: string): string | null {
  const match = subject.match(/\b([A-Z]{4}\d{7})\b/);
  return match ? match[1].toUpperCase() : null;
}

function extractBlFromSubject(subject: string): string | null {
  const patterns = [
    /\b(SE\d{10,})\b/i,
    /\b(MAEU\d{9,}[A-Z0-9]*)\b/i,
    /\b(HLCU[A-Z0-9]{10,})\b/i,
    /\b(CMAU\d{9,})\b/i,
    /\b(COSU\d{10,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('INSERTING MISSING EXTRACTIONS (WITH DUPLICATE CHECK)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get all existing extractions to check duplicates
  console.log('\n1. Fetching existing extractions...');
  const existingExtractions = await fetchAll<{ email_id: string; entity_type: string }>(
    'entity_extractions', 'email_id, entity_type'
  );

  // Build set of existing (email_id, entity_type) pairs
  const existingSet = new Set(
    existingExtractions.map(e => `${e.email_id}:${e.entity_type}`)
  );
  console.log('   Existing extraction records:', existingExtractions.length);

  // Get classified emails without booking extraction
  const classifications = await fetchAll<{ email_id: string }>(
    'document_classifications', 'email_id'
  );

  const emailsWithBooking = new Set(
    existingExtractions
      .filter(e => e.entity_type === 'booking_number')
      .map(e => e.email_id)
  );

  const missingBookingEmailIds = classifications
    .map(c => c.email_id)
    .filter(id => !emailsWithBooking.has(id));

  console.log('   Emails missing booking #:', missingBookingEmailIds.length);

  // Process and collect new extractions
  console.log('\n2. Extracting identifiers from subjects...');
  const newExtractions: { email_id: string; entity_type: string; entity_value: string; confidence_score: number; extraction_method: string }[] = [];

  const batchSize = 100;
  for (let i = 0; i < missingBookingEmailIds.length; i += batchSize) {
    const batchIds = missingBookingEmailIds.slice(i, i + batchSize);

    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .in('id', batchIds);

    for (const email of emails || []) {
      const subject = email.subject || '';

      // Booking number
      const booking = extractBookingFromSubject(subject);
      if (booking) {
        const key = `${email.id}:booking_number`;
        if (!existingSet.has(key)) {
          newExtractions.push({
            email_id: email.id,
            entity_type: 'booking_number',
            entity_value: booking,
            confidence_score: 80,
            extraction_method: 'regex_subject' // Required field
          });
          existingSet.add(key); // Prevent duplicates within batch
        }
      }

      // Container number
      const container = extractContainerFromSubject(subject);
      if (container) {
        const key = `${email.id}:container_number`;
        if (!existingSet.has(key)) {
          newExtractions.push({
            email_id: email.id,
            entity_type: 'container_number',
            entity_value: container,
            confidence_score: 75,
            extraction_method: 'regex_subject'
          });
          existingSet.add(key);
        }
      }

      // BL number
      const bl = extractBlFromSubject(subject);
      if (bl) {
        const keyBl = `${email.id}:bl_number`;
        if (!existingSet.has(keyBl)) {
          newExtractions.push({
            email_id: email.id,
            entity_type: 'bl_number',
            entity_value: bl,
            confidence_score: 75,
            extraction_method: 'regex_subject'
          });
          existingSet.add(keyBl);
        }

        const keyMbl = `${email.id}:mbl_number`;
        if (!existingSet.has(keyMbl)) {
          newExtractions.push({
            email_id: email.id,
            entity_type: 'mbl_number',
            entity_value: bl,
            confidence_score: 75,
            extraction_method: 'regex_subject'
          });
          existingSet.add(keyMbl);
        }
      }
    }

    if ((i + batchSize) % 500 === 0) {
      console.log(`   Processed ${Math.min(i + batchSize, missingBookingEmailIds.length)} / ${missingBookingEmailIds.length}`);
    }
  }

  console.log('\n3. NEW EXTRACTIONS TO INSERT:');
  console.log('   Total:', newExtractions.length);

  // Group by entity type
  const byType = new Map<string, number>();
  for (const e of newExtractions) {
    byType.set(e.entity_type, (byType.get(e.entity_type) || 0) + 1);
  }
  [...byType.entries()].forEach(([type, count]) => {
    console.log(`   - ${type}: ${count}`);
  });

  // Insert using plain insert (not upsert)
  if (newExtractions.length > 0) {
    console.log('\n4. INSERTING...');
    let inserted = 0;
    let errors = 0;

    const insertBatchSize = 50;
    for (let i = 0; i < newExtractions.length; i += insertBatchSize) {
      const batch = newExtractions.slice(i, i + insertBatchSize);

      const { error } = await supabase
        .from('entity_extractions')
        .insert(batch);

      if (error) {
        errors++;
        if (errors <= 3) {
          console.error('   Error:', error.message);
        }
      } else {
        inserted += batch.length;
      }

      if ((i + insertBatchSize) % 200 === 0) {
        console.log(`   Inserted ${inserted} / ${newExtractions.length}`);
      }
    }

    console.log('\n   Total inserted:', inserted);
    if (errors > 0) console.log('   Batches with errors:', errors);
  }

  // Verify final count
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const { count: finalCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('entity_type', 'booking_number');

  console.log('\n   Total booking_number extractions now:', finalCount);
}

main().catch(console.error);
