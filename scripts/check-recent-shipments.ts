import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get last 17 shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      carrier_name,
      vessel_name,
      port_of_loading,
      port_of_discharge,
      etd,
      eta,
      si_cutoff,
      vgm_cutoff,
      cargo_cutoff,
      gate_cutoff,
      created_at,
      created_from_email_id
    `)
    .order('created_at', { ascending: false })
    .limit(17);

  console.log('=== LAST 17 SHIPMENTS ===\n');

  for (const s of shipments || []) {
    console.log('─'.repeat(60));
    console.log('Booking:', s.booking_number);
    console.log('Carrier:', s.carrier_name);
    console.log('Vessel:', s.vessel_name);
    console.log('Route:', s.port_of_loading, '→', s.port_of_discharge);
    console.log('ETD:', s.etd);
    console.log('ETA:', s.eta);
    console.log('Cutoffs:');
    console.log('  SI:', s.si_cutoff || '-');
    console.log('  VGM:', s.vgm_cutoff || '-');
    console.log('  Cargo:', s.cargo_cutoff || '-');
    console.log('  Gate:', s.gate_cutoff || '-');
    console.log('Created:', s.created_at);

    // Check entity extractions for this shipment's source email
    if (s.created_from_email_id) {
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', s.created_from_email_id);

      if (entities && entities.length > 0) {
        console.log('Entities:', entities.length, 'extracted');
        const types = entities.map(e => e.entity_type).join(', ');
        console.log('Types:', types);
      }
    }
    console.log('');
  }

  // Summary stats
  console.log('=== SUMMARY ===');
  const withEtd = shipments?.filter(s => s.etd).length || 0;
  const withSiCutoff = shipments?.filter(s => s.si_cutoff).length || 0;
  const withVgmCutoff = shipments?.filter(s => s.vgm_cutoff).length || 0;
  const withCargoCutoff = shipments?.filter(s => s.cargo_cutoff).length || 0;

  console.log('Total:', shipments?.length);
  console.log('With ETD:', withEtd);
  console.log('With SI Cutoff:', withSiCutoff);
  console.log('With VGM Cutoff:', withVgmCutoff);
  console.log('With Cargo Cutoff:', withCargoCutoff);
}

main().catch(console.error);
