import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get carriers first
  const { data: carriers } = await supabase
    .from('carrier_configs')
    .select('id, carrier_name');

  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]) || []);
  console.log('\n─── CARRIER IDS ───');
  for (const [id, name] of carrierMap) {
    console.log(`  ${id}: ${name}`);
  }

  // Get shipments with issues
  console.log('\n─── SHIPMENTS WITH HALLUCINATED DATES ───');
  const { data: hallucinated } = await supabase
    .from('shipments')
    .select('booking_number, vessel_name, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, created_from_email_id')
    .or('etd.lt.2024-01-01,eta.lt.2024-01-01,si_cutoff.lt.2024-01-01,vgm_cutoff.lt.2024-01-01,cargo_cutoff.lt.2024-01-01,gate_cutoff.lt.2024-01-01');

  for (const s of hallucinated || []) {
    console.log(`\n  Booking: ${s.booking_number}`);
    console.log(`    Vessel: ${s.vessel_name}`);
    console.log(`    ETD: ${s.etd}, ETA: ${s.eta}`);
    console.log(`    SI: ${s.si_cutoff}, VGM: ${s.vgm_cutoff}`);
    console.log(`    Has source email: ${s.created_from_email_id ? 'Yes' : 'No'}`);

    // Check if email has PDF
    if (s.created_from_email_id) {
      const { data: attachments } = await supabase
        .from('raw_attachments')
        .select('filename, mime_type, extracted_text')
        .eq('email_id', s.created_from_email_id);

      const pdfs = (attachments || []).filter(a =>
        a.mime_type?.includes('pdf') || a.filename?.toLowerCase().endsWith('.pdf')
      );
      const pdfWithText = pdfs.filter(a => a.extracted_text && a.extracted_text.length > 100);
      console.log(`    PDFs: ${pdfs.length}, with text: ${pdfWithText.length}`);
    }
  }

  // Shipments missing cutoffs by carrier
  console.log('\n─── CUTOFF COVERAGE BY CARRIER ───');
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('carrier_id, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff');

  const carrierStats: Record<string, { total: number; si: number; vgm: number; cargo: number; gate: number }> = {};

  for (const s of allShipments || []) {
    const carrierId = s.carrier_id || 'unknown';
    if (!carrierStats[carrierId]) {
      carrierStats[carrierId] = { total: 0, si: 0, vgm: 0, cargo: 0, gate: 0 };
    }
    carrierStats[carrierId].total++;
    if (s.si_cutoff) carrierStats[carrierId].si++;
    if (s.vgm_cutoff) carrierStats[carrierId].vgm++;
    if (s.cargo_cutoff) carrierStats[carrierId].cargo++;
    if (s.gate_cutoff) carrierStats[carrierId].gate++;
  }

  for (const [carrierId, stats] of Object.entries(carrierStats)) {
    const carrierName = carrierMap.get(carrierId) || carrierId;
    console.log(`\n  ${carrierName} (${stats.total} shipments):`);
    console.log(`    SI Cutoff:    ${stats.si}/${stats.total} (${Math.round(stats.si/stats.total*100)}%)`);
    console.log(`    VGM Cutoff:   ${stats.vgm}/${stats.total} (${Math.round(stats.vgm/stats.total*100)}%)`);
    console.log(`    Cargo Cutoff: ${stats.cargo}/${stats.total} (${Math.round(stats.cargo/stats.total*100)}%)`);
    console.log(`    Gate Cutoff:  ${stats.gate}/${stats.total} (${Math.round(stats.gate/stats.total*100)}%)`);
  }
}

main().catch(console.error);
