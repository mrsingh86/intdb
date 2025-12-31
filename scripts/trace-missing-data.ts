/**
 * Trace Missing Data
 *
 * For shipments missing data, check if they have linked booking confirmations with entities.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function traceMissingData() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         TRACE MISSING DATA                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get shipments missing SI cutoff
  const { data: shipmentsMissing } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, si_cutoff')
    .is('si_cutoff', null)
    .not('booking_number', 'is', null);

  console.log(`Shipments missing SI cutoff: ${shipmentsMissing?.length || 0}\n`);

  for (const shipment of shipmentsMissing || []) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`SHIPMENT: ${shipment.booking_number} (ETD: ${shipment.etd || 'NULL'})`);

    // Get linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select(`
        email_id,
        document_type
      `)
      .eq('shipment_id', shipment.id);

    console.log(`  Linked documents: ${linkedDocs?.length || 0}`);

    if (!linkedDocs || linkedDocs.length === 0) {
      console.log('  ⚠️  NO LINKED DOCUMENTS - this is the problem');
      continue;
    }

    // Check for booking confirmations
    const bookingConfDocs = linkedDocs.filter(d => d.document_type === 'booking_confirmation');
    console.log(`  Booking confirmations: ${bookingConfDocs.length}`);

    // Get entities from linked emails
    const emailIds = linkedDocs.map(d => d.email_id);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, email_id')
      .in('email_id', emailIds)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']);

    if (entities && entities.length > 0) {
      console.log(`  Date entities available: ${entities.length}`);
      for (const e of entities) {
        console.log(`    📅 ${e.entity_type}: ${e.entity_value} (from ${e.email_id.substring(0, 8)}...)`);
      }
      console.log('  ⚠️  ENTITIES EXIST BUT NOT APPLIED - shipment already has non-null field?');
    } else {
      console.log('  ⚠️  NO DATE ENTITIES in linked documents');

      // Check what emails are linked
      for (const doc of linkedDocs) {
        const { data: email } = await supabase
          .from('raw_emails')
          .select('subject, sender_email')
          .eq('id', doc.email_id)
          .single();

        const { data: classification } = await supabase
          .from('document_classifications')
          .select('document_type')
          .eq('email_id', doc.email_id)
          .single();

        console.log(`    Email: ${email?.subject?.substring(0, 40)}...`);
        console.log(`      Type: ${classification?.document_type || 'unknown'}, From: ${email?.sender_email?.substring(0, 30) || 'unknown'}`);
      }
    }
  }

  // Summary - check booking confirmations without linked shipments
  console.log('\n\n' + '═'.repeat(70));
  console.log('BOOKING CONFIRMATIONS WITHOUT SHIPMENT LINKS');
  console.log('═'.repeat(70));

  const { data: allBookings } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  let unlinkedCount = 0;
  for (const booking of allBookings || []) {
    const { data: linked } = await supabase
      .from('shipment_documents')
      .select('id')
      .eq('email_id', booking.email_id)
      .single();

    if (!linked) {
      unlinkedCount++;
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject')
        .eq('id', booking.email_id)
        .single();
      console.log(`  ❌ ${email?.subject?.substring(0, 60) || booking.email_id}`);
    }
  }

  console.log(`\nTotal unlinked booking confirmations: ${unlinkedCount}/${allBookings?.length || 0}`);
}

traceMissingData().catch(console.error);
