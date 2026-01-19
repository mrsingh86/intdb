/**
 * Re-run extraction on emails missing booking numbers
 *
 * This script finds classified emails without booking_number in entity_extractions
 * and re-processes them using the updated orchestrator with regex fallback.
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

// Booking number regex patterns (same as orchestrator)
function extractBookingFromSubject(subject: string): string | null {
  const patterns = [
    /\b(26\d{7})\b/,                           // Maersk: 9-digit starting with 26
    /\b(\d{9})\b/,                             // Generic 9-digit
    /\b(HL-?\d{8})\b/i,                        // Hapag: HL-XXXXXXXX
    /\b(HLCU\d{7,10})\b/i,                     // Hapag: HLCU prefix
    /\b((?:CEI|AMC|CAD)\d{7})\b/i,             // CMA CGM: CAD/CEI/AMC + 7 digits
    /\b(COSU\d{10})\b/i,                       // COSCO: COSU + 10 digits
    /\b(MAEU\d{9})\b/i,                        // Maersk: MAEU prefix
    /\b([A-Z]{3}\d{7,10})\b/,                  // Generic carrier prefix + digits
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

// Extract container number from subject
function extractContainerFromSubject(subject: string): string | null {
  const match = subject.match(/\b([A-Z]{4}\d{7})\b/);
  return match ? match[1].toUpperCase() : null;
}

// Extract BL from subject
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
  console.log('RE-RUNNING EXTRACTION ON EMAILS MISSING BOOKING NUMBERS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get all classified email IDs
  const classifications = await fetchAll<{ email_id: string; document_type: string }>(
    'document_classifications', 'email_id, document_type'
  );
  console.log('\n1. Total classified emails:', classifications.length);

  // Get all emails with booking extractions
  const existingExtractions = await fetchAll<{ email_id: string }>(
    'entity_extractions', 'email_id', { column: 'entity_type', value: 'booking_number' }
  );
  const emailsWithBooking = new Set(existingExtractions.map(e => e.email_id));
  console.log('   Emails with booking # extracted:', emailsWithBooking.size);

  // Find classified emails WITHOUT booking extraction
  const missingBookingEmailIds = classifications
    .map(c => c.email_id)
    .filter(id => !emailsWithBooking.has(id));

  console.log('   Emails missing booking #:', missingBookingEmailIds.length);

  // Fetch email subjects for missing emails
  console.log('\n2. Fetching subjects for emails missing booking #...');

  let extracted = 0;
  let noPatternFound = 0;
  const newExtractions: { email_id: string; entity_type: string; entity_value: string; confidence_score: number }[] = [];

  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < missingBookingEmailIds.length; i += batchSize) {
    const batchIds = missingBookingEmailIds.slice(i, i + batchSize);

    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .in('id', batchIds);

    for (const email of emails || []) {
      const subject = email.subject || '';

      // Try to extract booking number
      const booking = extractBookingFromSubject(subject);
      if (booking) {
        newExtractions.push({
          email_id: email.id,
          entity_type: 'booking_number',
          entity_value: booking,
          confidence_score: 80 // Regex extraction confidence
        });
        extracted++;
      }

      // Also extract container number if present
      const container = extractContainerFromSubject(subject);
      if (container) {
        newExtractions.push({
          email_id: email.id,
          entity_type: 'container_number',
          entity_value: container,
          confidence_score: 75
        });
      }

      // Also extract BL if present
      const bl = extractBlFromSubject(subject);
      if (bl) {
        newExtractions.push({
          email_id: email.id,
          entity_type: 'bl_number',
          entity_value: bl,
          confidence_score: 75
        });
        newExtractions.push({
          email_id: email.id,
          entity_type: 'mbl_number',
          entity_value: bl,
          confidence_score: 75
        });
      }

      if (!booking && !container && !bl) {
        noPatternFound++;
      }
    }

    // Progress
    if ((i + batchSize) % 500 === 0 || i + batchSize >= missingBookingEmailIds.length) {
      console.log(`   Processed ${Math.min(i + batchSize, missingBookingEmailIds.length)} / ${missingBookingEmailIds.length}`);
    }
  }

  console.log('\n3. EXTRACTION RESULTS:');
  console.log('─'.repeat(60));
  console.log('   Booking numbers extracted:', extracted);
  console.log('   No pattern found:', noPatternFound);
  console.log('   Total new entities to insert:', newExtractions.length);

  // Insert new extractions
  if (newExtractions.length > 0) {
    console.log('\n4. INSERTING NEW EXTRACTIONS...');

    // Insert in batches
    const insertBatchSize = 100;
    let inserted = 0;

    for (let i = 0; i < newExtractions.length; i += insertBatchSize) {
      const batch = newExtractions.slice(i, i + insertBatchSize);

      const { error } = await supabase
        .from('entity_extractions')
        .upsert(batch, { onConflict: 'email_id,entity_type' });

      if (error) {
        console.error('   Insert error:', error.message);
      } else {
        inserted += batch.length;
      }
    }

    console.log('   Inserted:', inserted, 'entities');
  }

  // Summary with sample extractions
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('\n   Before: ' + emailsWithBooking.size + ' emails with booking #');
  console.log('   After:  ' + (emailsWithBooking.size + extracted) + ' emails with booking #');
  console.log('   Improvement: +' + extracted + ' emails (' + Math.round(extracted / missingBookingEmailIds.length * 100) + '% recovery rate)');

  // Show sample extractions
  if (newExtractions.length > 0) {
    console.log('\n   Sample extracted booking numbers:');
    const bookingExtractions = newExtractions.filter(e => e.entity_type === 'booking_number').slice(0, 10);
    for (const e of bookingExtractions) {
      console.log('   - ' + e.entity_value);
    }
  }
}

main().catch(console.error);
