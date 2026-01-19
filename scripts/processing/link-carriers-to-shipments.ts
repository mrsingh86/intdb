#!/usr/bin/env npx tsx
/**
 * Link Carriers to Shipments
 * Identifies carrier from email sender domains and links to shipments
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Carrier domain mapping
const CARRIER_DOMAINS: Record<string, string> = {
  'maersk.com': 'MAERSK',
  'maerskline.com': 'MAERSK',
  'service.hlag.com': 'HAPAG-LLOYD',
  'hlag.com': 'HAPAG-LLOYD',
  'hlag.cloud': 'HAPAG-LLOYD',
  'csd.hlag.com': 'HAPAG-LLOYD',
  'hapag-lloyd.com': 'HAPAG-LLOYD',
  'cma-cgm.com': 'CMA-CGM',
  'one-line.com': 'ONE',
  'msc.com': 'MSC',
  'evergreen-line.com': 'EVERGREEN',
  'cosco.com': 'COSCO',
};

async function linkCarriers() {
  console.log('=== LINKING CARRIERS TO SHIPMENTS ===\n');

  // Get all parties that are shipping lines
  const { data: carriers } = await supabase
    .from('parties')
    .select('id, party_name')
    .eq('party_type', 'shipping_line');

  const carrierByName = new Map<string, string>();
  carriers?.forEach(c => carrierByName.set(c.party_name.toUpperCase(), c.id));

  console.log('Existing carriers:', Array.from(carrierByName.keys()).join(', '));

  // Create missing carriers
  const neededCarriers = ['MAERSK', 'HAPAG-LLOYD', 'CMA-CGM', 'ONE', 'MSC', 'EVERGREEN', 'COSCO'];
  for (const name of neededCarriers) {
    const exists = carrierByName.has(name) || carrierByName.has(name + ' LINE');
    if (!exists) {
      const { data: newCarrier } = await supabase
        .from('parties')
        .insert({ party_name: name, party_type: 'shipping_line', is_customer: false })
        .select()
        .single();
      if (newCarrier) {
        carrierByName.set(name, newCarrier.id);
        console.log('Created carrier:', name);
      }
    }
  }

  // Get all emails with their sender domains
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email');

  // Map email to carrier
  const emailToCarrier = new Map<string, string>();
  emails?.forEach(e => {
    if (e.sender_email) {
      const domain = e.sender_email.split('@')[1]?.toLowerCase();
      const carrierName = CARRIER_DOMAINS[domain];
      if (carrierName) {
        const carrierId = carrierByName.get(carrierName) || carrierByName.get(carrierName + ' LINE');
        if (carrierId) {
          emailToCarrier.set(e.id, carrierId);
        }
      }
    }
  });

  console.log('\nEmails with carrier domains:', emailToCarrier.size);

  // Get all entity extractions for booking numbers
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  // Map booking number to carrier via email
  const bookingToCarrier = new Map<string, string>();
  bookingEntities?.forEach(e => {
    const carrierId = emailToCarrier.get(e.email_id);
    if (carrierId && e.entity_value) {
      // Handle comma-separated values
      const bookings = e.entity_value.split(',').map((b: string) => b.trim());
      bookings.forEach((booking: string) => {
        if (!bookingToCarrier.has(booking)) {
          bookingToCarrier.set(booking, carrierId);
        }
      });
    }
  });

  console.log('Booking numbers with carrier:', bookingToCarrier.size);

  // Get shipments and link
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id');

  console.log('Total shipments:', shipments?.length);

  let linked = 0;
  for (const s of shipments || []) {
    if (s.carrier_id) continue;
    if (!s.booking_number) continue;

    const carrierId = bookingToCarrier.get(s.booking_number);
    if (carrierId) {
      const { error } = await supabase
        .from('shipments')
        .update({ carrier_id: carrierId })
        .eq('id', s.id);
      if (!error) linked++;
    }
  }

  console.log('\nShipments linked to carriers:', linked);

  // Update carrier shipment counts
  const { data: linkedShipments } = await supabase
    .from('shipments')
    .select('carrier_id')
    .not('carrier_id', 'is', null);

  const carrierCounts: Record<string, number> = {};
  linkedShipments?.forEach(s => {
    if (s.carrier_id) carrierCounts[s.carrier_id] = (carrierCounts[s.carrier_id] || 0) + 1;
  });

  for (const [carrierId, count] of Object.entries(carrierCounts)) {
    await supabase.from('parties').update({ total_shipments: count }).eq('id', carrierId);
  }

  console.log('\n=== DONE ===');
}

linkCarriers().catch(console.error);
