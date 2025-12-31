#!/usr/bin/env npx tsx
/**
 * Check why booking_confirmations are orphaned
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Get all linked email IDs
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedIds = new Set(links?.map(l => l.email_id) || []);

  // Get all booking_confirmation emails
  const { data: bookingConfirmations } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  console.log('BOOKING CONFIRMATIONS STATUS:');
  console.log('─'.repeat(60));
  console.log(`Total booking_confirmations: ${bookingConfirmations?.length}`);

  // Find orphaned ones
  const orphanedBookings: string[] = [];
  for (const bc of bookingConfirmations || []) {
    if (!linkedIds.has(bc.email_id)) {
      orphanedBookings.push(bc.email_id);
    }
  }

  console.log(`Linked to shipments: ${(bookingConfirmations?.length || 0) - orphanedBookings.length}`);
  console.log(`ORPHANED: ${orphanedBookings.length}`);
  console.log('');

  // Check processing status of orphaned ones
  const { data: orphanedEmails } = await supabase
    .from('raw_emails')
    .select('id, processing_status, subject')
    .in('id', orphanedBookings.slice(0, 20));

  console.log('ORPHANED BOOKING_CONFIRMATION DETAILS:');
  console.log('─'.repeat(60));

  const statusCounts: Record<string, number> = {};
  for (const e of orphanedEmails || []) {
    statusCounts[e.processing_status || 'null'] = (statusCounts[e.processing_status || 'null'] || 0) + 1;
  }

  console.log('Processing status:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log('');
  console.log('Sample orphaned booking_confirmations:');
  for (const e of (orphanedEmails || []).slice(0, 5)) {
    console.log(`  [${e.processing_status}] ${(e.subject || '').substring(0, 60)}`);

    // Check if has entity extractions
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', e.id);

    if (entities && entities.length > 0) {
      console.log(`    Entities: ${entities.length}`);
      const bookingNum = entities.find(e => e.entity_type === 'booking_number');
      if (bookingNum) {
        console.log(`    Booking#: ${bookingNum.entity_value}`);

        // Check if shipment exists
        const { data: shipment } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', bookingNum.entity_value)
          .maybeSingle();

        if (shipment) {
          console.log(`    ⚠️ SHIPMENT EXISTS: ${shipment.id} - Should be linked!`);
        } else {
          console.log(`    ❌ No shipment for this booking number`);
        }
      } else {
        console.log(`    ⚠️ No booking_number extracted`);
      }
    } else {
      console.log(`    ⚠️ NO ENTITY EXTRACTIONS - not fully processed`);
    }
    console.log('');
  }
}

check().catch(console.error);
