#!/usr/bin/env npx tsx
/**
 * Calculate coverage for ONLY booking confirmations from shipping lines WITH PDF
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Shipping line domains
const SHIPPING_LINE_DOMAINS = [
  'maersk.com',
  'hapag-lloyd.com',
  'hlag.com',
  'service.hlag.com',
  'cma-cgm.com',
  'coscon.com',
  'msc.com',
  'one-line.com'
];

function isShippingLineDomain(email: string): boolean {
  const domain = email.split('@')[1] || '';
  return SHIPPING_LINE_DOMAINS.some(d => domain.includes(d) || domain.endsWith(d));
}

async function main() {
  // Get booking confirmation emails
  const { data: bcs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bcIds = bcs?.map(b => b.email_id) || [];

  // Get email details
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject, body_text')
    .in('id', bcIds);

  // Get attachments
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, mime_type, extracted_text')
    .in('email_id', bcIds);

  // Group attachments by email
  const attByEmail = new Map<string, any[]>();
  for (const a of attachments || []) {
    const list = attByEmail.get(a.email_id) || [];
    list.push(a);
    attByEmail.set(a.email_id, list);
  }

  // Get shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, carrier_id');

  // Get carriers
  const { data: carriers } = await supabase
    .from('carriers')
    .select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // Filter to shipping line emails with PDF
  const shippingLineBCWithPdf: any[] = [];

  for (const e of emails || []) {
    const sender = e.true_sender_email || e.sender_email || '';

    if (!isShippingLineDomain(sender)) continue;

    const atts = attByEmail.get(e.id) || [];
    const hasPdf = atts.some(a =>
      (a.mime_type && a.mime_type.includes('pdf')) ||
      (a.filename && a.filename.toLowerCase().endsWith('.pdf'))
    );

    if (!hasPdf) continue;

    // This is a real shipping line BC with PDF
    shippingLineBCWithPdf.push({
      ...e,
      sender,
      pdfs: atts.filter(a =>
        (a.mime_type && a.mime_type.includes('pdf')) ||
        (a.filename && a.filename.toLowerCase().endsWith('.pdf'))
      )
    });
  }

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  COVERAGE: SHIPPING LINE BOOKING CONFIRMATIONS WITH PDF           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('Total booking confirmation classifications:', bcIds.length);
  console.log('From shipping line domains WITH PDF:', shippingLineBCWithPdf.length);

  // Match to shipments
  const matchedShipments: any[] = [];
  const unmatchedEmails: any[] = [];

  for (const email of shippingLineBCWithPdf) {
    const subject = email.subject || '';
    const body = (email.body_text || '').substring(0, 5000);

    // Find matching shipment
    let matched = false;
    for (const s of shipments || []) {
      const bn = s.booking_number || '';
      if (bn.length >= 6) {
        const searchTerm = bn.substring(0, Math.min(bn.length, 10));
        if (subject.includes(searchTerm) || body.includes(searchTerm)) {
          matchedShipments.push({ email, shipment: s });
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      unmatchedEmails.push(email);
    }
  }

  // Deduplicate shipments (one shipment may match multiple emails)
  const uniqueShipments = new Map<string, any>();
  for (const { shipment } of matchedShipments) {
    uniqueShipments.set(shipment.id, shipment);
  }

  const shipmentsWithRealBC = Array.from(uniqueShipments.values());
  const total = shipmentsWithRealBC.length;

  console.log('\nShipments matched to shipping line BC+PDF:', total);
  console.log('Unmatched BC emails:', unmatchedEmails.length);

  if (total === 0) {
    console.log('\nNo matches found');
    return;
  }

  // Calculate coverage
  const siCount = shipmentsWithRealBC.filter(s => s.si_cutoff).length;
  const vgmCount = shipmentsWithRealBC.filter(s => s.vgm_cutoff).length;
  const cargoCount = shipmentsWithRealBC.filter(s => s.cargo_cutoff).length;
  const allThree = shipmentsWithRealBC.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;
  const anyOne = shipmentsWithRealBC.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff).length;

  const pct = (n: number) => Math.round((n / total) * 100);
  const bar = (n: number) => {
    const p = Math.round((n / total) * 100);
    return '█'.repeat(Math.floor(p / 5)) + '░'.repeat(20 - Math.floor(p / 5));
  };

  console.log('\n═══ CUTOFF COVERAGE ═══\n');
  console.log('SI Cutoff:    ' + bar(siCount) + ' ' + pct(siCount) + '% (' + siCount + '/' + total + ')');
  console.log('VGM Cutoff:   ' + bar(vgmCount) + ' ' + pct(vgmCount) + '% (' + vgmCount + '/' + total + ')');
  console.log('Cargo Cutoff: ' + bar(cargoCount) + ' ' + pct(cargoCount) + '% (' + cargoCount + '/' + total + ')');
  console.log('');
  console.log('Has ANY cutoff:  ' + bar(anyOne) + ' ' + pct(anyOne) + '% (' + anyOne + '/' + total + ')');
  console.log('Has ALL 3:       ' + bar(allThree) + ' ' + pct(allThree) + '% (' + allThree + '/' + total + ')');

  // By carrier
  console.log('\n═══ BY CARRIER ═══\n');

  const byCarrier: Record<string, { total: number; allThree: number; anyOne: number }> = {};
  for (const s of shipmentsWithRealBC) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (byCarrier[carrier] === undefined) {
      byCarrier[carrier] = { total: 0, allThree: 0, anyOne: 0 };
    }
    byCarrier[carrier].total++;
    if (s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) byCarrier[carrier].allThree++;
    if (s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff) byCarrier[carrier].anyOne++;
  }

  console.log('Carrier'.padEnd(20) + '| Total | All 3 | Rate');
  console.log('─'.repeat(50));

  for (const [carrier, stats] of Object.entries(byCarrier).sort((a, b) => b[1].total - a[1].total)) {
    const rate = Math.round((stats.allThree / stats.total) * 100);
    console.log(
      carrier.substring(0, 19).padEnd(20) + '| ' +
      String(stats.total).padEnd(6) + '| ' +
      String(stats.allThree).padEnd(6) + '| ' + rate + '%'
    );
  }

  // Show missing
  const missingAll = shipmentsWithRealBC.filter(s =>
    s.si_cutoff === null && s.vgm_cutoff === null && s.cargo_cutoff === null
  );

  if (missingAll.length > 0) {
    console.log('\n═══ SHIPMENTS WITH REAL BC+PDF BUT MISSING ALL CUTOFFS ═══\n');
    console.log('Count:', missingAll.length);

    for (const s of missingAll.slice(0, 10)) {
      const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
      console.log('  [' + carrier + '] ' + s.booking_number);
    }
  }
}

main().catch(console.error);
