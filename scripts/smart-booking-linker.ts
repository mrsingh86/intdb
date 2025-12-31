/**
 * Smart Booking Linker
 *
 * Links shipments to Hapag-Lloyd booking confirmation emails by:
 * 1. Matching booking numbers with various formats
 * 2. Looking in email subjects for booking numbers
 * 3. Prioritizing emails with cutoff entities
 */

import { supabase } from '../utils/supabase-client';
import { parseEntityDate } from '../lib/utils/date-parser';
import dotenv from 'dotenv';

dotenv.config();

async function smartBookingLinker() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         SMART BOOKING LINKER                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Get all Hapag-Lloyd booking confirmation emails with cutoffs
  console.log('1. BUILDING EMAIL CATALOG\n');

  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .eq('sender_email', 'India@service.hlag.com')
    .ilike('subject', 'HL-%');

  const emailCatalog: Map<string, { emailId: string; subject: string; hasCutoffs: boolean }[]> = new Map();

  for (const email of hapagEmails || []) {
    // Extract booking number from subject (HL-XXXXXXXX → XXXXXXXX)
    const match = email.subject?.match(/HL-(\d+)/);
    if (!match) continue;

    const bookingNumber = match[1];

    // Check if this email has cutoffs
    const { data: cutoffs } = await supabase
      .from('entity_extractions')
      .select('id')
      .eq('email_id', email.id)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff'])
      .limit(1);

    const hasCutoffs = cutoffs && cutoffs.length > 0;

    if (!emailCatalog.has(bookingNumber)) {
      emailCatalog.set(bookingNumber, []);
    }
    emailCatalog.get(bookingNumber)!.push({
      emailId: email.id,
      subject: email.subject || '',
      hasCutoffs
    });

    if (hasCutoffs) {
      console.log(`  ${bookingNumber}: ${email.subject?.substring(0, 40)}... ✅ cutoffs`);
    }
  }

  console.log(`\nCatalog: ${emailCatalog.size} booking numbers with emails`);

  // Step 2: Get shipments without cutoffs
  console.log('\n\n2. MATCHING SHIPMENTS\n');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff')
    .is('si_cutoff', null)
    .not('booking_number', 'is', null);

  let linked = 0;

  for (const shipment of shipments || []) {
    const booking = shipment.booking_number || '';

    // Try various formats
    const variations = [
      booking,
      booking.replace(/^HL-/i, ''),
      booking.replace(/^HL/i, ''),
      booking.split(',')[0].trim(), // Handle "263375454, 263375571, ..." format
      booking.match(/\d{8,}/)?.[0] || '', // Extract any 8+ digit number
    ].filter(Boolean);

    let matchedEmail = null;

    for (const variation of variations) {
      const catalogEntry = emailCatalog.get(variation);
      if (catalogEntry) {
        // Prefer email with cutoffs
        const withCutoffs = catalogEntry.find(e => e.hasCutoffs);
        matchedEmail = withCutoffs || catalogEntry[0];
        break;
      }
    }

    if (matchedEmail && matchedEmail.hasCutoffs) {
      // Check if already linked
      const { data: existing } = await supabase
        .from('shipment_documents')
        .select('id')
        .eq('shipment_id', shipment.id)
        .eq('email_id', matchedEmail.emailId)
        .single();

      if (!existing) {
        // Create link
        const { error } = await supabase
          .from('shipment_documents')
          .insert({
            shipment_id: shipment.id,
            email_id: matchedEmail.emailId,
            document_type: 'booking_confirmation'
          });

        if (!error) {
          linked++;
          console.log(`✅ ${booking} → ${matchedEmail.subject.substring(0, 40)}...`);
        }
      }
    }
  }

  console.log(`\nNew links created: ${linked}`);

  // Step 3: Sync entities
  console.log('\n\n3. SYNCING ENTITIES\n');

  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  let updated = 0;

  for (const shipment of allShipments || []) {
    if (shipment.si_cutoff) continue; // Already has cutoffs

    // Get linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) continue;

    // Get entities
    const emailIds = linkedDocs.map(d => d.email_id);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .in('email_id', emailIds)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']);

    if (!entities || entities.length === 0) continue;

    const findEntity = (type: string) => entities.find(e => e.entity_type === type)?.entity_value;

    const updates: Record<string, any> = {};

    if (!shipment.si_cutoff && findEntity('si_cutoff')) {
      updates.si_cutoff = parseEntityDate(findEntity('si_cutoff'));
    }
    if (!shipment.vgm_cutoff && findEntity('vgm_cutoff')) {
      updates.vgm_cutoff = parseEntityDate(findEntity('vgm_cutoff'));
    }
    if (!shipment.cargo_cutoff && findEntity('cargo_cutoff')) {
      updates.cargo_cutoff = parseEntityDate(findEntity('cargo_cutoff'));
    }
    if (!shipment.etd && findEntity('etd')) {
      updates.etd = parseEntityDate(findEntity('etd'));
    }
    if (!shipment.eta && findEntity('eta')) {
      updates.eta = parseEntityDate(findEntity('eta'));
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        updated++;
        console.log(`✅ ${shipment.booking_number}: ${Object.keys(updates).join(', ')}`);
      }
    }
  }

  console.log(`\nShipments updated: ${updated}`);

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

smartBookingLinker().catch(console.error);
