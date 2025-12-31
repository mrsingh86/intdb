#!/usr/bin/env npx tsx
/**
 * Fix Orphaned Carrier IDs and Link Carriers
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('=== FIXING ORPHANED CARRIERS AND LINKING ===\n');

  // Step 1: Get all valid party IDs
  const { data: parties } = await supabase
    .from('parties')
    .select('id, party_name, party_type');

  const validPartyIds = new Set(parties?.map(p => p.id));
  const carriers = parties?.filter(p => p.party_type === 'shipping_line');

  console.log('Valid shipping line carriers:');
  carriers?.forEach(c => console.log(`  ${c.party_name}: ${c.id}`));

  // Find HAPAG and MAERSK IDs
  const hapagId = carriers?.find(c => c.party_name.includes('HAPAG'))?.id;
  const maerskLineId = carriers?.find(c => c.party_name === 'MAERSK LINE')?.id;

  console.log('\nHAPAG-LLOYD ID:', hapagId);
  console.log('MAERSK LINE ID:', maerskLineId);

  // Step 2: Find and clear orphaned carrier_ids
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, carrier_id, booking_number, created_from_email_id');

  const orphaned = shipments?.filter(s => {
    if (s.carrier_id === null) return false;
    return validPartyIds.has(s.carrier_id) === false;
  }) || [];

  console.log('\nShipments with orphaned carrier_id:', orphaned.length);

  if (orphaned.length > 0) {
    for (const s of orphaned) {
      await supabase.from('shipments').update({ carrier_id: null }).eq('id', s.id);
    }
    console.log('Cleared orphaned carrier IDs');
  }

  // Step 3: Get email-to-carrier mapping
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email');

  const emailToCarrier = new Map<string, string>();
  emails?.forEach(e => {
    if (!e.sender_email) return;
    const lower = e.sender_email.toLowerCase();

    if (lower.includes('hlag') || lower.includes('hapag')) {
      if (hapagId) emailToCarrier.set(e.id, hapagId);
    } else if (lower.includes('maersk')) {
      if (maerskLineId) emailToCarrier.set(e.id, maerskLineId);
    }
  });

  console.log('Emails mapped to carriers:', emailToCarrier.size);

  // Step 4: Link shipments to carriers
  // Refetch shipments after clearing orphans
  const { data: shipmentsToLink } = await supabase
    .from('shipments')
    .select('id, carrier_id, booking_number, created_from_email_id')
    .is('carrier_id', null);

  console.log('Shipments needing carrier:', shipmentsToLink?.length);

  let linked = 0;
  for (const s of shipmentsToLink || []) {
    if (!s.created_from_email_id) continue;

    const carrierId = emailToCarrier.get(s.created_from_email_id);
    if (carrierId) {
      const { error } = await supabase
        .from('shipments')
        .update({ carrier_id: carrierId })
        .eq('id', s.id);

      if (!error) {
        linked++;
      } else {
        console.error('Error linking:', s.booking_number, error.message);
      }
    }
  }

  console.log('Shipments linked:', linked);

  // Step 5: Show final distribution
  const { data: final } = await supabase
    .from('shipments')
    .select('carrier_id');

  const withCarrier = final?.filter(s => s.carrier_id !== null).length || 0;
  const withoutCarrier = final?.filter(s => s.carrier_id === null).length || 0;

  console.log('\n=== FINAL STATUS ===');
  console.log('Shipments with carrier:', withCarrier);
  console.log('Shipments without carrier:', withoutCarrier);

  // Count by carrier
  const counts: Record<string, number> = {};
  final?.forEach(s => {
    if (s.carrier_id) {
      counts[s.carrier_id] = (counts[s.carrier_id] || 0) + 1;
    }
  });

  console.log('\nBy carrier:');
  for (const [id, count] of Object.entries(counts)) {
    const carrier = carriers?.find(c => c.id === id);
    console.log(`  ${carrier?.party_name || id}: ${count}`);
  }
}

main().catch(console.error);
