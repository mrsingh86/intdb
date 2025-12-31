#!/usr/bin/env npx tsx
/**
 * Investigate why some shipments are missing cutoffs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  // Get shipments missing ALL cutoffs
  const { data: missingAll } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('Shipments missing ALL cutoffs:', missingAll?.length);

  // Get carrier names
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]) || []);

  // Breakdown by carrier
  console.log('\nMISSING CUTOFFS BY CARRIER:');
  const byCarrier: Record<string, number> = {};
  missingAll?.forEach(s => {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    byCarrier[carrier] = (byCarrier[carrier] || 0) + 1;
  });
  Object.entries(byCarrier)
    .sort((a, b) => b[1] - a[1])
    .forEach(([carrier, count]) => console.log('  ' + carrier + ': ' + count));

  // Sample 5 shipments missing cutoffs and check their emails
  console.log('\n=== INVESTIGATING SAMPLE SHIPMENTS ===');
  const sampleMissing = missingAll?.slice(0, 5) || [];

  for (const shipment of sampleMissing) {
    console.log('\n---');
    console.log('Booking:', shipment.booking_number);
    console.log('Carrier:', carrierMap.get(shipment.carrier_id) || 'Unknown');

    // Find related emails via document_classifications or entity_extractions
    const { data: extractions } = await supabase
      .from('entity_extractions')
      .select('email_id, booking_number')
      .eq('booking_number', shipment.booking_number);

    const emailIds = extractions?.map(e => e.email_id) || [];
    console.log('Related emails found:', emailIds.length);

    if (emailIds.length > 0) {
      // Get email subjects
      const { data: emails } = await supabase
        .from('raw_emails')
        .select('id, subject, body_text')
        .in('id', emailIds.slice(0, 3));

      for (const email of emails || []) {
        console.log('  Email:', email.subject?.substring(0, 60));

        // Check for cutoff keywords in body
        const body = (email.body_text || '').toLowerCase();
        const hasEmbeddedPdf = body.includes('=== ') && body.includes('.pdf ===');
        const hasCutoffKeywords = body.includes('cut-off') || body.includes('cutoff') ||
          body.includes('deadline') || body.includes('closing');

        console.log('    Has embedded PDF:', hasEmbeddedPdf);
        console.log('    Has cutoff keywords:', hasCutoffKeywords);

        // Check attachments
        const { data: attachments } = await supabase
          .from('raw_attachments')
          .select('filename, extracted_text')
          .eq('email_id', email.id)
          .ilike('mime_type', '%pdf%');

        for (const att of attachments || []) {
          const hasText = att.extracted_text && att.extracted_text.length > 100;
          const textHasCutoff = (att.extracted_text || '').toLowerCase().includes('cut');
          console.log('    PDF:', att.filename.substring(0, 40));
          console.log('      Has text:', hasText, hasText ? `(${att.extracted_text?.length} chars)` : '');
          console.log('      Has cutoff in text:', textHasCutoff);
        }
      }
    }
  }

  // Check if there are booking confirmations without shipments
  console.log('\n\n=== BOOKING CONFIRMATIONS WITHOUT SHIPMENTS ===');
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .in('id', bookingEmails?.map(b => b.email_id) || []);

  // Get all shipment booking numbers
  const { data: allShipments } = await supabase.from('shipments').select('booking_number');
  const shipmentBookings = new Set(allShipments?.map(s => s.booking_number) || []);

  let orphanCount = 0;
  for (const email of bcEmails || []) {
    // Try to extract booking number from subject
    const match = email.subject?.match(/\b(\d{9,})\b/) ||
      email.subject?.match(/hl-?(\d{8})/i) ||
      email.subject?.match(/COSU(\d+)/i);

    if (match) {
      const bn = match[1] || match[0];
      if (!shipmentBookings.has(bn) && !shipmentBookings.has(bn.replace(/\D/g, ''))) {
        orphanCount++;
        if (orphanCount <= 5) {
          console.log('  Orphan booking:', bn, '-', email.subject?.substring(0, 50));
        }
      }
    }
  }
  console.log('Total orphan booking emails:', orphanCount);
}

investigate().catch(console.error);
