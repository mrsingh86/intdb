import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Carrier ID to name mapping (from carrier_configs + actual UUIDs in use)
const CARRIER_ID_MAP: Record<string, string> = {
  'maersk': 'Maersk',
  'hapag': 'Hapag-Lloyd',
  'msc': 'MSC',
  'cma_cgm': 'CMA CGM',
  // UUIDs found in shipments table
  '2d2fc5e2-025e-485a-9c1a-ae44d1fef2c9': 'Maersk',
  'ca18ce12-00dc-4de9-bd91-668e8a60fa30': 'Hapag-Lloyd',
  '85a10be3-b95c-4294-8995-c2193e988d35': 'CMA CGM',
  '925f6d84-4f63-4f66-b065-ed4f5b544a67': 'COSCO',
  '5a60708a-4625-4e29-9175-e38b63851099': 'MSC',
};

async function main() {
  // Get all shipments
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id, booking_number, carrier_id,
      vessel_name, voyage_number,
      port_of_loading, port_of_loading_code,
      port_of_discharge, port_of_discharge_code,
      place_of_receipt, place_of_delivery, final_destination,
      etd, eta,
      si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, doc_cutoff,
      it_number, entry_number, hs_code_customs,
      shipper_name, consignee_name,
      created_from_email_id
    `);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  const total = shipments?.length || 0;
  console.log('═'.repeat(80));
  console.log(`              DATA QUALITY REPORT - ${total} SHIPMENTS`);
  console.log('═'.repeat(80));

  // Carrier breakdown using carrier_id
  const carrierCounts: Record<string, number> = {};
  for (const s of shipments || []) {
    const carrierName = CARRIER_ID_MAP[s.carrier_id] || 'Unknown';
    carrierCounts[carrierName] = (carrierCounts[carrierName] || 0) + 1;
  }

  console.log('\n┌─ SHIPMENTS BY CARRIER ───────────────────────────────────────────────────┐');
  for (const [carrier, count] of Object.entries(carrierCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.round(pct / 3));
    console.log(`│  ${carrier.padEnd(20)} ${String(count).padStart(3)} (${String(pct).padStart(2)}%) ${bar}`);
  }
  console.log('└──────────────────────────────────────────────────────────────────────────┘');

  // Field completeness
  const fieldGroups = {
    'Core': ['vessel_name', 'voyage_number'],
    'Route': ['port_of_loading', 'port_of_loading_code', 'port_of_discharge', 'port_of_discharge_code'],
    'Inland': ['place_of_receipt', 'place_of_delivery', 'final_destination'],
    'Dates': ['etd', 'eta'],
    'Cutoffs': ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff'],
    'Customs': ['it_number', 'entry_number', 'hs_code_customs'],
    'Parties': ['shipper_name', 'consignee_name'],
  };

  console.log('\n┌─ FIELD COMPLETENESS ─────────────────────────────────────────────────────┐');

  for (const [group, fields] of Object.entries(fieldGroups)) {
    console.log(`│  ── ${group} ──`);
    for (const field of fields) {
      let populated = 0;
      for (const s of shipments || []) {
        if ((s as Record<string, unknown>)[field]) populated++;
      }
      const pct = Math.round((populated / total) * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      const status = pct >= 80 ? '✓' : pct >= 50 ? '○' : '✗';
      console.log(`│  ${status} ${field.padEnd(22)} ${bar} ${String(populated).padStart(3)}/${total} (${String(pct).padStart(2)}%)`);
    }
  }
  console.log('└──────────────────────────────────────────────────────────────────────────┘');

  // Data quality issues
  console.log('\n┌─ DATA QUALITY ISSUES ────────────────────────────────────────────────────┐');

  // Check for hallucinated dates
  const hallucinatedBookings: { booking: string; field: string; value: string }[] = [];
  for (const s of shipments || []) {
    for (const df of ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff']) {
      const val = (s as Record<string, unknown>)[df] as string;
      if (val) {
        const year = parseInt(String(val).substring(0, 4));
        if (year < 2024) {
          hallucinatedBookings.push({ booking: s.booking_number, field: df, value: String(val).substring(0, 10) });
        }
      }
    }
  }

  if (hallucinatedBookings.length > 0) {
    console.log(`│  ⚠️  HALLUCINATED DATES (pre-2024): ${hallucinatedBookings.length} fields in ${new Set(hallucinatedBookings.map(h => h.booking)).size} shipments`);
    const uniqueBookings = [...new Set(hallucinatedBookings.map(h => h.booking))];
    for (const booking of uniqueBookings.slice(0, 5)) {
      const fields = hallucinatedBookings.filter(h => h.booking === booking);
      console.log(`│      ${booking}: ${fields.map(f => `${f.field}=${f.value}`).join(', ')}`);
    }
  } else {
    console.log('│  ✅ No hallucinated dates');
  }

  // Check for minimal data
  const minimalData = (shipments || []).filter(s => {
    let count = 0;
    for (const f of ['vessel_name', 'etd', 'eta', 'si_cutoff', 'port_of_loading_code']) {
      if ((s as Record<string, unknown>)[f]) count++;
    }
    return count < 3;
  });

  if (minimalData.length > 0) {
    console.log(`│  ⚠️  SHIPMENTS WITH MINIMAL DATA: ${minimalData.length}`);
    for (const s of minimalData.slice(0, 5)) {
      console.log(`│      ${s.booking_number}`);
    }
  }

  // Check for duplicates
  const bookings = (shipments || []).map(s => s.booking_number);
  const seen = new Set<string>();
  const duplicates = bookings.filter(bn => {
    const isDupe = seen.has(bn);
    seen.add(bn);
    return isDupe;
  });

  if (duplicates.length > 0) {
    console.log(`│  ⚠️  DUPLICATE BOOKINGS: ${duplicates.length}`);
    for (const d of [...new Set(duplicates)].slice(0, 5)) {
      console.log(`│      ${d}`);
    }
  }

  // Check for unknown carriers
  const unknownCarrier = (shipments || []).filter(s => !CARRIER_ID_MAP[s.carrier_id]);
  if (unknownCarrier.length > 0) {
    console.log(`│  ⚠️  UNKNOWN CARRIER ID: ${unknownCarrier.length}`);
    const unknownIds = [...new Set(unknownCarrier.map(s => s.carrier_id))];
    for (const id of unknownIds.slice(0, 3)) {
      console.log(`│      ${id}`);
    }
  }

  if (hallucinatedBookings.length === 0 && minimalData.length === 0 && duplicates.length === 0 && unknownCarrier.length === 0) {
    console.log('│  ✅ No issues found');
  }

  console.log('└──────────────────────────────────────────────────────────────────────────┘');

  // OVERALL SCORE
  let score = 0;
  let maxScore = 0;

  // Core fields (vessel, voyage) - weight 1
  for (const s of shipments || []) {
    if (s.vessel_name) score += 1;
    if (s.voyage_number) score += 1;
    maxScore += 2;
  }

  // Route fields - weight 2
  for (const s of shipments || []) {
    if (s.port_of_loading_code) score += 2;
    if (s.port_of_discharge_code) score += 2;
    maxScore += 4;
  }

  // Dates - weight 2
  for (const s of shipments || []) {
    if (s.etd && !String(s.etd).startsWith('2023') && !String(s.etd).startsWith('2022')) score += 2;
    if (s.eta && !String(s.eta).startsWith('2023') && !String(s.eta).startsWith('2022')) score += 2;
    maxScore += 4;
  }

  // Cutoffs - weight 1 each
  for (const s of shipments || []) {
    if (s.si_cutoff && !String(s.si_cutoff).startsWith('2023')) score += 1;
    if (s.vgm_cutoff && !String(s.vgm_cutoff).startsWith('2023')) score += 1;
    if (s.cargo_cutoff && !String(s.cargo_cutoff).startsWith('2023')) score += 1;
    maxScore += 3;
  }

  const overallPct = Math.round((score / maxScore) * 100);

  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log(`║                    OVERALL DATA QUALITY SCORE: ${overallPct}%                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
