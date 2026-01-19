#!/usr/bin/env npx tsx
/**
 * Count Real Shipments
 *
 * "Real shipments" = shipments that have a booking_confirmation
 * from a DIRECT CARRIER domain (using true_sender_email)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Direct carrier domains
const DIRECT_CARRIER_DOMAINS = [
  'maersk.com',
  'hapag-lloyd.com',
  'hlag.com',
  'service.hlag.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com',
  'evergreen-marine.com',
  'oocl.com',
  'cosco.com',
  'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];

function isDirectCarrier(email: string | null): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

async function countRealShipments() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    COUNTING REAL SHIPMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Get all shipments
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`Total shipments in database: ${totalShipments}`);
  console.log('');

  // Step 2: Get shipments with booking_confirmation documents
  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id, document_type')
    .eq('document_type', 'booking_confirmation');

  const shipmentsWithBooking = new Set(shipmentDocs?.map(d => d.shipment_id) || []);
  console.log(`Shipments with booking_confirmation: ${shipmentsWithBooking.size}`);

  // Step 3: Get email senders for these booking confirmations
  const emailIds = [...new Set(shipmentDocs?.map(d => d.email_id) || [])];
  console.log(`Unique booking confirmation emails: ${emailIds.length}`);
  console.log('');

  // Fetch emails in batches
  const emailSenders = new Map<string, { trueSender: string | null; sender: string | null }>();

  for (let i = 0; i < emailIds.length; i += 100) {
    const batch = emailIds.slice(i, i + 100);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, true_sender_email, sender_email')
      .in('id', batch);

    for (const e of emails || []) {
      emailSenders.set(e.id, {
        trueSender: e.true_sender_email,
        sender: e.sender_email
      });
    }
  }

  // Step 4: Count shipments with DIRECT CARRIER booking confirmations
  const directCarrierShipments = new Set<string>();
  const forwardedShipments = new Set<string>();
  const carrierBreakdown: Record<string, number> = {};

  for (const doc of shipmentDocs || []) {
    const senders = emailSenders.get(doc.email_id);
    if (!senders) continue;

    const trueSender = senders.trueSender || senders.sender || '';

    if (isDirectCarrier(trueSender)) {
      directCarrierShipments.add(doc.shipment_id);

      // Track which carrier
      const domain = trueSender.toLowerCase().split('@')[1] || 'unknown';
      const carrier = DIRECT_CARRIER_DOMAINS.find(d => domain.includes(d)) || 'other';
      carrierBreakdown[carrier] = (carrierBreakdown[carrier] || 0) + 1;
    } else {
      forwardedShipments.add(doc.shipment_id);
    }
  }

  // Shipments that are ONLY forwarded (no direct carrier booking)
  const onlyForwardedShipments = new Set(
    [...forwardedShipments].filter(id => !directCarrierShipments.has(id))
  );

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('SHIPMENT COUNTS:');
  console.log('─'.repeat(60));
  console.log(`  Total shipments:                     ${totalShipments}`);
  console.log(`  With any booking_confirmation:       ${shipmentsWithBooking.size}`);
  console.log(`  With DIRECT CARRIER booking:         ${directCarrierShipments.size}  ← REAL SHIPMENTS`);
  console.log(`  Only forwarded (no direct carrier):  ${onlyForwardedShipments.size}`);
  console.log('');

  console.log('BY CARRIER DOMAIN:');
  console.log('─'.repeat(60));
  for (const [carrier, count] of Object.entries(carrierBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${carrier.padEnd(30)} ${count}`);
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`BROWSER SHOULD SHOW: ${directCarrierShipments.size} shipments`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

countRealShipments().catch(console.error);
