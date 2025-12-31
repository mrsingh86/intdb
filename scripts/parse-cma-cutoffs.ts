#!/usr/bin/env npx tsx
/**
 * Parse CMA CGM PDF cutoffs and update shipments
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function parseDate(dateStr: string, timeStr: string): string | null {
  // Convert "26-Dec-2025 15:30" to ISO format
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
  console.log('║            PARSE CMA CGM CUTOFFS FROM PDFs                                     ║');
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

    // Show lines with dates for debugging
    const lines = text.split('\n');
    const datePattern = /\d{1,2}-[A-Za-z]{3}-\d{4}/;

    for (let i = 0; i < lines.length; i++) {
      if (datePattern.test(lines[i])) {
        console.log('[' + i + '] ' + lines[i].trim().substring(0, 100));
      }
    }

    // Pattern 1: VGM Cut-Off Date/Time:26-Dec-2025 15:30
    const vgmMatch = text.match(/VGM Cut-Off Date\/Time:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2})/i);

    // Pattern 2: Terminal cutoff - look for date after VGM line
    // Format: Loading Terminal:VGM Cut-Off Date/Time:19-Dec-2025 15:30 | 21-Dec-2025 13:00
    const combinedMatch = text.match(/VGM Cut-Off Date\/Time:(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2})\s*\|\s*(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2})/i);

    // Pattern 3: ETD
    const etdMatch = text.match(/ETD:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i);

    // Pattern 4: ETA
    const etaMatch = text.match(/ETA:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i);

    const update: any = { booking };

    if (combinedMatch) {
      update.vgm = parseDate(combinedMatch[1], combinedMatch[2]);
      update.cargo = parseDate(combinedMatch[3], combinedMatch[4]);
      console.log('  VGM: ' + combinedMatch[1] + ' ' + combinedMatch[2]);
      console.log('  Cargo: ' + combinedMatch[3] + ' ' + combinedMatch[4]);
    } else if (vgmMatch) {
      update.vgm = parseDate(vgmMatch[1], vgmMatch[2]);
      console.log('  VGM: ' + vgmMatch[1] + ' ' + vgmMatch[2]);
    }

    if (etdMatch) {
      // ETD usually has no time, use 00:00
      update.etd = parseDate(etdMatch[1], '00:00');
      console.log('  ETD: ' + etdMatch[1]);
    }

    if (etaMatch) {
      update.eta = parseDate(etaMatch[1], '00:00');
      console.log('  ETA: ' + etaMatch[1]);
    }

    if (update.vgm || update.cargo || update.etd) {
      updates.push(update);
    }
  }

  // Apply updates
  console.log('\n═══ APPLYING UPDATES ═══\n');

  for (const u of updates) {
    const updateData: any = {};
    if (u.vgm) updateData.vgm_cutoff = u.vgm;
    if (u.cargo) updateData.cargo_cutoff = u.cargo;
    if (u.etd) updateData.etd = u.etd.split('T')[0];
    if (u.eta) updateData.eta = u.eta.split('T')[0];

    if (Object.keys(updateData).length > 0) {
      const { data, error } = await supabase
        .from('shipments')
        .update(updateData)
        .eq('booking_number', u.booking)
        .select('booking_number, vgm_cutoff, cargo_cutoff, etd, eta');

      if (data && data.length > 0) {
        console.log('Updated ' + u.booking + ':', JSON.stringify(updateData));
      } else if (error) {
        console.log('Error updating ' + u.booking + ':', error.message);
      } else {
        console.log('No shipment found for ' + u.booking);
      }
    }
  }

  // Final check
  console.log('\n═══ CMA CGM SHIPMENTS AFTER UPDATE ═══\n');

  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name').ilike('carrier_name', '%CMA%');
  const cmaId = carriers?.[0]?.id;

  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, etd, eta')
    .eq('carrier_id', cmaId);

  for (const s of shipments || []) {
    const hasAll = s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff;
    const status = hasAll ? '✅' : (s.vgm_cutoff ? '⚠️' : '❌');
    console.log(status + ' ' + s.booking_number);
    console.log('   VGM: ' + (s.vgm_cutoff || 'NULL') + ' | Cargo: ' + (s.cargo_cutoff || 'NULL'));
    console.log('   ETD: ' + (s.etd || 'NULL') + ' | ETA: ' + (s.eta || 'NULL'));
  }
}

main().catch(console.error);
