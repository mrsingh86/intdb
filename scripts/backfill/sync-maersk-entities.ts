/**
 * Sync Maersk Entities to Shipment
 *
 * The Maersk booking confirmation has ETD/ETA extracted but not synced.
 */

import { supabase } from '../utils/supabase-client';
import { parseEntityDate } from '../lib/utils/date-parser';
import dotenv from 'dotenv';

dotenv.config();

async function syncMaerskEntities() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC MAERSK ENTITIES TO SHIPMENT                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Find the Maersk booking confirmation email
  const { data: maerskEmail } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .eq('subject', 'Booking Confirmation - MAEU9876543210')
    .single();

  if (!maerskEmail) {
    console.log('Maersk email not found');
    return;
  }

  console.log(`Found email: ${maerskEmail.subject}`);

  // Get entities
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .eq('email_id', maerskEmail.id);

  console.log(`\nEntities (${entities?.length || 0}):`);
  const uniqueEntities = new Map<string, string>();
  entities?.forEach(e => {
    if (!uniqueEntities.has(e.entity_type)) {
      uniqueEntities.set(e.entity_type, e.entity_value);
      console.log(`  ${e.entity_type}: ${e.entity_value}`);
    }
  });

  // Find the shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, port_of_loading, port_of_discharge')
    .eq('booking_number', 'MAEU9876543210')
    .single();

  if (!shipment) {
    console.log('\nShipment not found');
    return;
  }

  console.log(`\nShipment: ${shipment.booking_number}`);
  console.log(`  Current ETD: ${shipment.etd || 'NULL'}`);
  console.log(`  Current ETA: ${shipment.eta || 'NULL'}`);

  // Check linked documents
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type')
    .eq('shipment_id', shipment.id);

  console.log(`\nLinked documents: ${linkedDocs?.length || 0}`);
  linkedDocs?.forEach(d => console.log(`  ${d.document_type}: ${d.email_id.substring(0, 8)}...`));

  const isLinked = linkedDocs?.some(d => d.email_id === maerskEmail.id);
  console.log(`\nEmail linked to shipment: ${isLinked ? 'YES' : 'NO'}`);

  // Link if not linked
  if (!isLinked) {
    console.log('\nLinking email to shipment...');
    const { error: linkError } = await supabase
      .from('shipment_documents')
      .insert({
        shipment_id: shipment.id,
        email_id: maerskEmail.id,
        document_type: 'booking_confirmation'
      });

    if (!linkError) {
      console.log('✅ Linked');
    } else {
      console.error('❌ Link error:', linkError.message);
    }
  }

  // Sync entities
  console.log('\nSyncing entities...');

  const updates: Record<string, any> = {};

  const etdValue = uniqueEntities.get('etd');
  if (!shipment.etd && etdValue) {
    const parsed = parseEntityDate(etdValue);
    if (parsed) {
      updates.etd = parsed;
      console.log(`  ETD: ${parsed}`);
    }
  }

  const etaValue = uniqueEntities.get('eta');
  if (!shipment.eta && etaValue) {
    const parsed = parseEntityDate(etaValue);
    if (parsed) {
      updates.eta = parsed;
      console.log(`  ETA: ${parsed}`);
    }
  }

  const polValue = uniqueEntities.get('port_of_loading');
  if (!shipment.port_of_loading && polValue) {
    updates.port_of_loading = polValue;
    console.log(`  POL: ${polValue}`);
  }

  const podValue = uniqueEntities.get('port_of_discharge');
  if (!shipment.port_of_discharge && podValue) {
    updates.port_of_discharge = podValue;
    console.log(`  POD: ${podValue}`);
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipment.id);

    if (!updateError) {
      console.log('\n✅ Shipment updated!');
    } else {
      console.error('❌ Update error:', updateError.message);
    }
  } else {
    console.log('\nNo updates needed - shipment already has values');
  }

  // Final stats
  console.log('\n' + '═'.repeat(70));
  const { data: finalStats } = await supabase
    .from('shipments')
    .select('etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  if (finalStats) {
    const total = finalStats.length;
    console.log(`ETD:          ${finalStats.filter(s => s.etd).length}/${total}`);
    console.log(`ETA:          ${finalStats.filter(s => s.eta).length}/${total}`);
    console.log(`SI Cutoff:    ${finalStats.filter(s => s.si_cutoff).length}/${total}`);
  }
}

syncMaerskEntities().catch(console.error);
