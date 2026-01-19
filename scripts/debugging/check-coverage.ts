#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: shipments } = await supabase.from('shipments').select('*').limit(500);
  const total = shipments?.length || 0;

  console.log('SHIPMENT DATA COVERAGE (' + total + ' shipments)');
  console.log('==========================================');

  const fields = [
    'booking_number', 'carrier_id', 'vessel_name',
    'etd', 'eta', 'port_of_loading', 'port_of_discharge',
    'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff',
    'shipper_name', 'consignee_name', 'bl_number'
  ];

  for (const field of fields) {
    const count = shipments?.filter(s => {
      const val = (s as any)[field];
      return val !== null && val !== undefined && val !== '';
    }).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log('  ' + field.padEnd(20) + bar + ' ' + pct + '%  (' + count + ')');
  }

  // Cutoff summary
  console.log('\nCUTOFF SUMMARY:');
  const withAnyCutoff = shipments?.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff || s.gate_cutoff).length || 0;
  const withAllMajor = shipments?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length || 0;
  console.log('  Shipments with ANY cutoff:', withAnyCutoff, '(' + Math.round(withAnyCutoff / total * 100) + '%)');
  console.log('  Shipments with SI+VGM+Cargo:', withAllMajor, '(' + Math.round(withAllMajor / total * 100) + '%)');

  // Check missing cutoffs by carrier
  console.log('\nMISSING CUTOFFS BY CARRIER:');
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]) || []);

  const missingByCarrier: Record<string, { total: number; missing: number }> = {};
  shipments?.forEach(s => {
    const carrierName = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!missingByCarrier[carrierName]) {
      missingByCarrier[carrierName] = { total: 0, missing: 0 };
    }
    missingByCarrier[carrierName].total++;
    if (!s.si_cutoff && !s.vgm_cutoff && !s.cargo_cutoff) {
      missingByCarrier[carrierName].missing++;
    }
  });

  Object.entries(missingByCarrier)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([carrier, stats]) => {
      const missingPct = Math.round(stats.missing / stats.total * 100);
      console.log('  ' + carrier.padEnd(20) + stats.missing + '/' + stats.total + ' missing (' + missingPct + '%)');
    });
}

check().catch(console.error);
