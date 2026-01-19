/**
 * Link Shipments to Carrier Booking Confirmation Emails
 *
 * Finds shipments missing data and links them to actual Hapag-Lloyd
 * booking confirmation emails that have the entities extracted.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function linkShipmentsToCarrierEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         LINK SHIPMENTS TO CARRIER EMAILS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Get all Hapag-Lloyd booking confirmations with cutoff entities
  console.log('1. FINDING HAPAG-LLOYD BOOKING CONFIRMATIONS WITH CUTOFFS\n');

  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .or('sender_email.ilike.%@service.hlag.com,sender_email.ilike.%India@service.hlag.com')
    .ilike('subject', 'HL-%');

  console.log(`Found ${hapagEmails?.length || 0} Hapag-Lloyd HL-* emails\n`);

  const emailsWithCutoffs: { emailId: string; bookingNumber: string; subject: string; entities: string[] }[] = [];

  for (const email of hapagEmails || []) {
    // Get entities for this email
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta', 'booking_number']);

    const hasCutoffs = entities?.some(e => ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff'].includes(e.entity_type));

    if (hasCutoffs) {
      // Extract booking number from subject (HL-XXXXXXXX)
      const bookingMatch = email.subject?.match(/HL-(\d+)/);
      const bookingNumber = bookingMatch ? bookingMatch[1] : null;

      if (bookingNumber) {
        emailsWithCutoffs.push({
          emailId: email.id,
          bookingNumber,
          subject: email.subject || '',
          entities: entities?.map(e => e.entity_type) || []
        });
        console.log(`  ✅ ${email.subject}: ${entities?.filter(e => e.entity_type.includes('cutoff')).length} cutoffs`);
      }
    }
  }

  console.log(`\nTotal emails with cutoffs: ${emailsWithCutoffs.length}`);

  // Step 2: Find shipments missing cutoffs
  console.log('\n\n2. FINDING SHIPMENTS MISSING CUTOFFS\n');

  const { data: shipmentsMissing } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff')
    .is('si_cutoff', null);

  console.log(`Shipments without SI cutoff: ${shipmentsMissing?.length || 0}`);

  // Step 3: Match and link
  console.log('\n\n3. MATCHING AND LINKING\n');

  let linked = 0;

  for (const shipment of shipmentsMissing || []) {
    const bookingNum = (shipment.booking_number || '').replace(/^HL-/, '');

    // Find matching Hapag-Lloyd email
    const matchingEmail = emailsWithCutoffs.find(e => e.bookingNumber === bookingNum);

    if (matchingEmail) {
      console.log(`\nMatching: Shipment ${shipment.booking_number} → Email ${matchingEmail.subject.substring(0, 40)}...`);

      // Check if already linked
      const { data: existing } = await supabase
        .from('shipment_documents')
        .select('id')
        .eq('shipment_id', shipment.id)
        .eq('email_id', matchingEmail.emailId)
        .single();

      if (existing) {
        console.log('  Already linked');
      } else {
        // Get classification for the email
        const { data: classification } = await supabase
          .from('document_classifications')
          .select('document_type')
          .eq('email_id', matchingEmail.emailId)
          .single();

        // Create link
        const { error: linkError } = await supabase
          .from('shipment_documents')
          .insert({
            shipment_id: shipment.id,
            email_id: matchingEmail.emailId,
            document_type: classification?.document_type || 'booking_confirmation'
          });

        if (!linkError) {
          console.log('  ✅ Linked successfully');
          linked++;
        } else {
          console.error(`  ❌ Link error: ${linkError.message}`);
        }
      }
    }
  }

  console.log(`\n\n✅ New links created: ${linked}`);

  // Step 4: Now sync entities to shipments
  console.log('\n\n4. SYNCING ENTITIES TO NEWLY LINKED SHIPMENTS\n');

  // Re-fetch shipments missing cutoffs that now have links
  const { data: shipmentsToUpdate } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff')
    .is('si_cutoff', null);

  let updated = 0;

  for (const shipment of shipmentsToUpdate || []) {
    // Get linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) continue;

    const emailIds = linkedDocs.map(d => d.email_id);

    // Get entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .in('email_id', emailIds)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']);

    if (!entities || entities.length === 0) continue;

    const findEntity = (type: string) => entities.find(e => e.entity_type === type)?.entity_value;

    const updates: Record<string, any> = {};

    // Parse date helper
    const parseDate = (value: string | null) => {
      if (!value) return null;
      // Handle ISO datetime
      const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];
      return null;
    };

    if (!shipment.si_cutoff && findEntity('si_cutoff')) {
      updates.si_cutoff = parseDate(findEntity('si_cutoff'));
    }
    if (!shipment.vgm_cutoff && findEntity('vgm_cutoff')) {
      updates.vgm_cutoff = parseDate(findEntity('vgm_cutoff'));
    }
    if (!shipment.cargo_cutoff && findEntity('cargo_cutoff')) {
      updates.cargo_cutoff = parseDate(findEntity('cargo_cutoff'));
    }
    if (!shipment.etd && findEntity('etd')) {
      updates.etd = parseDate(findEntity('etd'));
    }
    if (!shipment.eta && findEntity('eta')) {
      updates.eta = parseDate(findEntity('eta'));
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!updateError) {
        updated++;
        console.log(`✅ ${shipment.booking_number}: ${Object.keys(updates).join(', ')}`);
      }
    }
  }

  console.log(`\n✅ Shipments updated: ${updated}`);

  // Final stats
  console.log('\n\n' + '═'.repeat(70));
  console.log('FINAL DATA COMPLETENESS');
  console.log('═'.repeat(70));

  const { data: finalStats } = await supabase
    .from('shipments')
    .select('etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  if (finalStats) {
    const total = finalStats.length;
    console.log(`\nTotal shipments: ${total}`);
    console.log(`  ETD:          ${finalStats.filter(s => s.etd).length}/${total} (${Math.round(finalStats.filter(s => s.etd).length/total*100)}%)`);
    console.log(`  ETA:          ${finalStats.filter(s => s.eta).length}/${total} (${Math.round(finalStats.filter(s => s.eta).length/total*100)}%)`);
    console.log(`  SI Cutoff:    ${finalStats.filter(s => s.si_cutoff).length}/${total} (${Math.round(finalStats.filter(s => s.si_cutoff).length/total*100)}%)`);
    console.log(`  VGM Cutoff:   ${finalStats.filter(s => s.vgm_cutoff).length}/${total} (${Math.round(finalStats.filter(s => s.vgm_cutoff).length/total*100)}%)`);
    console.log(`  Cargo Cutoff: ${finalStats.filter(s => s.cargo_cutoff).length}/${total} (${Math.round(finalStats.filter(s => s.cargo_cutoff).length/total*100)}%)`);
  }

  console.log('\n🎉 Done!\n');
}

linkShipmentsToCarrierEmails().catch(console.error);
