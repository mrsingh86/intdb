#!/usr/bin/env npx tsx
/**
 * Link Carriers to Shipments via Email ID
 * Uses email_id from entity_extractions to link shipments to carriers
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
  'oocl.com': 'OOCL',
  'yangming.com': 'YANG MING',
  'hmm21.com': 'HMM',
  'zim.com': 'ZIM',
  'intoglo.com': 'INTOGLO', // Forwarded emails
};

async function linkCarriers() {
  console.log('=== LINKING CARRIERS TO SHIPMENTS VIA EMAIL ===\n');

  // Get/create carrier parties
  const { data: existingCarriers } = await supabase
    .from('parties')
    .select('id, party_name')
    .eq('party_type', 'shipping_line');

  const carrierByName = new Map<string, string>();
  existingCarriers?.forEach(c => carrierByName.set(c.party_name.toUpperCase(), c.id));

  console.log('Existing carriers:', Array.from(carrierByName.keys()).join(', '));

  // Create missing carriers
  const neededCarriers = ['MAERSK', 'HAPAG-LLOYD', 'CMA-CGM', 'ONE', 'MSC', 'EVERGREEN', 'COSCO', 'OOCL', 'YANG MING', 'HMM', 'ZIM'];
  for (const name of neededCarriers) {
    if (!carrierByName.has(name)) {
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

  // Get all emails with sender domains
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email');

  // Map email to carrier ID
  const emailToCarrier = new Map<string, string>();
  emails?.forEach(e => {
    if (e.sender_email) {
      const domain = e.sender_email.split('@')[1]?.toLowerCase();
      if (domain) {
        // Check all domain patterns
        for (const [pattern, carrierName] of Object.entries(CARRIER_DOMAINS)) {
          if (domain.includes(pattern) || pattern.includes(domain)) {
            const carrierId = carrierByName.get(carrierName);
            if (carrierId) {
              emailToCarrier.set(e.id, carrierId);
              break;
            }
          }
        }
      }
    }
  });

  console.log('Emails with identified carriers:', emailToCarrier.size);

  // Get all entity extractions with booking numbers and their email IDs
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  console.log('Booking number entities:', bookingEntities?.length);

  // Map email_id to carrier for booking entities
  const emailToBookings = new Map<string, string[]>();
  bookingEntities?.forEach(e => {
    const carrierId = emailToCarrier.get(e.email_id);
    if (carrierId && e.entity_value) {
      const bookings = e.entity_value.split(',').map(b => b.trim());
      bookings.forEach(booking => {
        if (!emailToBookings.has(booking)) {
          emailToBookings.set(booking, []);
        }
        emailToBookings.get(booking)?.push(carrierId);
      });
    }
  });

  console.log('Booking numbers with carriers:', emailToBookings.size);

  // Get shipments with created_from_email_id
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, created_from_email_id');

  console.log('Total shipments:', shipments?.length);

  let linked = 0;

  // Method 1: Link via created_from_email_id
  console.log('\n--- Linking via created_from_email_id ---');
  for (const s of shipments || []) {
    if (s.carrier_id) continue;
    if (s.created_from_email_id) {
      const carrierId = emailToCarrier.get(s.created_from_email_id);
      if (carrierId) {
        const { error } = await supabase
          .from('shipments')
          .update({ carrier_id: carrierId })
          .eq('id', s.id);
        if (error) {
          console.error('Error updating:', error.message);
        } else {
          linked++;
        }
      }
    }
  }

  console.log('Shipments linked via source email:', linked);

  // Method 2: Link via booking number match
  console.log('\n--- Linking via booking number ---');
  let linkedViaBooking = 0;
  for (const s of shipments || []) {
    if (s.carrier_id) continue;
    if (s.booking_number) {
      const carrierIds = emailToBookings.get(s.booking_number);
      if (carrierIds && carrierIds.length > 0) {
        const { error } = await supabase
          .from('shipments')
          .update({ carrier_id: carrierIds[0] })
          .eq('id', s.id);
        if (error) {
          console.error('Error updating:', error.message);
        } else {
          linkedViaBooking++;
        }
      }
    }
  }

  console.log('Shipments linked via booking number:', linkedViaBooking);

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
  console.log('Total linked:', linked + linkedViaEmail);
}

linkCarriers().catch(console.error);
