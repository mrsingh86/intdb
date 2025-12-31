#!/usr/bin/env npx tsx
/**
 * Backfill Direct Carrier Flag
 *
 * Sets is_direct_carrier_confirmed = true for shipments that have
 * booking confirmations from direct carrier domains.
 *
 * NOTE: The column must already exist in the shipments table.
 * If it doesn't, run this SQL first:
 *   ALTER TABLE shipments ADD COLUMN is_direct_carrier_confirmed BOOLEAN DEFAULT false;
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Direct carrier domains (single source of truth)
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

async function backfill() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('          BACKFILL: Direct Carrier Confirmation Flag');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // First check if column exists by trying to query it
  console.log('1. Checking if column exists...');
  const { data: testData, error: testError } = await supabase
    .from('shipments')
    .select('id, is_direct_carrier_confirmed')
    .limit(1);

  if (testError) {
    console.log('   ERROR: Column does not exist! Run this SQL first:');
    console.log('');
    console.log('   ALTER TABLE shipments ADD COLUMN is_direct_carrier_confirmed BOOLEAN DEFAULT false;');
    console.log('');
    return;
  }
  console.log('   Column exists');

  // Step 2: Get all shipments with booking_confirmation documents
  console.log('');
  console.log('2. Finding shipments with booking confirmations...');

  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id')
    .eq('document_type', 'booking_confirmation');

  console.log(`   Found ${shipmentDocs?.length || 0} booking confirmation links`);

  // Step 3: Get email senders
  console.log('');
  console.log('3. Loading email senders...');

  const emailIds = [...new Set(shipmentDocs?.map(d => d.email_id) || [])];
  const emailSenders = new Map<string, string>();

  for (let i = 0; i < emailIds.length; i += 100) {
    const batch = emailIds.slice(i, i + 100);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, true_sender_email, sender_email')
      .in('id', batch);

    for (const e of emails || []) {
      emailSenders.set(e.id, e.true_sender_email || e.sender_email || '');
    }
  }
  console.log(`   Loaded ${emailSenders.size} email senders`);

  // Step 4: Identify direct carrier shipments
  console.log('');
  console.log('4. Identifying direct carrier shipments...');

  const directCarrierShipments = new Set<string>();
  const carrierBreakdown: Record<string, Set<string>> = {};

  for (const doc of shipmentDocs || []) {
    const sender = emailSenders.get(doc.email_id);
    if (isDirectCarrier(sender || null)) {
      directCarrierShipments.add(doc.shipment_id);

      // Track carrier breakdown
      const domain = (sender || '').toLowerCase().split('@')[1] || '';
      const carrier = DIRECT_CARRIER_DOMAINS.find(d => domain.includes(d)) || 'other';
      if (!carrierBreakdown[carrier]) carrierBreakdown[carrier] = new Set();
      carrierBreakdown[carrier].add(doc.shipment_id);
    }
  }

  console.log(`   Direct carrier shipments: ${directCarrierShipments.size}`);

  // Step 5: Update shipments one by one (more reliable)
  console.log('');
  console.log('5. Updating shipments...');

  let updated = 0;
  let failed = 0;

  for (const shipmentId of directCarrierShipments) {
    const { error } = await supabase
      .from('shipments')
      .update({ is_direct_carrier_confirmed: true })
      .eq('id', shipmentId);

    if (error) {
      failed++;
      if (failed <= 3) {
        console.log(`   Error: ${error.message}`);
      }
    } else {
      updated++;
    }

    if ((updated + failed) % 20 === 0) {
      process.stdout.write(`   Progress: ${updated + failed}/${directCarrierShipments.size}\r`);
    }
  }

  console.log('');
  console.log('');

  // Step 6: Verify
  const { count: directCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', true);

  const { count: totalCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('RESULTS:');
  console.log('─'.repeat(60));
  console.log(`   Updated: ${updated}`);
  console.log(`   Failed:  ${failed}`);
  console.log('');
  console.log('BY CARRIER:');
  console.log('─'.repeat(60));
  for (const [carrier, shipments] of Object.entries(carrierBreakdown).sort((a, b) => b[1].size - a[1].size)) {
    console.log(`   ${carrier.padEnd(25)} ${shipments.size} shipments`);
  }
  console.log('');
  console.log('SINGLE SOURCE OF TRUTH:');
  console.log('─'.repeat(60));
  console.log(`   Total shipments:                    ${totalCount}`);
  console.log(`   is_direct_carrier_confirmed = true: ${directCount}  ← REAL SHIPMENTS`);
  console.log(`   is_direct_carrier_confirmed = false: ${(totalCount || 0) - (directCount || 0)}`);
  console.log('');
  console.log('BROWSER SHOULD SHOW: ' + directCount + ' shipments');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

backfill().catch(console.error);
