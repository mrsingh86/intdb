/**
 * Refresh Shipments from Linked Documents
 *
 * Updates shipment data by pulling entities from ALL linked documents
 * via shipment_documents table.
 */

import { supabase } from '../utils/supabase-client';
import { parseEntityDate } from '../lib/utils/date-parser';
import dotenv from 'dotenv';

dotenv.config();

// Entity type priority - booking_confirmation values override others
const SOURCE_PRIORITY: Record<string, number> = {
  'booking_confirmation': 100,
  'booking_amendment': 90,
  'shipping_instruction': 60,
  'bill_of_lading': 50,
  'arrival_notice': 40,
  'invoice': 30,
  'other': 10,
};

async function refreshShipments() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         REFRESH SHIPMENTS FROM LINKED DOCUMENTS                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipments
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, port_of_loading, port_of_discharge, vessel_name, si_cutoff, vgm_cutoff, cargo_cutoff')
    .order('created_at', { ascending: false });

  if (error || !shipments) {
    console.error('Error fetching shipments:', error);
    return;
  }

  console.log(`Found ${shipments.length} shipments to refresh\n`);

  let totalUpdated = 0;
  let totalFieldsUpdated = 0;

  for (const shipment of shipments) {
    console.log(`\n[${shipment.booking_number}]`);

    // Get linked documents for this shipment
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) {
      console.log('  No linked documents');
      continue;
    }

    const emailIds = linkedDocs.map(d => d.email_id);
    console.log(`  Found ${emailIds.length} linked documents`);

    // Get all entities from linked emails, with source document type
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, source_document_type, confidence_score')
      .in('email_id', emailIds);

    if (!entities || entities.length === 0) {
      console.log('  No entities found');
      continue;
    }

    // Sort entities by source priority (booking_confirmation first)
    const sortedEntities = entities.sort((a, b) => {
      const priorityA = SOURCE_PRIORITY[a.source_document_type || 'other'] || 0;
      const priorityB = SOURCE_PRIORITY[b.source_document_type || 'other'] || 0;
      return priorityB - priorityA;
    });

    // Helper to find best entity value
    const findBestEntity = (type: string): string | null => {
      const match = sortedEntities.find(e => e.entity_type === type);
      return match?.entity_value || null;
    };

    // Build updates
    const updates: Record<string, any> = {};
    const updatedFields: string[] = [];

    // ETD/ETA
    if (!shipment.etd) {
      const etdValue = findBestEntity('etd');
      if (etdValue) {
        const parsed = parseEntityDate(etdValue);
        if (parsed) {
          updates.etd = parsed;
          updatedFields.push(`ETD: ${parsed}`);
        }
      }
    }

    if (!shipment.eta) {
      const etaValue = findBestEntity('eta');
      if (etaValue) {
        const parsed = parseEntityDate(etaValue);
        if (parsed) {
          updates.eta = parsed;
          updatedFields.push(`ETA: ${parsed}`);
        }
      }
    }

    // Cutoffs
    if (!shipment.si_cutoff) {
      const siValue = findBestEntity('si_cutoff');
      if (siValue) {
        const parsed = parseEntityDate(siValue);
        if (parsed) {
          updates.si_cutoff = parsed;
          updatedFields.push(`SI Cutoff: ${parsed}`);
        }
      }
    }

    if (!shipment.vgm_cutoff) {
      const vgmValue = findBestEntity('vgm_cutoff');
      if (vgmValue) {
        const parsed = parseEntityDate(vgmValue);
        if (parsed) {
          updates.vgm_cutoff = parsed;
          updatedFields.push(`VGM Cutoff: ${parsed}`);
        }
      }
    }

    if (!shipment.cargo_cutoff) {
      const cargoValue = findBestEntity('cargo_cutoff');
      if (cargoValue) {
        const parsed = parseEntityDate(cargoValue);
        if (parsed) {
          updates.cargo_cutoff = parsed;
          updatedFields.push(`Cargo Cutoff: ${parsed}`);
        }
      }
    }

    // Ports
    if (!shipment.port_of_loading) {
      const polValue = findBestEntity('port_of_loading');
      if (polValue) {
        updates.port_of_loading = polValue;
        updatedFields.push(`POL: ${polValue}`);
      }
    }

    if (!shipment.port_of_discharge) {
      const podValue = findBestEntity('port_of_discharge');
      if (podValue) {
        updates.port_of_discharge = podValue;
        updatedFields.push(`POD: ${podValue}`);
      }
    }

    // Vessel
    if (!shipment.vessel_name) {
      const vesselValue = findBestEntity('vessel_name');
      if (vesselValue) {
        updates.vessel_name = vesselValue;
        updatedFields.push(`Vessel: ${vesselValue}`);
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!updateError) {
        totalUpdated++;
        totalFieldsUpdated += updatedFields.length;
        console.log(`  ✅ Updated: ${updatedFields.join(', ')}`);
      } else {
        console.error(`  ❌ Error:`, updateError.message);
      }
    } else {
      console.log('  Already complete');
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Shipments processed:    ${shipments.length}`);
  console.log(`✅ Shipments updated:      ${totalUpdated}`);
  console.log(`✅ Fields updated:         ${totalFieldsUpdated}`);

  // Show data quality stats
  const { data: stats } = await supabase
    .from('shipments')
    .select('etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, port_of_loading, port_of_discharge');

  if (stats) {
    console.log('\nData Completeness:');
    console.log(`  ETD:          ${stats.filter(s => s.etd).length}/${stats.length}`);
    console.log(`  ETA:          ${stats.filter(s => s.eta).length}/${stats.length}`);
    console.log(`  SI Cutoff:    ${stats.filter(s => s.si_cutoff).length}/${stats.length}`);
    console.log(`  VGM Cutoff:   ${stats.filter(s => s.vgm_cutoff).length}/${stats.length}`);
    console.log(`  Cargo Cutoff: ${stats.filter(s => s.cargo_cutoff).length}/${stats.length}`);
    console.log(`  POL:          ${stats.filter(s => s.port_of_loading).length}/${stats.length}`);
    console.log(`  POD:          ${stats.filter(s => s.port_of_discharge).length}/${stats.length}`);
  }

  console.log('\n🎉 Done!\n');
}

refreshShipments().catch(console.error);
