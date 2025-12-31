#!/usr/bin/env npx tsx
/**
 * Run Migration 023: Direct Carrier Flag
 *
 * Adds is_direct_carrier_confirmed column to shipments table
 * and backfills existing data.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Direct carrier domains (single source of truth for detection)
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

async function runMigration() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('MIGRATION 023: Direct Carrier Confirmation Flag');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Add column using RPC
  console.log('1. Adding is_direct_carrier_confirmed column...');

  const alterSql = `
    ALTER TABLE shipments
    ADD COLUMN IF NOT EXISTS is_direct_carrier_confirmed BOOLEAN DEFAULT false
  `;

  const { error: alterError } = await supabase.rpc('exec_sql', { sql: alterSql });
  if (alterError && !alterError.message.includes('already exists')) {
    console.log(`   Warning: ${alterError.message}`);
    // Try direct update - column might exist
  }
  console.log('   Done');

  // Step 2: Get all shipments with booking_confirmation documents
  console.log('');
  console.log('2. Finding shipments with direct carrier booking confirmations...');

  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id')
    .eq('document_type', 'booking_confirmation');

  console.log(`   Found ${shipmentDocs?.length || 0} booking confirmation links`);

  // Step 3: Get email senders
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

  // Step 4: Identify direct carrier shipments
  const directCarrierShipments = new Set<string>();

  for (const doc of shipmentDocs || []) {
    const sender = emailSenders.get(doc.email_id);
    if (isDirectCarrier(sender || null)) {
      directCarrierShipments.add(doc.shipment_id);
    }
  }

  console.log(`   Direct carrier shipments: ${directCarrierShipments.size}`);

  // Step 5: Update shipments
  console.log('');
  console.log('3. Updating shipments with direct carrier flag...');

  let updated = 0;
  const shipmentIds = [...directCarrierShipments];

  for (let i = 0; i < shipmentIds.length; i += 50) {
    const batch = shipmentIds.slice(i, i + 50);
    const { error } = await supabase
      .from('shipments')
      .update({ is_direct_carrier_confirmed: true })
      .in('id', batch);

    if (!error) {
      updated += batch.length;
    }
    process.stdout.write(`   Progress: ${updated}/${shipmentIds.length}\r`);
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
  console.log('                         MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('SINGLE SOURCE OF TRUTH:');
  console.log('─'.repeat(60));
  console.log(`   Total shipments:                    ${totalCount}`);
  console.log(`   is_direct_carrier_confirmed = true: ${directCount}  ← REAL SHIPMENTS`);
  console.log(`   is_direct_carrier_confirmed = false: ${(totalCount || 0) - (directCount || 0)}`);
  console.log('');
  console.log('USAGE:');
  console.log('─'.repeat(60));
  console.log('   SELECT * FROM shipments WHERE is_direct_carrier_confirmed = true');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

runMigration().catch(console.error);
