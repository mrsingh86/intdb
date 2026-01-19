#!/usr/bin/env npx tsx
/**
 * Calculate coverage for ONLY shipments that have booking confirmation emails
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get all booking confirmation emails
  const { data: bcs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bcEmailIds = bcs?.map(b => b.email_id) || [];
  console.log('Total booking confirmation emails:', bcEmailIds.length);

  // Get these emails with subjects
  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', bcEmailIds);

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, si_cutoff, vgm_cutoff, cargo_cutoff, carrier_id');

  // Get carriers
  const { data: carriers } = await supabase
    .from('carriers')
    .select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // Match shipments to booking confirmation emails
  const shipmentsWithBC: any[] = [];
  const shipmentsWithoutBC: any[] = [];

  for (const s of shipments || []) {
    const bn = s.booking_number || '';

    // Check if any BC email contains this booking number
    const hasBC = bcEmails?.some(e => {
      const subject = e.subject || '';
      const body = (e.body_text || '').substring(0, 5000);

      // Match booking number (at least first 6 chars)
      if (bn.length >= 6) {
        const searchTerm = bn.substring(0, Math.min(bn.length, 10));
        if (subject.includes(searchTerm) || body.includes(searchTerm)) return true;
      }
      return false;
    });

    if (hasBC) {
      shipmentsWithBC.push(s);
    } else {
      shipmentsWithoutBC.push(s);
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║   COVERAGE FOR SHIPMENTS WITH BOOKING CONFIRMATION ONLY           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('Shipments WITH booking confirmation email:', shipmentsWithBC.length);
  console.log('Shipments WITHOUT booking confirmation email:', shipmentsWithoutBC.length);
  console.log('Total shipments:', shipments?.length);

  // Calculate coverage for ONLY shipments with BC
  const withBC = shipmentsWithBC;
  const total = withBC.length;

  if (total === 0) {
    console.log('\nNo shipments matched to booking confirmations');
    return;
  }

  const siCount = withBC.filter(s => s.si_cutoff).length;
  const vgmCount = withBC.filter(s => s.vgm_cutoff).length;
  const cargoCount = withBC.filter(s => s.cargo_cutoff).length;
  const allThree = withBC.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;
  const anyOne = withBC.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff).length;

  const pct = (n: number) => Math.round((n / total) * 100);
  const bar = (n: number) => {
    const p = Math.round((n / total) * 100);
    return '█'.repeat(Math.floor(p / 5)) + '░'.repeat(20 - Math.floor(p / 5));
  };

  console.log('\n═══ CUTOFF COVERAGE (BC Shipments Only) ═══\n');
  console.log('SI Cutoff:    ' + bar(siCount) + ' ' + pct(siCount) + '% (' + siCount + '/' + total + ')');
  console.log('VGM Cutoff:   ' + bar(vgmCount) + ' ' + pct(vgmCount) + '% (' + vgmCount + '/' + total + ')');
  console.log('Cargo Cutoff: ' + bar(cargoCount) + ' ' + pct(cargoCount) + '% (' + cargoCount + '/' + total + ')');
  console.log('');
  console.log('Has ANY cutoff:  ' + bar(anyOne) + ' ' + pct(anyOne) + '% (' + anyOne + '/' + total + ')');
  console.log('Has ALL 3:       ' + bar(allThree) + ' ' + pct(allThree) + '% (' + allThree + '/' + total + ')');

  // By carrier
  console.log('\n═══ BY CARRIER (Shipments with BC only) ═══\n');

  const byCarrier: Record<string, { total: number; allThree: number; anyOne: number }> = {};
  for (const s of withBC) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (byCarrier[carrier] === undefined) {
      byCarrier[carrier] = { total: 0, allThree: 0, anyOne: 0 };
    }
    byCarrier[carrier].total++;
    if (s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) byCarrier[carrier].allThree++;
    if (s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff) byCarrier[carrier].anyOne++;
  }

  console.log('Carrier'.padEnd(20) + '| Total | All 3 | Any | Rate');
  console.log('─'.repeat(55));

  const sortedCarriers = Object.entries(byCarrier).sort((a, b) => b[1].total - a[1].total);
  for (const [carrier, stats] of sortedCarriers) {
    const rate = Math.round((stats.allThree / stats.total) * 100);
    console.log(
      carrier.substring(0, 19).padEnd(20) + '| ' +
      String(stats.total).padEnd(6) + '| ' +
      String(stats.allThree).padEnd(6) + '| ' +
      String(stats.anyOne).padEnd(4) + '| ' + rate + '%'
    );
  }

  // Show what's missing
  console.log('\n═══ SHIPMENTS WITH BC BUT MISSING ALL CUTOFFS ═══\n');

  const bcMissingAll = withBC.filter(s =>
    s.si_cutoff === null && s.vgm_cutoff === null && s.cargo_cutoff === null
  );

  console.log('Count:', bcMissingAll.length, '/', total);

  // Group by carrier
  const missingByCarrier: Record<string, string[]> = {};
  for (const s of bcMissingAll) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (missingByCarrier[carrier] === undefined) {
      missingByCarrier[carrier] = [];
    }
    missingByCarrier[carrier].push(s.booking_number);
  }

  for (const [carrier, bookings] of Object.entries(missingByCarrier)) {
    console.log('\n' + carrier + ' (' + bookings.length + '):');
    bookings.slice(0, 5).forEach(b => console.log('  - ' + b));
    if (bookings.length > 5) console.log('  ... and ' + (bookings.length - 5) + ' more');
  }
}

main().catch(console.error);
