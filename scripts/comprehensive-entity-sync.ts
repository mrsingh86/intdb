/**
 * Comprehensive Entity Sync
 *
 * 1. Finds all emails with booking numbers in entities
 * 2. Matches them to shipments by booking number
 * 3. Creates missing links
 * 4. Syncs all entities to shipments
 */

import { supabase } from '../utils/supabase-client';
import { parseEntityDate } from '../lib/utils/date-parser';
import dotenv from 'dotenv';

dotenv.config();

async function comprehensiveSync() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         COMPREHENSIVE ENTITY SYNC                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Build a map of booking numbers to emails with cutoffs
  console.log('1. BUILDING BOOKING NUMBER → EMAIL MAP\n');

  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  const emailToBookings: Map<string, Set<string>> = new Map();
  const bookingToEmails: Map<string, Set<string>> = new Map();

  for (const entity of bookingEntities || []) {
    // Normalize booking number (remove HL- prefix, trim)
    const normalizedBooking = entity.entity_value.replace(/^HL-/i, '').trim();

    if (!emailToBookings.has(entity.email_id)) {
      emailToBookings.set(entity.email_id, new Set());
    }
    emailToBookings.get(entity.email_id)!.add(normalizedBooking);

    if (!bookingToEmails.has(normalizedBooking)) {
      bookingToEmails.set(normalizedBooking, new Set());
    }
    bookingToEmails.get(normalizedBooking)!.add(entity.email_id);
  }

  console.log(`Found ${bookingToEmails.size} unique booking numbers across ${emailToBookings.size} emails`);

  // Step 2: Find emails with cutoffs
  const { data: cutoffEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']);

  const emailsWithCutoffs: Map<string, any[]> = new Map();
  for (const entity of cutoffEntities || []) {
    if (!emailsWithCutoffs.has(entity.email_id)) {
      emailsWithCutoffs.set(entity.email_id, []);
    }
    emailsWithCutoffs.get(entity.email_id)!.push(entity);
  }

  console.log(`Found ${emailsWithCutoffs.size} emails with date entities\n`);

  // Step 3: Get all shipments
  console.log('2. MATCHING SHIPMENTS TO EMAILS\n');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  let newLinks = 0;
  let updatedShipments = 0;

  for (const shipment of shipments || []) {
    if (!shipment.booking_number) continue;

    // Normalize booking number
    const normalizedBooking = shipment.booking_number.replace(/^HL-/i, '').trim();

    // Find emails that have this booking number
    const matchingEmailIds = bookingToEmails.get(normalizedBooking);

    if (!matchingEmailIds || matchingEmailIds.size === 0) {
      continue;
    }

    // Find emails with cutoffs among the matching ones
    let linkedNewEmail = false;

    for (const emailId of matchingEmailIds) {
      if (emailsWithCutoffs.has(emailId)) {
        // Check if already linked
        const { data: existing } = await supabase
          .from('shipment_documents')
          .select('id')
          .eq('shipment_id', shipment.id)
          .eq('email_id', emailId)
          .single();

        if (!existing) {
          // Get classification
          const { data: classification } = await supabase
            .from('document_classifications')
            .select('document_type')
            .eq('email_id', emailId)
            .single();

          // Create link
          const { error: linkError } = await supabase
            .from('shipment_documents')
            .insert({
              shipment_id: shipment.id,
              email_id: emailId,
              document_type: classification?.document_type || 'booking_confirmation'
            });

          if (!linkError) {
            newLinks++;
            linkedNewEmail = true;
            console.log(`✅ Linked ${shipment.booking_number} → email with cutoffs`);
          }
        }
      }
    }
  }

  console.log(`\nNew links created: ${newLinks}`);

  // Step 4: Sync entities to shipments
  console.log('\n\n3. SYNCING ENTITIES TO SHIPMENTS\n');

  // Refetch shipments after linking
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, port_of_loading, port_of_discharge, vessel_name');

  for (const shipment of allShipments || []) {
    // Get all linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) continue;

    const emailIds = linkedDocs.map(d => d.email_id);

    // Get all entities from linked emails
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, source_document_type')
      .in('email_id', emailIds);

    if (!entities || entities.length === 0) continue;

    // Sort by source priority
    const sorted = entities.sort((a, b) => {
      const priority: Record<string, number> = {
        'booking_confirmation': 100,
        'booking_amendment': 80,
        'bill_of_lading': 60,
        'shipping_instruction': 40
      };
      return (priority[b.source_document_type || ''] || 0) - (priority[a.source_document_type || ''] || 0);
    });

    const findEntity = (type: string) => sorted.find(e => e.entity_type === type)?.entity_value;

    const updates: Record<string, any> = {};
    const changes: string[] = [];

    // Update missing fields
    if (!shipment.etd) {
      const val = findEntity('etd');
      if (val) {
        const parsed = parseEntityDate(val);
        if (parsed) {
          updates.etd = parsed;
          changes.push('ETD');
        }
      }
    }

    if (!shipment.eta) {
      const val = findEntity('eta');
      if (val) {
        const parsed = parseEntityDate(val);
        if (parsed) {
          updates.eta = parsed;
          changes.push('ETA');
        }
      }
    }

    if (!shipment.si_cutoff) {
      const val = findEntity('si_cutoff');
      if (val) {
        const parsed = parseEntityDate(val);
        if (parsed) {
          updates.si_cutoff = parsed;
          changes.push('SI');
        }
      }
    }

    if (!shipment.vgm_cutoff) {
      const val = findEntity('vgm_cutoff');
      if (val) {
        const parsed = parseEntityDate(val);
        if (parsed) {
          updates.vgm_cutoff = parsed;
          changes.push('VGM');
        }
      }
    }

    if (!shipment.cargo_cutoff) {
      const val = findEntity('cargo_cutoff');
      if (val) {
        const parsed = parseEntityDate(val);
        if (parsed) {
          updates.cargo_cutoff = parsed;
          changes.push('Cargo');
        }
      }
    }

    if (!shipment.port_of_loading) {
      const val = findEntity('port_of_loading');
      if (val) {
        updates.port_of_loading = val;
        changes.push('POL');
      }
    }

    if (!shipment.port_of_discharge) {
      const val = findEntity('port_of_discharge');
      if (val) {
        updates.port_of_discharge = val;
        changes.push('POD');
      }
    }

    if (!shipment.vessel_name) {
      const val = findEntity('vessel_name');
      if (val) {
        updates.vessel_name = val;
        changes.push('Vessel');
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!updateError) {
        updatedShipments++;
        console.log(`✅ ${shipment.booking_number}: ${changes.join(', ')}`);
      }
    }
  }

  console.log(`\nShipments updated: ${updatedShipments}`);

  // Final stats
  console.log('\n\n' + '═'.repeat(70));
  console.log('FINAL DATA COMPLETENESS');
  console.log('═'.repeat(70));

  const { data: finalStats } = await supabase
    .from('shipments')
    .select('etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, port_of_loading, port_of_discharge, vessel_name');

  if (finalStats) {
    const total = finalStats.length;
    console.log(`\nTotal shipments: ${total}`);
    console.log(`  ETD:          ${finalStats.filter(s => s.etd).length}/${total} (${Math.round(finalStats.filter(s => s.etd).length/total*100)}%)`);
    console.log(`  ETA:          ${finalStats.filter(s => s.eta).length}/${total} (${Math.round(finalStats.filter(s => s.eta).length/total*100)}%)`);
    console.log(`  SI Cutoff:    ${finalStats.filter(s => s.si_cutoff).length}/${total} (${Math.round(finalStats.filter(s => s.si_cutoff).length/total*100)}%)`);
    console.log(`  VGM Cutoff:   ${finalStats.filter(s => s.vgm_cutoff).length}/${total} (${Math.round(finalStats.filter(s => s.vgm_cutoff).length/total*100)}%)`);
    console.log(`  Cargo Cutoff: ${finalStats.filter(s => s.cargo_cutoff).length}/${total} (${Math.round(finalStats.filter(s => s.cargo_cutoff).length/total*100)}%)`);
    console.log(`  POL:          ${finalStats.filter(s => s.port_of_loading).length}/${total} (${Math.round(finalStats.filter(s => s.port_of_loading).length/total*100)}%)`);
    console.log(`  POD:          ${finalStats.filter(s => s.port_of_discharge).length}/${total} (${Math.round(finalStats.filter(s => s.port_of_discharge).length/total*100)}%)`);
    console.log(`  Vessel:       ${finalStats.filter(s => s.vessel_name).length}/${total} (${Math.round(finalStats.filter(s => s.vessel_name).length/total*100)}%)`);
  }

  console.log('\n🎉 Done!\n');
}

comprehensiveSync().catch(console.error);
