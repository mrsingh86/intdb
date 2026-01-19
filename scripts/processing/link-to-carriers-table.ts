#!/usr/bin/env npx tsx
/**
 * Link Shipments to Carriers table (not parties)
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
  console.log('=== LINKING SHIPMENTS TO CARRIERS TABLE ===\n');

  // Get carriers from carriers table
  const { data: carriers } = await supabase.from('carriers').select('*');

  console.log('Carriers in carriers table:');
  carriers?.forEach(c => console.log(`  ${c.carrier_name || c.name}: ${c.id}`));

  // Find Hapag-Lloyd and Maersk IDs
  const hapagId = carriers?.find(c => (c.carrier_name || c.name || '').toLowerCase().includes('hapag'))?.id;
  const maerskId = carriers?.find(c => (c.carrier_name || c.name || '').toLowerCase().includes('maersk'))?.id;

  console.log('\nHapag-Lloyd ID:', hapagId);
  console.log('Maersk ID:', maerskId);

  // Get emails with carrier domains
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
      if (maerskId) emailToCarrier.set(e.id, maerskId);
    }
  });

  console.log('Emails mapped to carriers:', emailToCarrier.size);

  // Get shipments needing carrier
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, carrier_id, booking_number, created_from_email_id')
    .is('carrier_id', null);

  console.log('Shipments needing carrier:', shipments?.length);

  let linked = 0;
  for (const s of shipments || []) {
    if (!s.created_from_email_id) continue;

    const carrierId = emailToCarrier.get(s.created_from_email_id);
    if (carrierId) {
      const { error } = await supabase
        .from('shipments')
        .update({ carrier_id: carrierId })
        .eq('id', s.id);

      if (!error) {
        linked++;
        console.log(`Linked ${s.booking_number} to carrier`);
      } else {
        console.error('Error:', s.booking_number, error.message);
      }
    }
  }

  console.log('\n=== FINAL STATUS ===');
  console.log('Shipments linked:', linked);

  // Show distribution
  const { data: final } = await supabase
    .from('shipments')
    .select('carrier_id');

  const counts: Record<string, number> = {};
  final?.forEach(s => {
    if (s.carrier_id) counts[s.carrier_id] = (counts[s.carrier_id] || 0) + 1;
  });

  console.log('\nBy carrier:');
  for (const [id, count] of Object.entries(counts)) {
    const carrier = carriers?.find(c => c.id === id);
    console.log(`  ${carrier?.carrier_name || carrier?.name || id}: ${count}`);
  }
}

main().catch(console.error);
