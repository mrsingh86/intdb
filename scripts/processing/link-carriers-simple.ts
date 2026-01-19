#!/usr/bin/env npx tsx
/**
 * Link Carriers to Shipments - Simplified Version
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function linkCarriers() {
  console.log('=== LINKING CARRIERS TO SHIPMENTS ===\n');

  // Get all carriers
  const { data: carriers } = await supabase
    .from('parties')
    .select('id, party_name')
    .eq('party_type', 'shipping_line');

  console.log('Available carriers:');
  carriers?.forEach(c => console.log(`  ${c.party_name}: ${c.id}`));

  // Find HAPAG-LLOYD and MAERSK
  const hapagId = carriers?.find(c => c.party_name.includes('HAPAG'))?.id;
  const maerskId = carriers?.find(c => c.party_name === 'MAERSK LINE')?.id ||
                   carriers?.find(c => c.party_name === 'MAERSK')?.id;

  console.log('\nHAPAG ID:', hapagId);
  console.log('MAERSK ID:', maerskId);

  // Get all emails with sender domains
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email');

  // Map email_id to carrier_id
  const emailToCarrier = new Map<string, string>();
  emails?.forEach(e => {
    if (!e.sender_email) return;
    const lower = e.sender_email.toLowerCase();

    if (lower.includes('hlag') || lower.includes('hapag')) {
      if (hapagId) emailToCarrier.set(e.id, hapagId);
    } else if (lower.includes('maersk')) {
      if (maerskId) emailToCarrier.set(e.id, maerskId);
    }
  });

  console.log('\nEmails with carrier identified:', emailToCarrier.size);

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, carrier_id');

  console.log('Total shipments:', shipments?.length);

  let linked = 0;
  let alreadyLinked = 0;

  for (const s of shipments || []) {
    if (s.carrier_id) {
      alreadyLinked++;
      continue;
    }

    if (!s.created_from_email_id) continue;

    const carrierId = emailToCarrier.get(s.created_from_email_id);
    if (carrierId) {
      console.log(`Linking shipment ${s.booking_number} to carrier ${carrierId}`);
      const { error } = await supabase
        .from('shipments')
        .update({ carrier_id: carrierId })
        .eq('id', s.id);

      if (error) {
        console.error('  Error:', error.message);
      } else {
        linked++;
      }
    }
  }

  console.log('\nAlready linked:', alreadyLinked);
  console.log('Newly linked:', linked);

  // Show carrier distribution
  const { data: updated } = await supabase
    .from('shipments')
    .select('carrier_id')
    .not('carrier_id', 'is', null);

  const counts: Record<string, number> = {};
  updated?.forEach(s => {
    counts[s.carrier_id] = (counts[s.carrier_id] || 0) + 1;
  });

  console.log('\nShipments per carrier:');
  for (const [carrierId, count] of Object.entries(counts)) {
    const carrier = carriers?.find(c => c.id === carrierId);
    console.log(`  ${carrier?.party_name || carrierId}: ${count}`);
  }
}

linkCarriers().catch(console.error);
