#!/usr/bin/env npx tsx
/**
 * Deep dive into DIRECT CARRIER shipments only (193 real shipments)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com', 'msc.com', 'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com', 'cosco.com', 'coscoshipping.com',
  'yangming.com', 'one-line.com', 'zim.com',
  'hmm21.com', 'pilship.com', 'wanhai.com', 'sitc.com',
];

function isDirectCarrier(trueSender: string | null, sender: string | null): boolean {
  if (trueSender) {
    const domain = trueSender.toLowerCase().split('@')[1] || '';
    if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) return true;
  }
  if (sender) {
    const domain = sender.toLowerCase().split('@')[1] || '';
    return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
  }
  return false;
}

function getCarrierName(trueSender: string | null, sender: string | null): string {
  const domain = (trueSender || sender || '').toLowerCase();
  if (domain.includes('maersk')) return 'Maersk';
  if (domain.includes('hapag') || domain.includes('hlag')) return 'Hapag-Lloyd';
  if (domain.includes('msc')) return 'MSC';
  if (domain.includes('cma')) return 'CMA CGM';
  if (domain.includes('cosco')) return 'COSCO';
  if (domain.includes('one-line')) return 'ONE';
  if (domain.includes('evergreen')) return 'Evergreen';
  if (domain.includes('zim')) return 'ZIM';
  if (domain.includes('yangming')) return 'Yang Ming';
  if (domain.includes('oocl')) return 'OOCL';
  return 'Other';
}

async function deepDive() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('           DIRECT CARRIER SHIPMENTS - DEEP DIVE (Real Shipments Only)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get booking confirmations from direct carriers
  const { data: bookingClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  // Filter to direct carrier emails only
  const directCarrierBookings: { emailId: string; carrier: string; trueSender: string; sender: string }[] = [];

  for (const b of bookingClassifications || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', b.email_id)
      .single();

    if (email && isDirectCarrier(email.true_sender_email, email.sender_email)) {
      directCarrierBookings.push({
        emailId: b.email_id,
        carrier: getCarrierName(email.true_sender_email, email.sender_email),
        trueSender: email.true_sender_email || '',
        sender: email.sender_email || ''
      });
    }
  }

  console.log(`1. TOTAL DIRECT CARRIER BOOKING CONFIRMATIONS: ${directCarrierBookings.length}`);
  console.log('─'.repeat(70));
  console.log('');

  // Carrier breakdown
  const byCarrier: Record<string, number> = {};
  for (const b of directCarrierBookings) {
    byCarrier[b.carrier] = (byCarrier[b.carrier] || 0) + 1;
  }

  console.log('2. BY CARRIER');
  console.log('─'.repeat(70));
  for (const [carrier, count] of Object.entries(byCarrier).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(count / directCarrierBookings.length * 100);
    const bar = '█'.repeat(Math.floor(pct / 3));
    console.log(`   ${carrier.padEnd(15)} ${String(count).padStart(4)}  ${bar} ${pct}%`);
  }
  console.log('');

  // Get unique booking numbers from these emails
  const bookingNumbers = new Set<string>();
  const emailToBooking: Record<string, string> = {};

  for (const b of directCarrierBookings) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_value')
      .eq('email_id', b.emailId)
      .eq('entity_type', 'booking_number')
      .limit(1);

    if (entities && entities.length > 0 && entities[0].entity_value) {
      bookingNumbers.add(entities[0].entity_value);
      emailToBooking[b.emailId] = entities[0].entity_value;
    }
  }

  console.log('3. UNIQUE BOOKINGS');
  console.log('─'.repeat(70));
  console.log(`   Direct carrier emails:     ${directCarrierBookings.length}`);
  console.log(`   Unique booking numbers:    ${bookingNumbers.size}`);
  console.log(`   (Some bookings have multiple emails - confirmations + amendments)`);
  console.log('');

  // Check how many are linked to shipments
  let linkedToShipment = 0;
  let notLinked = 0;
  const linkedShipmentIds = new Set<string>();

  for (const b of directCarrierBookings) {
    const { data: link } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', b.emailId)
      .limit(1);

    if (link && link.length > 0) {
      linkedToShipment++;
      linkedShipmentIds.add(link[0].shipment_id);
    } else {
      notLinked++;
    }
  }

  console.log('4. LINKING STATUS');
  console.log('─'.repeat(70));
  console.log(`   Linked to shipments:       ${linkedToShipment} emails → ${linkedShipmentIds.size} shipments`);
  console.log(`   NOT linked:                ${notLinked} emails`);
  console.log('');

  // Get detailed info on linked shipments
  if (linkedShipmentIds.size > 0) {
    const { data: shipments } = await supabase
      .from('shipments')
      .select('*')
      .in('id', Array.from(linkedShipmentIds));

    console.log('5. SHIPMENT DATA COMPLETENESS');
    console.log('─'.repeat(70));

    const total = shipments?.length || 0;
    const fields: Record<string, number> = {
      booking_number: 0,
      vessel_name: 0,
      voyage_number: 0,
      port_of_loading: 0,
      port_of_discharge: 0,
      etd: 0,
      eta: 0,
      si_cutoff: 0,
      vgm_cutoff: 0,
      cargo_cutoff: 0,
      shipper_id: 0,
      consignee_id: 0,
    };

    for (const s of shipments || []) {
      if (s.booking_number) fields.booking_number++;
      if (s.vessel_name) fields.vessel_name++;
      if (s.voyage_number) fields.voyage_number++;
      if (s.port_of_loading) fields.port_of_loading++;
      if (s.port_of_discharge) fields.port_of_discharge++;
      if (s.etd) fields.etd++;
      if (s.eta) fields.eta++;
      if (s.si_cutoff) fields.si_cutoff++;
      if (s.vgm_cutoff) fields.vgm_cutoff++;
      if (s.cargo_cutoff) fields.cargo_cutoff++;
      if (s.shipper_id) fields.shipper_id++;
      if (s.consignee_id) fields.consignee_id++;
    }

    console.log(`   Total linked shipments: ${total}`);
    console.log('');
    console.log('   FIELD                  COUNT    COVERAGE');
    console.log('   ' + '─'.repeat(50));

    for (const [field, count] of Object.entries(fields)) {
      const pct = Math.round(count / total * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      console.log(`   ${field.padEnd(20)} ${String(count).padStart(4)}  ${bar} ${pct}%`);
    }
    console.log('');

    // Workflow status
    console.log('6. WORKFLOW STATUS');
    console.log('─'.repeat(70));

    const byStatus: Record<string, number> = {};
    for (const s of shipments || []) {
      byStatus[s.status || 'null'] = (byStatus[s.status || 'null'] || 0) + 1;
    }

    for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${status.padEnd(20)} ${count}`);
    }
    console.log('');

    // Sample shipments
    console.log('7. SAMPLE SHIPMENTS (5 most recent)');
    console.log('─'.repeat(70));

    const sorted = (shipments || []).sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );

    for (const s of sorted.slice(0, 5)) {
      console.log('');
      console.log(`   ${s.booking_number || 'N/A'}`);
      console.log(`   ├─ Vessel:   ${s.vessel_name || '-'} / ${s.voyage_number || '-'}`);
      console.log(`   ├─ Route:    ${s.port_of_loading || '-'} → ${s.port_of_discharge || '-'}`);
      console.log(`   ├─ ETD/ETA:  ${s.etd || '-'} → ${s.eta || '-'}`);
      console.log(`   ├─ Cutoffs:  SI:${s.si_cutoff || '-'} VGM:${s.vgm_cutoff || '-'} Cargo:${s.cargo_cutoff || '-'}`);
      console.log(`   └─ Status:   ${s.status || '-'}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

deepDive().catch(console.error);
