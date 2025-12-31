#!/usr/bin/env npx tsx
/**
 * Check emails linked to REAL shipments only
 * Real shipment = created from direct carrier booking confirmation
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com', 'maersk.com', 'msc.com',
  'cma-cgm.com', 'evergreen-line.com', 'oocl.com', 'cosco.com',
  'yangming.com', 'one-line.com', 'zim.com', 'hmm21.com',
  'pilship.com', 'wanhai.com', 'sitc.com',
];

async function analyze() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('REAL SHIPMENTS (from direct carrier booking confirmations)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id');

  // Find direct carrier shipments
  const realShipmentIds: string[] = [];

  for (const s of shipments || []) {
    if (!s.created_from_email_id) continue;

    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', s.created_from_email_id)
      .single();

    if (!email) continue;

    // Check true_sender_email first (for emails via ops group), then sender_email
    const trueDomain = email.true_sender_email?.toLowerCase().split('@')[1] || '';
    const senderDomain = email.sender_email?.toLowerCase().split('@')[1] || '';
    const isDirect = DIRECT_CARRIER_DOMAINS.some(d => trueDomain.includes(d) || senderDomain.includes(d));

    if (isDirect) {
      realShipmentIds.push(s.id);
    }
  }

  console.log(`REAL SHIPMENTS: ${realShipmentIds.length}`);
  console.log('');

  // Get emails linked to these real shipments
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id, document_type')
    .in('shipment_id', realShipmentIds);

  const totalLinks = links?.length || 0;
  const uniqueEmails = new Set(links?.map(l => l.email_id) || []);

  console.log('EMAILS LINKED TO REAL SHIPMENTS:');
  console.log('─'.repeat(60));
  console.log(`  Total email-shipment links: ${totalLinks}`);
  console.log(`  Unique emails linked: ${uniqueEmails.size}`);
  console.log(`  Average emails per shipment: ${(totalLinks / realShipmentIds.length).toFixed(1)}`);
  console.log('');

  // By document type
  const byType: Record<string, number> = {};
  for (const link of links || []) {
    byType[link.document_type] = (byType[link.document_type] || 0) + 1;
  }

  console.log('BY DOCUMENT TYPE:');
  console.log('─'.repeat(60));
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  // Distribution
  console.log('');
  console.log('EMAILS PER REAL SHIPMENT:');
  console.log('─'.repeat(60));

  const emailsPerShipment: Record<string, number> = {};
  for (const link of links || []) {
    emailsPerShipment[link.shipment_id] = (emailsPerShipment[link.shipment_id] || 0) + 1;
  }

  const distribution: Record<string, number> = {};
  for (const count of Object.values(emailsPerShipment)) {
    const bucket = count <= 10 ? String(count) : '11+';
    distribution[bucket] = (distribution[bucket] || 0) + 1;
  }

  // Shipments with 0 links
  const shipmentsWithLinks = Object.keys(emailsPerShipment).length;
  const shipmentsWithoutLinks = realShipmentIds.length - shipmentsWithLinks;
  if (shipmentsWithoutLinks > 0) {
    distribution['0'] = shipmentsWithoutLinks;
  }

  for (let i = 0; i <= 10; i++) {
    const count = distribution[String(i)] || 0;
    if (count > 0) {
      const bar = '█'.repeat(Math.min(count, 30));
      console.log(`  ${String(i).padStart(2)} emails: ${String(count).padStart(3)} shipments ${bar}`);
    }
  }
  if (distribution['11+']) {
    console.log(`  11+ emails: ${distribution['11+']} shipments`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
