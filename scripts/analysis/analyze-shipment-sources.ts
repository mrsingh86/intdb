#!/usr/bin/env npx tsx
/**
 * Analyze: What type of emails created each shipment?
 * Goal: Shipments should be created from DIRECT carrier emails only
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com', 'maersk.com', 'msc.com',
  'cma-cgm.com', 'evergreen-line.com', 'oocl.com', 'cosco.com',
  'yangming.com', 'one-line.com', 'zim.com', 'hmm21.com',
  'pilship.com', 'wanhai.com', 'sitc.com',
];

async function analyze() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SHIPMENT SOURCE ANALYSIS');
  console.log('What type of email created each shipment?');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_at')
    .order('created_at', { ascending: false });

  console.log(`Total shipments: ${shipments?.length || 0}`);
  console.log('');

  // 2. For each shipment, find the FIRST linked email (the one that created it)
  const stats = {
    fromDirectCarrier: 0,
    fromIntogloForward: 0,
    fromOther: 0,
    noLinkedEmail: 0,
  };

  const directCarrierShipments: { booking: string; sender: string; subject: string }[] = [];
  const forwardedShipments: { booking: string; sender: string; subject: string }[] = [];

  for (const shipment of shipments || []) {
    // Get first linked email (oldest)
    const { data: links } = await supabase
      .from('shipment_documents')
      .select('email_id, created_at')
      .eq('shipment_id', shipment.id)
      .order('created_at', { ascending: true })
      .limit(1);

    if (!links || links.length === 0) {
      stats.noLinkedEmail++;
      continue;
    }

    const firstEmailId = links[0].email_id;

    // Get email details
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, subject')
      .eq('id', firstEmailId)
      .single();

    if (!email) {
      stats.noLinkedEmail++;
      continue;
    }

    const sender = email.sender_email?.toLowerCase() || '';
    const domain = sender.split('@')[1] || '';
    const isDirectCarrier = CARRIER_DOMAINS.some(d => domain.includes(d));
    const isIntoglo = domain.includes('intoglo.com');

    if (isDirectCarrier) {
      stats.fromDirectCarrier++;
      directCarrierShipments.push({
        booking: shipment.booking_number || shipment.id.substring(0, 8),
        sender: email.sender_email,
        subject: (email.subject || '').substring(0, 50),
      });
    } else if (isIntoglo) {
      stats.fromIntogloForward++;
      forwardedShipments.push({
        booking: shipment.booking_number || shipment.id.substring(0, 8),
        sender: email.sender_email,
        subject: (email.subject || '').substring(0, 50),
      });
    } else {
      stats.fromOther++;
    }
  }

  console.log('SHIPMENT CREATION SOURCE:');
  console.log('─'.repeat(60));
  console.log(`  From DIRECT carrier email:  ${stats.fromDirectCarrier} (${Math.round(stats.fromDirectCarrier / (shipments?.length || 1) * 100)}%) ✓ CORRECT`);
  console.log(`  From Intoglo forward:       ${stats.fromIntogloForward} (${Math.round(stats.fromIntogloForward / (shipments?.length || 1) * 100)}%) ⚠ SHOULD LINK, NOT CREATE`);
  console.log(`  From other sources:         ${stats.fromOther} (${Math.round(stats.fromOther / (shipments?.length || 1) * 100)}%)`);
  console.log(`  No linked email:            ${stats.noLinkedEmail}`);
  console.log('');

  // 3. Sample shipments created from forwards (these are problematic)
  console.log('');
  console.log('SAMPLE: Shipments created from FORWARDS (should have been LINKED instead):');
  console.log('─'.repeat(60));
  for (const s of forwardedShipments.slice(0, 10)) {
    console.log(`  Booking: ${s.booking}`);
    console.log(`  Sender:  ${s.sender}`);
    console.log(`  Subject: ${s.subject}`);
    console.log('');
  }

  // 4. Check: Do these forwarded shipments have a direct carrier email that could be the source?
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('CHECKING: Do forwarded shipments have a direct carrier email?');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  let hasDirectAlternative = 0;
  let noDirectAlternative = 0;

  for (const s of forwardedShipments.slice(0, 50)) {
    // Check if there's a direct carrier email with the same booking number
    const { data: directEmails } = await supabase
      .from('entity_extractions')
      .select('email_id')
      .eq('entity_type', 'booking_number')
      .eq('entity_value', s.booking);

    let foundDirect = false;
    for (const e of directEmails || []) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('sender_email')
        .eq('id', e.email_id)
        .single();

      const domain = email?.sender_email?.split('@')[1] || '';
      if (CARRIER_DOMAINS.some(d => domain.includes(d))) {
        foundDirect = true;
        break;
      }
    }

    if (foundDirect) {
      hasDirectAlternative++;
    } else {
      noDirectAlternative++;
    }
  }

  console.log(`  Forwarded shipments WITH direct carrier email:    ${hasDirectAlternative} (can be fixed)`);
  console.log(`  Forwarded shipments WITHOUT direct carrier email: ${noDirectAlternative} (no alternative)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
