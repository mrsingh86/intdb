/**
 * Analyze Remaining Gaps
 *
 * Identifies why some shipments still don't have cutoffs:
 * 1. No matching emails
 * 2. Emails exist but no cutoffs extracted
 * 3. Different booking number formats
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function analyzeGaps() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         ANALYZE REMAINING GAPS                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get shipments without cutoffs
  const { data: shipmentsMissing } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff')
    .is('si_cutoff', null);

  console.log(`Shipments without SI cutoff: ${shipmentsMissing?.length || 0}\n`);

  // Categorize by reason
  const categories = {
    noBookingNumber: [] as string[],
    noLinkedDocs: [] as string[],
    linkedButNoEntities: [] as string[],
    potentialMatch: [] as { booking: string; email: string; reason: string }[]
  };

  for (const shipment of shipmentsMissing || []) {
    if (!shipment.booking_number) {
      categories.noBookingNumber.push(shipment.id);
      continue;
    }

    // Check linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) {
      categories.noLinkedDocs.push(shipment.booking_number);
      continue;
    }

    // Check if linked emails have cutoff entities
    const emailIds = linkedDocs.map(d => d.email_id);
    const { data: cutoffEntities } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .in('email_id', emailIds)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff']);

    if (!cutoffEntities || cutoffEntities.length === 0) {
      categories.linkedButNoEntities.push(shipment.booking_number);
    }
  }

  console.log('CATEGORIZATION:');
  console.log(`  No booking number:          ${categories.noBookingNumber.length}`);
  console.log(`  No linked documents:        ${categories.noLinkedDocs.length}`);
  console.log(`  Linked but no cutoff entities: ${categories.linkedButNoEntities.length}`);

  // List the "no linked docs" ones - these might need manual linking
  console.log('\n\nSHIPMENTS WITH NO LINKED DOCUMENTS:');
  console.log('─'.repeat(60));

  for (const booking of categories.noLinkedDocs) {
    // Try to find potential matching emails
    const normalizedBooking = booking.replace(/^HL-/i, '').trim();

    // Search for emails with this booking number in entity_extractions
    const { data: matchingEntities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_value')
      .eq('entity_type', 'booking_number')
      .or(`entity_value.eq.${booking},entity_value.eq.${normalizedBooking},entity_value.eq.HL-${normalizedBooking}`);

    if (matchingEntities && matchingEntities.length > 0) {
      console.log(`\n  ${booking}:`);
      console.log(`    Found ${matchingEntities.length} potential matching emails`);

      for (const entity of matchingEntities) {
        // Check if email has cutoffs
        const { data: cutoffs } = await supabase
          .from('entity_extractions')
          .select('entity_type')
          .eq('email_id', entity.email_id)
          .in('entity_type', ['si_cutoff', 'vgm_cutoff']);

        const hasCutoffs = cutoffs && cutoffs.length > 0;
        console.log(`    → ${entity.email_id.substring(0, 8)}... (cutoffs: ${hasCutoffs ? 'YES' : 'no'})`);

        if (hasCutoffs) {
          categories.potentialMatch.push({
            booking,
            email: entity.email_id,
            reason: 'Has cutoffs'
          });
        }
      }
    } else {
      console.log(`\n  ${booking}: No matching emails found in entity_extractions`);

      // Try to find by subject line
      const { data: subjectMatches } = await supabase
        .from('raw_emails')
        .select('id, subject')
        .or(`subject.ilike.%${booking}%,subject.ilike.%${normalizedBooking}%`)
        .limit(3);

      if (subjectMatches && subjectMatches.length > 0) {
        console.log(`    But found by subject search:`);
        for (const email of subjectMatches) {
          console.log(`    → ${email.subject?.substring(0, 50)}...`);
        }
      }
    }
  }

  // List "linked but no entities"
  console.log('\n\nSHIPMENTS LINKED BUT NO CUTOFF ENTITIES:');
  console.log('─'.repeat(60));

  for (const booking of categories.linkedButNoEntities) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', booking)
      .single();

    if (!shipment) continue;

    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    console.log(`\n  ${booking}:`);

    for (const doc of linkedDocs || []) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email')
        .eq('id', doc.email_id)
        .single();

      console.log(`    [${doc.document_type}] ${email?.subject?.substring(0, 40)}...`);
      console.log(`      From: ${email?.sender_email?.substring(0, 30) || 'unknown'}`);
    }
  }

  // Auto-link potential matches
  if (categories.potentialMatch.length > 0) {
    console.log('\n\n' + '═'.repeat(60));
    console.log('AUTO-LINKING POTENTIAL MATCHES');
    console.log('═'.repeat(60));

    for (const match of categories.potentialMatch) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', match.booking)
        .single();

      if (shipment) {
        // Get classification
        const { data: classification } = await supabase
          .from('document_classifications')
          .select('document_type')
          .eq('email_id', match.email)
          .single();

        // Create link
        const { error } = await supabase
          .from('shipment_documents')
          .insert({
            shipment_id: shipment.id,
            email_id: match.email,
            document_type: classification?.document_type || 'booking_confirmation'
          });

        if (!error) {
          console.log(`✅ Linked ${match.booking} → ${match.email.substring(0, 8)}...`);
        }
      }
    }
  }

  console.log('\n🎉 Done!\n');
}

analyzeGaps().catch(console.error);
