import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get last 17 shipments
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      carrier_id,
      vessel_name,
      voyage_number,
      port_of_loading,
      port_of_loading_code,
      port_of_discharge,
      port_of_discharge_code,
      place_of_receipt,
      place_of_delivery,
      final_destination,
      etd,
      eta,
      si_cutoff,
      vgm_cutoff,
      cargo_cutoff,
      gate_cutoff,
      doc_cutoff,
      it_number,
      entry_number,
      hs_code_customs,
      created_at,
      created_from_email_id
    `)
    .order('created_at', { ascending: false })
    .limit(17);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  // Get carrier names
  const { data: carriers } = await supabase
    .from('carrier_configs')
    .select('id, carrier_name');

  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]) || []);

  console.log('=== LAST 17 SHIPMENTS ===\n');

  let withEtd = 0, withSiCutoff = 0, withVgmCutoff = 0, withCargoCutoff = 0;
  let withPlaceOfReceipt = 0, withPlaceOfDelivery = 0;
  let withItNumber = 0, withEntryNumber = 0;

  for (const s of shipments || []) {
    console.log('─'.repeat(70));
    console.log('Booking:', s.booking_number, '|', 'Carrier:', carrierMap.get(s.carrier_id) || s.carrier_id);
    console.log('Vessel:', s.vessel_name, 'Voy:', s.voyage_number);
    console.log('Route:', s.port_of_loading, `(${s.port_of_loading_code})`, '→', s.port_of_discharge, `(${s.port_of_discharge_code})`);

    if (s.place_of_receipt || s.place_of_delivery) {
      console.log('Inland:', s.place_of_receipt || '-', '→', s.place_of_delivery || s.final_destination || '-');
    }

    console.log('ETD:', s.etd || '-', '| ETA:', s.eta || '-');

    console.log('Cutoffs:',
      'SI:', s.si_cutoff?.split('T')[0] || '-',
      '| VGM:', s.vgm_cutoff?.split('T')[0] || '-',
      '| Cargo:', s.cargo_cutoff?.split('T')[0] || '-',
      '| Gate:', s.gate_cutoff?.split('T')[0] || '-'
    );

    if (s.it_number || s.entry_number || s.hs_code_customs) {
      console.log('Customs: IT#:', s.it_number || '-', '| Entry:', s.entry_number || '-', '| HS:', s.hs_code_customs || '-');
    }

    console.log('Created:', s.created_at?.split('T')[0]);

    // Count stats
    if (s.etd) withEtd++;
    if (s.si_cutoff) withSiCutoff++;
    if (s.vgm_cutoff) withVgmCutoff++;
    if (s.cargo_cutoff) withCargoCutoff++;
    if (s.place_of_receipt) withPlaceOfReceipt++;
    if (s.place_of_delivery) withPlaceOfDelivery++;
    if (s.it_number) withItNumber++;
    if (s.entry_number) withEntryNumber++;
  }

  console.log('\n' + '═'.repeat(70));
  console.log('=== EXTRACTION STATS (Last 17 Shipments) ===');
  console.log('─'.repeat(70));
  console.log(`ETD:              ${withEtd}/17 (${Math.round(withEtd/17*100)}%)`);
  console.log(`SI Cutoff:        ${withSiCutoff}/17 (${Math.round(withSiCutoff/17*100)}%)`);
  console.log(`VGM Cutoff:       ${withVgmCutoff}/17 (${Math.round(withVgmCutoff/17*100)}%)`);
  console.log(`Cargo Cutoff:     ${withCargoCutoff}/17 (${Math.round(withCargoCutoff/17*100)}%)`);
  console.log(`Place of Receipt: ${withPlaceOfReceipt}/17 (${Math.round(withPlaceOfReceipt/17*100)}%)`);
  console.log(`Place of Delivery:${withPlaceOfDelivery}/17 (${Math.round(withPlaceOfDelivery/17*100)}%)`);
  console.log(`IT Number:        ${withItNumber}/17 (${Math.round(withItNumber/17*100)}%)`);
  console.log(`Entry Number:     ${withEntryNumber}/17 (${Math.round(withEntryNumber/17*100)}%)`);
}

main().catch(console.error);
