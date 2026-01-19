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

function detectCarrierName(email: string): string | null {
  const domain = (email || '').toLowerCase();
  if (domain.includes('maersk')) return 'Maersk';
  if (domain.includes('hlag') || domain.includes('hapag')) return 'Hapag-Lloyd';
  if (domain.includes('cma') || domain.includes('cmacgm')) return 'CMA CGM';
  if (domain.includes('msc.com')) return 'MSC';
  if (domain.includes('cosco') || domain.includes('coscon')) return 'COSCO';
  if (domain.includes('oocl')) return 'OOCL';
  if (domain.includes('one-line')) return 'ONE';
  if (domain.includes('evergreen')) return 'Evergreen';
  if (domain.includes('yangming')) return 'Yang Ming';
  if (domain.includes('zim')) return 'ZIM';
  return null;
}

async function linkEmailToShipment(emailId: string, shipmentId: string, documentType: string) {
  const { data: existing } = await supabase
    .from('shipment_documents')
    .select('id')
    .eq('email_id', emailId)
    .eq('shipment_id', shipmentId)
    .single();

  if (existing) return false;

  const { error } = await supabase.from('shipment_documents').insert({
    email_id: emailId,
    shipment_id: shipmentId,
    document_type: documentType,
    link_method: 'ai',
    link_confidence_score: 100,
  });

  return !error;
}

async function run() {
  console.log('='.repeat(60));
  console.log('LINKING SHIPMENT DOCUMENTS & CREATING JOURNEY EVENTS');
  console.log('='.repeat(60));

  const results = {
    docsLinked: 0,
    journeyEvents: 0,
    errors: 0,
  };

  // Get all existing shipments with their source email
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id');

  console.log(`\nFound ${shipments?.length || 0} shipments to link\n`);

  // STEP 1: Link direct carrier emails to shipments
  for (const shipment of shipments || []) {
    if (!shipment.created_from_email_id) continue;

    // Get the email details
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id, sender_email, true_sender_email, subject, received_at')
      .eq('id', shipment.created_from_email_id)
      .single();

    if (!email) continue;

    // Link document
    const linked = await linkEmailToShipment(email.id, shipment.id, 'booking_confirmation');
    if (linked) results.docsLinked++;

    // Create journey event for carrier receipt
    const carrierName = detectCarrierName(email.true_sender_email || email.sender_email);

    const { error: journeyError } = await supabase.from('shipment_journey_events').insert({
      shipment_id: shipment.id,
      event_category: 'document',
      event_type: 'booking_received_from_carrier',
      event_description: `Booking confirmation received from ${carrierName || 'carrier'}`,
      direction: 'inbound',
      party_name: carrierName || 'Unknown Carrier',
      party_type: 'carrier',
      email_id: email.id,
      event_data: {
        sender: email.true_sender_email || email.sender_email,
        subject: email.subject,
      },
      occurred_at: email.received_at,
    });

    if (!journeyError) results.journeyEvents++;
    else results.errors++;
  }

  console.log('\nSTEP 1: Direct carrier links complete');
  console.log(`  Documents linked: ${results.docsLinked}`);
  console.log(`  Journey events: ${results.journeyEvents}`);

  // STEP 2: Find internal forwards and link them
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

  let internalLinked = 0;
  let internalJourney = 0;

  for (const doc of bookingEmails || []) {
    const rawEmail = doc.raw_emails as any;

    // Skip direct carrier emails (already handled)
    if (isDirectCarrier(rawEmail.true_sender_email, rawEmail.sender_email)) {
      continue;
    }

    // Get booking number from entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', doc.email_id);

    const bookingNumber = entities?.find(e => e.entity_type === 'booking_number')?.entity_value;
    if (!bookingNumber) continue;

    // Find the shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) continue;

    // Link document
    const linked = await linkEmailToShipment(doc.email_id, shipment.id, 'booking_confirmation');
    if (linked) internalLinked++;

    // Create journey event
    const sender = rawEmail.true_sender_email || rawEmail.sender_email || '';
    const isOutbound = sender.includes('intoglo.com');

    const { error } = await supabase.from('shipment_journey_events').insert({
      shipment_id: shipment.id,
      event_category: 'communication',
      event_type: isOutbound ? 'booking_shared_with_customer' : 'customer_response',
      event_description: isOutbound
        ? 'Booking confirmation shared with customer'
        : 'Response received regarding booking',
      direction: isOutbound ? 'outbound' : 'inbound',
      party_name: isOutbound ? 'Customer' : sender.split('@')[0],
      party_type: isOutbound ? 'customer' : 'external',
      email_id: doc.email_id,
      event_data: {
        sender: sender,
        subject: rawEmail.subject,
        is_internal_forward: true,
      },
      occurred_at: rawEmail.received_at,
    });

    if (!error) internalJourney++;
  }

  console.log('\nSTEP 2: Internal forward links complete');
  console.log(`  Documents linked: ${internalLinked}`);
  console.log(`  Journey events: ${internalJourney}`);

  console.log('\n' + '='.repeat(60));
  console.log('FINAL TOTALS');
  console.log('='.repeat(60));
  console.log(`Documents linked: ${results.docsLinked + internalLinked}`);
  console.log(`Journey events: ${results.journeyEvents + internalJourney}`);
  console.log(`Errors: ${results.errors}`);

  // Verify counts
  const { count: docCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });
  const { count: journeyCount } = await supabase
    .from('shipment_journey_events')
    .select('*', { count: 'exact', head: true });

  console.log(`\nDatabase verification:`);
  console.log(`  shipment_documents: ${docCount}`);
  console.log(`  shipment_journey_events: ${journeyCount}`);
}

run().catch(console.error);
