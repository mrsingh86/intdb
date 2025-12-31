#!/usr/bin/env npx tsx
/**
 * Parse CMA CGM PDF cutoffs v2 - handles multi-line format
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function parseDate(dateStr: string, timeStr: string): string | null {
  const months: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  const match = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;

  const day = match[1].padStart(2, '0');
  const month = months[match[2].toLowerCase()];
  const year = match[3];

  if (!month) return null;

  return `${year}-${month}-${day}T${timeStr}:00+05:30`;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║            PARSE CMA CGM CUTOFFS v2 - Multi-line Format                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get CMA CGM BC PDFs with text
  const { data: atts } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extracted_text')
    .ilike('filename', '%BKGCONF%')
    .not('extracted_text', 'is', null);

  console.log('CMA CGM BC PDFs with text:', atts?.length);

  const updates: { booking: string; vgm?: string; cargo?: string; etd?: string; eta?: string }[] = [];

  for (const att of atts || []) {
    const text = att.extracted_text || '';
    const booking = att.filename.match(/BKGCONF_([A-Z0-9]+)\.pdf/i)?.[1];

    if (!booking) continue;

    console.log('\n═══ ' + booking + ' ═══');

    const lines = text.split('\n');
    const dateTimePattern = /(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2})/;

    let vgm: string | null = null;
    let cargo: string | null = null;
    let etd: string | null = null;
    let eta: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';

      // Pattern: VGM Cut-Off on line, cargo on next line
      if (line.includes('VGM Cut-Off Date/Time:')) {
        const vgmMatch = line.match(dateTimePattern);
        if (vgmMatch) {
          vgm = parseDate(vgmMatch[1], vgmMatch[2]);
          console.log('  VGM: ' + vgmMatch[1] + ' ' + vgmMatch[2]);
        }

        // Cargo cutoff is often on the next line
        const cargoMatch = nextLine.match(dateTimePattern);
        if (cargoMatch) {
          cargo = parseDate(cargoMatch[1], cargoMatch[2]);
          console.log('  Cargo: ' + cargoMatch[1] + ' ' + cargoMatch[2]);
        }
      }

      // ETD pattern - look for ETD: followed by date
      if (line.includes('ETD:')) {
        const etdMatch = line.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
        if (etdMatch) {
          etd = parseDate(etdMatch[1], '00:00');
          console.log('  ETD: ' + etdMatch[1]);
        } else {
          // ETD date might be on next line
          const nextEtdMatch = nextLine.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
          if (nextEtdMatch) {
            etd = parseDate(nextEtdMatch[1], '00:00');
            console.log('  ETD: ' + nextEtdMatch[1]);
          }
        }
      }

      // ETA patterns - after transhipment or ETA:
      if (line.includes('ETA:') && !line.includes('FPD ETA')) {
        const etaMatch = line.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
        if (etaMatch) {
          eta = parseDate(etaMatch[1], '00:00');
          console.log('  ETA: ' + etaMatch[1]);
        }
      }
    }

    if (vgm || cargo || etd) {
      updates.push({ booking, vgm: vgm || undefined, cargo: cargo || undefined, etd: etd || undefined, eta: eta || undefined });
    }
  }

  // Apply updates
  console.log('\n═══ APPLYING UPDATES ═══\n');

  for (const u of updates) {
    const updateData: Record<string, any> = {};
    if (u.vgm) updateData.vgm_cutoff = u.vgm;
    if (u.cargo) updateData.cargo_cutoff = u.cargo;
    if (u.etd) updateData.etd = u.etd.split('T')[0];
    if (u.eta) updateData.eta = u.eta.split('T')[0];

    if (Object.keys(updateData).length > 0) {
      const { data, error } = await supabase
        .from('shipments')
        .update(updateData)
        .eq('booking_number', u.booking)
        .select('booking_number');

      if (data && data.length > 0) {
        console.log('✓ ' + u.booking + ': VGM=' + (u.vgm ? 'Y' : 'N') + ', Cargo=' + (u.cargo ? 'Y' : 'N') + ', ETD=' + (u.etd ? 'Y' : 'N'));
      }
    }
  }

  // Summary
  console.log('\n═══ FINAL CMA CGM COVERAGE ═══\n');

  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name').ilike('carrier_name', '%CMA%');
  const cmaId = carriers?.[0]?.id;

  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, si_cutoff, vgm_cutoff, cargo_cutoff')
    .eq('carrier_id', cmaId);

  const total = shipments?.length || 0;
  const withVgm = shipments?.filter(s => s.vgm_cutoff).length || 0;
  const withCargo = shipments?.filter(s => s.cargo_cutoff).length || 0;
  const withAll = shipments?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length || 0;

  console.log('Total CMA CGM shipments: ' + total);
  console.log('With VGM cutoff: ' + withVgm + ' (' + Math.round((withVgm / total) * 100) + '%)');
  console.log('With Cargo cutoff: ' + withCargo + ' (' + Math.round((withCargo / total) * 100) + '%)');
  console.log('With ALL 3: ' + withAll + ' (' + Math.round((withAll / total) * 100) + '%)');
}

main().catch(console.error);
