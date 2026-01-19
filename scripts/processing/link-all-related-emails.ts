#!/usr/bin/env npx tsx
/**
 * Link Shipments to ALL Related Emails and Extract from Carrier Emails
 *
 * For each shipment, find ALL emails mentioning the booking number,
 * prioritize carrier emails (hlag.com, maersk.com) for data extraction
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Carrier detection from sender email
const CARRIER_DOMAINS: Record<string, string> = {
  'hlag': 'Hapag-Lloyd',
  'hapag': 'Hapag-Lloyd',
  'maersk': 'Maersk Line',
  'cma-cgm': 'CMA CGM',
  'msc.com': 'MSC',
  'cosco': 'COSCO Shipping',
  'one-line': 'ONE',
  'evergreen': 'Evergreen',
  'oocl': 'OOCL',
};

// Carrier patterns in content
const CARRIER_CONTENT_PATTERNS = [
  { pattern: /hapag[-\s]?lloyd|HLCU|HLXU|HLCL/i, name: 'Hapag-Lloyd' },
  { pattern: /maersk|MAEU|MSKU/i, name: 'Maersk Line' },
  { pattern: /cma[\s-]?cgm|CMAU/i, name: 'CMA CGM' },
  { pattern: /\bMSC\b|MSCU|MEDU/i, name: 'MSC' },
  { pattern: /cosco|COSU/i, name: 'COSCO Shipping' },
];

function detectCarrierFromSender(senderEmail: string): string | null {
  if (!senderEmail) return null;
  const lower = senderEmail.toLowerCase();
  for (const [domain, carrier] of Object.entries(CARRIER_DOMAINS)) {
    if (lower.includes(domain)) {
      return carrier;
    }
  }
  return null;
}

function detectCarrierFromContent(text: string): string | null {
  for (const { pattern, name } of CARRIER_CONTENT_PATTERNS) {
    if (pattern.test(text)) {
      return name;
    }
  }
  return null;
}

async function linkAndExtract() {
  console.log('=== LINKING SHIPMENTS TO ALL RELATED EMAILS ===\n');

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierByName = new Map<string, string>();
  carriers?.forEach(c => carrierByName.set(c.carrier_name.toLowerCase(), c.id));

  // Get shipments without carrier
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, vessel_name, etd, eta, port_of_loading, port_of_discharge')
    .is('carrier_id', null);

  console.log('Shipments without carrier:', shipments?.length);

  // Get all entity extractions with booking numbers
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  // Build map: booking_number -> email_ids
  const bookingToEmails = new Map<string, string[]>();
  bookingEntities?.forEach(e => {
    const bookings = e.entity_value.split(',').map((b: string) => b.trim());
    bookings.forEach((booking: string) => {
      if (!bookingToEmails.has(booking)) {
        bookingToEmails.set(booking, []);
      }
      bookingToEmails.get(booking)?.push(e.email_id);
    });
  });

  console.log('Booking numbers mapped:', bookingToEmails.size);

  let updated = 0;

  for (const shipment of shipments || []) {
    const emailIds = bookingToEmails.get(shipment.booking_number) || [];
    if (emailIds.length === 0) continue;

    // Fetch all related emails
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, subject, body_text')
      .in('id', emailIds);

    // Find carrier email (from carrier domain)
    let carrierName: string | null = null;
    let bestEmail: any = null;

    for (const email of emails || []) {
      const fromSender = detectCarrierFromSender(email.sender_email);
      if (fromSender) {
        carrierName = fromSender;
        bestEmail = email;
        break;
      }
    }

    // If no carrier from sender, try content
    if (!carrierName) {
      for (const email of emails || []) {
        const fromContent = detectCarrierFromContent(`${email.subject} ${email.body_text || ''}`);
        if (fromContent) {
          carrierName = fromContent;
          bestEmail = email;
          break;
        }
      }
    }

    if (carrierName) {
      const carrierId = carrierByName.get(carrierName.toLowerCase());
      if (carrierId) {
        const { error } = await supabase
          .from('shipments')
          .update({ carrier_id: carrierId })
          .eq('id', shipment.id);

        if (!error) {
          updated++;
          console.log('Linked', shipment.booking_number, 'to', carrierName);
        }
      }
    }
  }

  console.log('\n=== RESULTS ===');
  console.log('Shipments updated:', updated);

  // Show final coverage
  const { data: final } = await supabase
    .from('shipments')
    .select('carrier_id');

  const withCarrier = final?.filter(s => s.carrier_id).length || 0;
  const total = final?.length || 0;
  console.log(`\nCarrier coverage: ${withCarrier}/${total} (${Math.round((withCarrier/total)*100)}%)`);
}

linkAndExtract().catch(console.error);
