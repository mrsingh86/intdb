/**
 * Analyze confirmed shipments - complete vs incomplete
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyze() {
  // Get confirmed shipment IDs
  const { data: confirmedDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .eq('document_type', 'booking_confirmation');

  const confirmedIds = new Set(confirmedDocs?.map(d => d.shipment_id) || []);

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, port_of_loading, port_of_discharge, vessel_name');

  // Categorize
  const complete: typeof shipments = [];
  const incomplete: typeof shipments = [];

  for (const s of shipments || []) {
    if (!confirmedIds.has(s.id)) continue;
    const hasVoyageData = s.etd || s.eta || s.port_of_loading || s.port_of_discharge;
    if (hasVoyageData) {
      complete.push(s);
    } else {
      incomplete.push(s);
    }
  }

  console.log('CONFIRMED SHIPMENTS ANALYSIS');
  console.log('═'.repeat(50));
  console.log('');
  console.log('Complete (has voyage data):', complete.length);
  console.log('Incomplete (no voyage data):', incomplete.length);
  console.log('');

  if (incomplete.length > 0) {
    console.log('INCOMPLETE SHIPMENTS:');
    console.log('─'.repeat(50));
    for (const s of incomplete.slice(0, 15)) {
      console.log('  Booking:', s.booking_number);

      // Check if there are entity extractions for this shipment
      const { data: docs } = await supabase
        .from('shipment_documents')
        .select('email_id')
        .eq('shipment_id', s.id);

      const emailIds = docs?.map(d => d.email_id) || [];

      if (emailIds.length > 0) {
        const { data: entities } = await supabase
          .from('entity_extractions')
          .select('entity_type, entity_value')
          .in('email_id', emailIds);

        const etd = entities?.find(e => e.entity_type === 'etd');
        const eta = entities?.find(e => e.entity_type === 'eta');
        const pol = entities?.find(e => e.entity_type === 'port_of_loading');
        const pod = entities?.find(e => e.entity_type === 'port_of_discharge');

        if (etd || eta || pol || pod) {
          console.log('    ⚠️  HAS ENTITIES BUT NOT SYNCED TO SHIPMENT:');
          if (etd) console.log('      ETD entity:', etd.entity_value);
          if (eta) console.log('      ETA entity:', eta.entity_value);
          if (pol) console.log('      POL entity:', pol.entity_value);
          if (pod) console.log('      POD entity:', pod.entity_value);
        } else {
          console.log('    ❌ No voyage entities extracted from emails');
        }
      } else {
        console.log('    ❌ No linked emails');
      }
      console.log('');
    }
  }

  // Summary
  console.log('');
  console.log('SUMMARY');
  console.log('═'.repeat(50));
  const totalConfirmed = complete.length + incomplete.length;
  const completePercent = Math.round((complete.length / totalConfirmed) * 100);
  console.log(`${complete.length}/${totalConfirmed} (${completePercent}%) confirmed shipments have voyage data`);
  console.log(`${incomplete.length} need attention - either entity extraction or PDF processing`);
}

analyze().catch(console.error);
