#!/usr/bin/env npx tsx
/**
 * Diagnose Shipment Data Quality
 * Check why carrier linkage is low and identify missing data
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('=== SHIPMENT DATA QUALITY DIAGNOSIS ===\n');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*');

  const total = shipments?.length || 0;
  console.log('Total shipments:', total);

  // Count fields
  const counts = {
    carrier_id: 0,
    created_from_email_id: 0,
    vessel_name: 0,
    etd: 0,
    eta: 0,
    port_of_loading: 0,
    port_of_discharge: 0,
    si_cutoff: 0,
    vgm_cutoff: 0,
    cargo_cutoff: 0,
    shipper_id: 0,
    consignee_id: 0,
    shipper_name: 0,
    consignee_name: 0,
  };

  for (const s of shipments || []) {
    if (s.carrier_id) counts.carrier_id++;
    if (s.created_from_email_id) counts.created_from_email_id++;
    if (s.vessel_name) counts.vessel_name++;
    if (s.etd) counts.etd++;
    if (s.eta) counts.eta++;
    if (s.port_of_loading) counts.port_of_loading++;
    if (s.port_of_discharge) counts.port_of_discharge++;
    if (s.si_cutoff) counts.si_cutoff++;
    if (s.vgm_cutoff) counts.vgm_cutoff++;
    if (s.cargo_cutoff) counts.cargo_cutoff++;
    if (s.shipper_id) counts.shipper_id++;
    if (s.consignee_id) counts.consignee_id++;
    if (s.shipper_name) counts.shipper_name++;
    if (s.consignee_name) counts.consignee_name++;
  }

  console.log('\nFIELD COVERAGE:');
  for (const [field, count] of Object.entries(counts)) {
    const pct = Math.round((count / total) * 100);
    const status = pct >= 80 ? '✓' : pct >= 50 ? '⚠' : '✗';
    console.log(`  ${status} ${field}: ${count}/${total} (${pct}%)`);
  }

  // Check shipments without source email
  const withoutEmail = shipments?.filter(s => !s.created_from_email_id) || [];
  console.log('\n\nSHIPMENTS WITHOUT SOURCE EMAIL:', withoutEmail.length);
  if (withoutEmail.length > 0) {
    console.log('Sample booking numbers:');
    withoutEmail.slice(0, 5).forEach(s => console.log('  -', s.booking_number));
  }

  // Check email sender domains for ALL booking confirmation emails
  console.log('\n\n=== EMAIL CARRIER ANALYSIS ===');

  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  console.log('Booking confirmation emails:', bookingEmails?.length);

  // Get sender domains
  const emailIds = bookingEmails?.map(e => e.email_id) || [];

  // Fetch in batches
  const senderDomains: Record<string, number> = {};
  const batchSize = 50;

  for (let i = 0; i < emailIds.length; i += batchSize) {
    const batch = emailIds.slice(i, i + batchSize);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('sender_email')
      .in('id', batch);

    emails?.forEach(e => {
      if (e.sender_email) {
        const domain = e.sender_email.split('@')[1]?.toLowerCase().replace('>', '');
        if (domain) {
          senderDomains[domain] = (senderDomains[domain] || 0) + 1;
        }
      }
    });
  }

  console.log('\nBooking confirmation sender domains:');
  Object.entries(senderDomains)
    .sort((a, b) => b[1] - a[1])
    .forEach(([domain, count]) => {
      console.log(`  ${domain}: ${count}`);
    });

  // Check if we can link more carriers
  console.log('\n\n=== CARRIER LINKING POTENTIAL ===');

  const carrierDomains: Record<string, string> = {
    'hlag': 'Hapag-Lloyd',
    'hapag': 'Hapag-Lloyd',
    'maersk': 'Maersk Line',
    'cma-cgm': 'CMA CGM',
    'msc': 'MSC',
    'cosco': 'COSCO Shipping',
    'one-line': 'ONE',
    'evergreen': 'Evergreen',
    'oocl': 'OOCL',
    'yangming': 'Yang Ming',
    'intoglo': 'Intoglo (forwarder)',
    'harisons': 'Harisons (customer)',
  };

  for (const [pattern, carrier] of Object.entries(carrierDomains)) {
    const matches = Object.entries(senderDomains)
      .filter(([domain]) => domain.includes(pattern))
      .reduce((sum, [, count]) => sum + count, 0);
    if (matches > 0) {
      console.log(`  ${carrier}: ${matches} emails`);
    }
  }
}

diagnose().catch(console.error);
