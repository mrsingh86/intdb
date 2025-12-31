/**
 * Debug Entity Flow
 *
 * Traces why specific shipments are missing data when entities exist.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function debugEntityFlow() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         DEBUG: ENTITY FLOW                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Find shipments missing cutoffs
  const { data: shipmentsNoCutoff } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff')
    .is('si_cutoff', null)
    .limit(10);

  console.log(`Found ${shipmentsNoCutoff?.length || 0} shipments without SI cutoff\n`);

  for (const shipment of shipmentsNoCutoff || []) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`SHIPMENT: ${shipment.booking_number || 'no booking #'}`);
    console.log(`  ETD: ${shipment.etd || 'NULL'}, ETA: ${shipment.eta || 'NULL'}`);
    console.log(`  SI: ${shipment.si_cutoff || 'NULL'}, VGM: ${shipment.vgm_cutoff || 'NULL'}`);

    // Get linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    if (!linkedDocs || linkedDocs.length === 0) {
      console.log('  ❌ No linked documents');
      continue;
    }

    console.log(`  📄 Linked documents: ${linkedDocs.length}`);

    for (const doc of linkedDocs) {
      // Get email subject
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email')
        .eq('id', doc.email_id)
        .single();

      console.log(`\n    [${doc.document_type}] ${email?.subject?.substring(0, 50) || 'N/A'}`);
      console.log(`      From: ${email?.sender_email || 'N/A'}`);

      // Get entities for this email
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value, source_document_type')
        .eq('email_id', doc.email_id);

      if (entities && entities.length > 0) {
        console.log(`      Entities (${entities.length}):`);
        for (const e of entities) {
          const isDateEntity = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff'].includes(e.entity_type);
          if (isDateEntity) {
            console.log(`        🔸 ${e.entity_type}: ${e.entity_value}`);
          }
        }
      } else {
        console.log('      ⚠️  No entities extracted');
      }
    }
  }

  // Summary stats
  console.log('\n\n' + '═'.repeat(70));
  console.log('ENTITY EXTRACTION SUMMARY');
  console.log('═'.repeat(70));

  // Count entities by type and source
  const { data: entityStats } = await supabase
    .from('entity_extractions')
    .select('entity_type, source_document_type');

  if (entityStats) {
    const bySource: Record<string, Record<string, number>> = {};
    entityStats.forEach(e => {
      const source = e.source_document_type || 'unknown';
      if (!bySource[source]) bySource[source] = {};
      bySource[source][e.entity_type] = (bySource[source][e.entity_type] || 0) + 1;
    });

    for (const [source, types] of Object.entries(bySource)) {
      console.log(`\n${source}:`);
      const dateTypes = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff'];
      dateTypes.forEach(type => {
        if (types[type]) {
          console.log(`  ${type}: ${types[type]}`);
        }
      });
    }
  }

  // Check if there are booking confirmations with cutoffs
  console.log('\n\n' + '═'.repeat(70));
  console.log('BOOKING CONFIRMATIONS WITH CUTOFFS');
  console.log('═'.repeat(70));

  const { data: bookingsWithCutoffs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  let hasAny = 0;
  let hasSi = 0;
  let hasVgm = 0;

  for (const booking of bookingsWithCutoffs || []) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .eq('email_id', booking.email_id)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']);

    const types = entities?.map(e => e.entity_type) || [];
    if (types.length > 0) hasAny++;
    if (types.includes('si_cutoff')) hasSi++;
    if (types.includes('vgm_cutoff')) hasVgm++;
  }

  console.log(`\nBooking confirmations with any date entities: ${hasAny}/${bookingsWithCutoffs?.length || 0}`);
  console.log(`  With SI cutoff: ${hasSi}`);
  console.log(`  With VGM cutoff: ${hasVgm}`);
}

debugEntityFlow().catch(console.error);
