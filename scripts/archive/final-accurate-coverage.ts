#!/usr/bin/env npx tsx
/**
 * Final accurate coverage using deterministic BC classification
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ClassificationRule {
  carrier: string;
  type: string;
  pattern: RegExp;
}

const BC_RULES: ClassificationRule[] = [
  // MAERSK - Booking Confirmation patterns
  { carrier: 'maersk', type: 'booking_confirmation', pattern: /^Booking Confirmation\s*[:\-]/i },
  { carrier: 'maersk', type: 'booking_confirmation', pattern: /^Price overview - booking confirmation/i },
  { carrier: 'maersk', type: 'booking_amendment', pattern: /^Booking Amendment\s*[:\-]/i },

  // HAPAG-LLOYD - Booking Confirmation patterns
  { carrier: 'hapag', type: 'booking_confirmation', pattern: /^HL-\d+\s+[A-Z]{5}/i },
  { carrier: 'hapag', type: 'booking_amendment', pattern: /^\[Update\] Booking/i },

  // CMA CGM - Booking Confirmation patterns
  { carrier: 'cma', type: 'booking_confirmation', pattern: /^CMA CGM - Booking confirmation available/i },

  // COSCO - Booking Confirmation patterns
  { carrier: 'cosco', type: 'booking_confirmation', pattern: /^Cosco Shipping Line Booking Confirmation/i },

  // MSC
  { carrier: 'msc', type: 'booking_confirmation', pattern: /INTOGLO.*\/.*AMM/i },
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║            ACCURATE COVERAGE USING DETERMINISTIC BC PATTERNS                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email, body_text');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, si_cutoff, vgm_cutoff, cargo_cutoff, etd, eta, vessel_name');

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // Find BC emails using deterministic patterns
  const bcEmails: any[] = [];

  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const subject = e.subject || '';

    let carrier = '';
    if (sender.includes('maersk.com')) carrier = 'maersk';
    else if (sender.includes('hapag') || sender.includes('hlag')) carrier = 'hapag';
    else if (sender.includes('cma-cgm')) carrier = 'cma';
    else if (sender.includes('coscon')) carrier = 'cosco';
    else if (sender.includes('msc.com')) carrier = 'msc';
    else continue;

    for (const rule of BC_RULES) {
      if (rule.carrier === carrier && rule.pattern.test(subject)) {
        bcEmails.push({ ...e, carrierCode: carrier });
        break;
      }
    }
  }

  console.log('BC-type emails (deterministic): ' + bcEmails.length);

  // Match BC emails to shipments
  const matchedShipments = new Map<string, any>();

  for (const bc of bcEmails) {
    const subject = bc.subject || '';
    const body = (bc.body_text || '').substring(0, 5000);

    for (const s of shipments || []) {
      const bn = s.booking_number || '';
      if (bn.length < 6) continue;

      const searchTerm = bn.substring(0, Math.min(bn.length, 10));
      if (subject.includes(searchTerm) || body.includes(searchTerm)) {
        matchedShipments.set(s.id, s);
        break;
      }
    }
  }

  const matched = Array.from(matchedShipments.values());
  console.log('Shipments matched to BC emails: ' + matched.length);

  // Calculate coverage
  const total = matched.length;
  const withSI = matched.filter(s => s.si_cutoff).length;
  const withVGM = matched.filter(s => s.vgm_cutoff).length;
  const withCargo = matched.filter(s => s.cargo_cutoff).length;
  const withETD = matched.filter(s => s.etd).length;
  const withETA = matched.filter(s => s.eta).length;
  const withVessel = matched.filter(s => s.vessel_name).length;
  const allThree = matched.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;

  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  const bar = (n: number) => {
    const p = pct(n);
    return '█'.repeat(Math.floor(p / 5)) + '░'.repeat(20 - Math.floor(p / 5));
  };

  console.log('\n═══ FIELD COVERAGE (BC-matched shipments only) ═══\n');
  console.log('ETD:          ' + bar(withETD) + ' ' + pct(withETD) + '% (' + withETD + '/' + total + ')');
  console.log('ETA:          ' + bar(withETA) + ' ' + pct(withETA) + '% (' + withETA + '/' + total + ')');
  console.log('Vessel:       ' + bar(withVessel) + ' ' + pct(withVessel) + '% (' + withVessel + '/' + total + ')');
  console.log('SI Cutoff:    ' + bar(withSI) + ' ' + pct(withSI) + '% (' + withSI + '/' + total + ')');
  console.log('VGM Cutoff:   ' + bar(withVGM) + ' ' + pct(withVGM) + '% (' + withVGM + '/' + total + ')');
  console.log('Cargo Cutoff: ' + bar(withCargo) + ' ' + pct(withCargo) + '% (' + withCargo + '/' + total + ')');
  console.log('');
  console.log('All 3 cutoffs:' + bar(allThree) + ' ' + pct(allThree) + '% (' + allThree + '/' + total + ')');

  // By carrier
  console.log('\n═══ BY CARRIER ═══\n');

  const byCarrier: Record<string, { total: number; allThree: number; si: number; vgm: number; cargo: number; etd: number; vessel: number }> = {};

  for (const s of matched) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!byCarrier[carrier]) {
      byCarrier[carrier] = { total: 0, allThree: 0, si: 0, vgm: 0, cargo: 0, etd: 0, vessel: 0 };
    }
    byCarrier[carrier].total++;
    if (s.si_cutoff) byCarrier[carrier].si++;
    if (s.vgm_cutoff) byCarrier[carrier].vgm++;
    if (s.cargo_cutoff) byCarrier[carrier].cargo++;
    if (s.etd) byCarrier[carrier].etd++;
    if (s.vessel_name) byCarrier[carrier].vessel++;
    if (s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) byCarrier[carrier].allThree++;
  }

  console.log('Carrier'.padEnd(18) + '| Total | ETD  | Vessel| SI   | VGM  | Cargo| All3 |');
  console.log('─'.repeat(80));

  for (const [carrier, stats] of Object.entries(byCarrier).sort((a, b) => b[1].total - a[1].total)) {
    const pctAll3 = Math.round((stats.allThree / stats.total) * 100);
    console.log(
      carrier.substring(0, 17).padEnd(18) + '| ' +
      String(stats.total).padEnd(6) + '| ' +
      (Math.round((stats.etd / stats.total) * 100) + '%').padEnd(5) + '| ' +
      (Math.round((stats.vessel / stats.total) * 100) + '%').padEnd(6) + '| ' +
      (Math.round((stats.si / stats.total) * 100) + '%').padEnd(5) + '| ' +
      (Math.round((stats.vgm / stats.total) * 100) + '%').padEnd(5) + '| ' +
      (Math.round((stats.cargo / stats.total) * 100) + '%').padEnd(5) + '| ' +
      pctAll3 + '%'
    );
  }

  // Show what's missing
  console.log('\n═══ MISSING CUTOFFS ANALYSIS ═══\n');

  const missingAll = matched.filter(s => !s.si_cutoff && !s.vgm_cutoff && !s.cargo_cutoff);
  console.log('Shipments with BC but missing ALL cutoffs: ' + missingAll.length);

  const missingByCarrier: Record<string, string[]> = {};
  for (const s of missingAll) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!missingByCarrier[carrier]) missingByCarrier[carrier] = [];
    missingByCarrier[carrier].push(s.booking_number);
  }

  for (const [carrier, bookings] of Object.entries(missingByCarrier)) {
    console.log('\n' + carrier + ' (' + bookings.length + '):');
    for (const bn of bookings.slice(0, 5)) {
      console.log('  - ' + bn);
    }
    if (bookings.length > 5) {
      console.log('  ... and ' + (bookings.length - 5) + ' more');
    }
  }
}

main().catch(console.error);
