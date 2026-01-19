/**
 * Link Internal Forwards to Shipments
 *
 * Links booking confirmation emails that came from internal users (not direct carriers)
 * to existing shipments. These represent document sharing and communication flow.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DIRECT_CARRIER_DOMAINS = [
  'maersk', 'hlag', 'hapag', 'cma-cgm', 'cmacgm', 'msc.com',
  'coscon', 'cosco', 'oocl', 'one-line', 'evergreen', 'yangming',
  'hmm21', 'zim.com', 'paborlines', 'namsung', 'sinokor',
  'heung-a', 'kmtc', 'wanhai', 'tslines', 'sitc'
];

function isDirectCarrier(trueSenderEmail: string | null, senderEmail: string | null): boolean {
  const emailToCheck = trueSenderEmail || senderEmail || '';
  const domain = emailToCheck.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

async function linkInternalForwards() {
  console.log('='.repeat(70));
  console.log('LINKING INTERNAL FORWARDS TO SHIPMENTS');
  console.log('='.repeat(70));

  const stats = {
    totalForwards: 0,
    withBookingNumber: 0,
    matchedToShipment: 0,
    documentsLinked: 0,
    alreadyLinked: 0,
    noShipmentFound: 0,
  };

  // Get all booking confirmation emails
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      raw_emails!inner (
        id,
        sender_email,
        true_sender_email,
        subject,
        received_at
      )
    `)
    .eq('document_type', 'booking_confirmation');

  // Filter to NON-carrier emails (internal forwards)
  const internalForwards = (bookingEmails || []).filter(email => {
    const rawEmail = email.raw_emails as any;
    return !isDirectCarrier(rawEmail.true_sender_email, rawEmail.sender_email);
  });

  stats.totalForwards = internalForwards.length;
  console.log(`\nInternal forward emails: ${stats.totalForwards}`);

  for (const forward of internalForwards) {
    // Get booking number from entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', forward.email_id)
      .eq('entity_type', 'booking_number');

    const bookingNumber = entities?.[0]?.entity_value;
    if (!bookingNumber) continue;

    stats.withBookingNumber++;

    // Find shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      stats.noShipmentFound++;
      continue;
    }

    stats.matchedToShipment++;

    // Check if already linked
    const { data: existing } = await supabase
      .from('shipment_documents')
      .select('id')
      .eq('email_id', forward.email_id)
      .eq('shipment_id', shipment.id)
      .single();

    if (existing) {
      stats.alreadyLinked++;
      continue;
    }

    // Determine document type based on sender
    const rawEmail = forward.raw_emails as any;
    const sender = rawEmail.true_sender_email || rawEmail.sender_email || '';
    const isOutbound = sender.includes('intoglo.com');

    // Link document
    const { error } = await supabase.from('shipment_documents').insert({
      email_id: forward.email_id,
      shipment_id: shipment.id,
      document_type: isOutbound ? 'booking_shared' : 'customer_correspondence',
      link_method: 'ai',
      link_confidence_score: 90,
    });

    if (!error) {
      stats.documentsLinked++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('INTERNAL FORWARDS LINKING COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total internal forwards: ${stats.totalForwards}`);
  console.log(`With booking number: ${stats.withBookingNumber}`);
  console.log(`Matched to shipment: ${stats.matchedToShipment}`);
  console.log(`Already linked: ${stats.alreadyLinked}`);
  console.log(`Newly linked: ${stats.documentsLinked}`);
  console.log(`No shipment found: ${stats.noShipmentFound}`);

  // Final count
  const { count: docCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal shipment_documents: ${docCount}`);
}

linkInternalForwards().catch(console.error);
