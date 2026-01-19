import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get shipment 263814897
  const { data: ship } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .ilike('booking_number', '%263814897%')
    .single();

  console.log('Shipment:', ship?.booking_number);
  console.log('');

  // Get docs linked to this shipment
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type')
    .eq('shipment_id', ship?.id);

  console.log('Checking entity extractions for linked documents:');
  console.log('='.repeat(70));

  let wronglyLinked = 0;
  let linkedViaBooking = 0;
  let linkedViaBL = 0;
  let linkedViaContainer = 0;
  let noEntities = 0;

  for (const doc of docs || []) {
    // Get email details
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text')
      .eq('id', doc.email_id)
      .single();

    // Get entity extractions
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', doc.email_id);

    const bookingEntities = entities?.filter(e => e.entity_type === 'booking_number') || [];
    const blEntities = entities?.filter(e => e.entity_type === 'bl_number') || [];
    const containerEntities = entities?.filter(e => e.entity_type === 'container_number') || [];

    const hasCorrectBookingInSubject = email?.subject?.includes('263814897');
    const hasCorrectBookingInBody = email?.body_text?.includes('263814897');
    const hasCorrectBookingExtracted = bookingEntities.some(e => e.entity_value === '263814897');

    // Check what was extracted
    const extractedBookings = bookingEntities.map(e => e.entity_value).join(', ');
    const extractedBLs = blEntities.map(e => e.entity_value).join(', ');

    if (!entities || entities.length === 0) {
      noEntities++;
    } else if (hasCorrectBookingExtracted) {
      linkedViaBooking++;
      // Check if this is a wrong link (booking not actually in email content)
      if (!hasCorrectBookingInSubject && !hasCorrectBookingInBody) {
        wronglyLinked++;
        console.log('');
        console.log('WRONG LINK (extracted 263814897 but not in email):');
        console.log('  Doc:', doc.document_type);
        console.log('  Subject:', email?.subject?.slice(0, 60));
        console.log('  Extracted:', extractedBookings);
        console.log('  Body preview:', email?.body_text?.slice(0, 200));
      }
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY:');
  console.log('  Total linked docs:', docs?.length);
  console.log('  No entities extracted:', noEntities);
  console.log('  Linked via booking_number extraction:', linkedViaBooking);
  console.log('  Wrongly linked (263814897 extracted but not in email):', wronglyLinked);
}

main().catch(console.error);
