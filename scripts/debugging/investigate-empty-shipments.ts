/**
 * Investigate shipments with no details
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigate() {
  const bookings = ['94295687', '90103235', '23148119', '15902716', '12079970', '263455422', '263453241'];

  for (const bkg of bookings) {
    console.log('\n' + '='.repeat(70));
    console.log('BOOKING:', bkg);

    // Get shipment
    const { data: ship } = await supabase
      .from('shipments')
      .select('id, booking_number, created_from_email_id')
      .eq('booking_number', bkg)
      .single();

    if (!ship) {
      console.log('  NOT FOUND');
      continue;
    }

    // Get linked documents
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', ship.id);

    console.log('  Linked docs:', docs?.length || 0);
    for (const d of docs || []) {
      console.log('    -', d.document_type);
    }

    // Get source email subject
    if (ship.created_from_email_id) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email')
        .eq('id', ship.created_from_email_id)
        .single();

      console.log('  Source email:');
      console.log('    Subject:', email?.subject?.substring(0, 70));
      console.log('    From:', email?.sender_email);
    }

    // Get all linked email subjects
    const emailIds = docs?.map(d => d.email_id) || [];
    if (emailIds.length > 0) {
      const { data: emails } = await supabase
        .from('raw_emails')
        .select('subject')
        .in('id', emailIds);

      console.log('  Linked email subjects:');
      for (const e of emails || []) {
        console.log('    -', e.subject?.substring(0, 60));
      }

      // Get entities from linked emails
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .in('email_id', emailIds);

      console.log('  Extracted entities:', entities?.length || 0);
      if (entities && entities.length > 0) {
        const types: Record<string, number> = {};
        for (const e of entities) {
          types[e.entity_type] = (types[e.entity_type] || 0) + 1;
        }
        for (const [type, count] of Object.entries(types)) {
          console.log('    ', type, ':', count);
        }

        // Show some sample values
        console.log('  Sample entity values:');
        const samples = entities.slice(0, 5);
        for (const s of samples) {
          console.log('    ', s.entity_type, '=', s.entity_value?.substring(0, 40));
        }
      }
    }
  }
}

investigate().catch(console.error);
