/**
 * Force Update Shipment Entities
 *
 * Forces entity values from booking confirmations to shipments,
 * even if shipment field is not null.
 */

import { supabase } from '../utils/supabase-client';
import { parseEntityDate } from '../lib/utils/date-parser';
import dotenv from 'dotenv';

dotenv.config();

async function forceUpdateShipments() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         FORCE UPDATE SHIPMENT ENTITIES                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipments with their linked booking confirmation emails
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      etd,
      eta,
      si_cutoff,
      vgm_cutoff,
      cargo_cutoff,
      port_of_loading,
      port_of_discharge,
      vessel_name
    `);

  if (error || !shipments) {
    console.error('Error fetching shipments:', error);
    return;
  }

  console.log(`Processing ${shipments.length} shipments...\n`);

  let updatedCount = 0;

  for (const shipment of shipments) {
    // Get linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) continue;

    // Get booking confirmation email if exists
    const bookingConfDoc = linkedDocs.find(d => d.document_type === 'booking_confirmation');
    const emailIds = linkedDocs.map(d => d.email_id);

    // Get all entities from linked emails, prioritize booking confirmation
    const { data: allEntities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, email_id, source_document_type')
      .in('email_id', emailIds);

    if (!allEntities || allEntities.length === 0) continue;

    // Prioritize entities from booking confirmation
    const entities = bookingConfDoc
      ? allEntities.sort((a, b) => {
          if (a.email_id === bookingConfDoc.email_id && b.email_id !== bookingConfDoc.email_id) return -1;
          if (b.email_id === bookingConfDoc.email_id && a.email_id !== bookingConfDoc.email_id) return 1;
          return 0;
        })
      : allEntities;

    const findEntity = (type: string) => entities.find(e => e.entity_type === type)?.entity_value;

    const updates: Record<string, any> = {};
    const changes: string[] = [];

    // Force update dates (prioritize extracted over existing if empty/null)
    const etdValue = findEntity('etd');
    if (etdValue && !shipment.etd) {
      const parsed = parseEntityDate(etdValue);
      if (parsed) {
        updates.etd = parsed;
        changes.push(`ETD: ${parsed}`);
      }
    }

    const etaValue = findEntity('eta');
    if (etaValue && !shipment.eta) {
      const parsed = parseEntityDate(etaValue);
      if (parsed) {
        updates.eta = parsed;
        changes.push(`ETA: ${parsed}`);
      }
    }

    const siCutoffValue = findEntity('si_cutoff');
    if (siCutoffValue && !shipment.si_cutoff) {
      const parsed = parseEntityDate(siCutoffValue);
      if (parsed) {
        updates.si_cutoff = parsed;
        changes.push(`SI: ${parsed}`);
      }
    }

    const vgmCutoffValue = findEntity('vgm_cutoff');
    if (vgmCutoffValue && !shipment.vgm_cutoff) {
      const parsed = parseEntityDate(vgmCutoffValue);
      if (parsed) {
        updates.vgm_cutoff = parsed;
        changes.push(`VGM: ${parsed}`);
      }
    }

    const cargoCutoffValue = findEntity('cargo_cutoff');
    if (cargoCutoffValue && !shipment.cargo_cutoff) {
      const parsed = parseEntityDate(cargoCutoffValue);
      if (parsed) {
        updates.cargo_cutoff = parsed;
        changes.push(`Cargo: ${parsed}`);
      }
    }

    // Update ports if missing
    const polValue = findEntity('port_of_loading');
    if (polValue && !shipment.port_of_loading) {
      updates.port_of_loading = polValue;
      changes.push(`POL: ${polValue}`);
    }

    const podValue = findEntity('port_of_discharge');
    if (podValue && !shipment.port_of_discharge) {
      updates.port_of_discharge = podValue;
      changes.push(`POD: ${podValue}`);
    }

    const vesselValue = findEntity('vessel_name');
    if (vesselValue && !shipment.vessel_name) {
      updates.vessel_name = vesselValue;
      changes.push(`Vessel: ${vesselValue}`);
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!updateError) {
        updatedCount++;
        console.log(`[${shipment.booking_number}] ✅ ${changes.join(', ')}`);
      } else {
        console.error(`[${shipment.booking_number}] ❌ ${updateError.message}`);
      }
    }
  }

  // Show final stats
  console.log('\n' + '═'.repeat(70));
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

  console.log(`\n✅ Updated ${updatedCount} shipments`);
  console.log('🎉 Done!\n');
}

forceUpdateShipments().catch(console.error);
