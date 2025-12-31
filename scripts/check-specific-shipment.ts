/**
 * Check Specific Shipment
 *
 * Traces data flow for a specific booking number
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function checkSpecificShipment() {
  const bookingNum = 'HL-22970937';

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`CHECKING BOOKING: ${bookingNum}`);
  console.log('═'.repeat(70));

  // Find the email
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .ilike('subject', `%${bookingNum}%`);

  console.log(`\n1. EMAILS with "${bookingNum}" in subject: ${emails?.length || 0}`);
  for (const email of emails || []) {
    console.log(`   - ${email.id.substring(0, 8)}... : ${email.subject}`);

    // Get entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id)
      .in('entity_type', ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff']);

    console.log(`     Entities: ${entities?.map(e => `${e.entity_type}=${e.entity_value}`).join(', ')}`);
  }

  // Find the shipment
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff')
    .or(`booking_number.eq.${bookingNum},booking_number.eq.22970937`);

  console.log(`\n2. SHIPMENTS matching "${bookingNum}": ${shipments?.length || 0}`);
  for (const s of shipments || []) {
    console.log(`   ID: ${s.id.substring(0, 8)}...`);
    console.log(`   Booking: ${s.booking_number}`);
    console.log(`   ETD: ${s.etd || 'NULL'}`);
    console.log(`   ETA: ${s.eta || 'NULL'}`);
    console.log(`   SI Cutoff: ${s.si_cutoff || 'NULL'}`);
    console.log(`   VGM Cutoff: ${s.vgm_cutoff || 'NULL'}`);
    console.log(`   Cargo Cutoff: ${s.cargo_cutoff || 'NULL'}`);

    // Check linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', s.id);

    console.log(`\n   Linked Documents: ${linkedDocs?.length || 0}`);
    for (const doc of linkedDocs || []) {
      console.log(`     - ${doc.document_type}: ${doc.email_id.substring(0, 8)}...`);
    }
  }

  // Check all shipments for cutoff completeness
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('ALL SHIPMENTS SUMMARY');
  console.log('═'.repeat(70));

  const { data: allShipments } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  const hasCutoffs = allShipments?.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff) || [];
  const hasAllCutoffs = allShipments?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) || [];

  console.log(`Total shipments: ${allShipments?.length || 0}`);
  console.log(`With any cutoff: ${hasCutoffs.length}`);
  console.log(`With ALL cutoffs: ${hasAllCutoffs.length}`);

  console.log('\nShipments WITH cutoffs:');
  for (const s of hasCutoffs) {
    console.log(`  ${s.booking_number}: SI=${s.si_cutoff || 'N'} VGM=${s.vgm_cutoff || 'N'} Cargo=${s.cargo_cutoff || 'N'}`);
  }
}

checkSpecificShipment().catch(console.error);
