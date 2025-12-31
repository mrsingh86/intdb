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

async function lookupCarrierId(carrierName: string): Promise<string | null> {
  const { data } = await supabase
    .from('carriers')
    .select('id')
    .ilike('carrier_name', `%${carrierName}%`)
    .limit(1)
    .single();
  return data?.id || null;
}

async function linkEmailToShipment(emailId: string, shipmentId: string, documentType: string) {
  const { data: existing } = await supabase
    .from('shipment_documents')
    .select('id')
    .eq('email_id', emailId)
    .eq('shipment_id', shipmentId)
    .single();
  if (existing) return;
  await supabase.from('shipment_documents').insert({
    email_id: emailId,
    shipment_id: shipmentId,
    document_type: documentType,
    link_method: 'ai',  // Using 'ai' as this is automated backfill
    link_confidence_score: 100,
  });
}

function buildShipmentFromEntities(entities: any[]): Record<string, any> {
  const data: Record<string, any> = {};
  for (const entity of entities) {
    switch (entity.entity_type) {
      case 'bl_number': data.bl_number = entity.entity_value; break;
      case 'container_number':
        if (!data.container_number_primary) data.container_number_primary = entity.entity_value;
        break;
      case 'vessel_name': data.vessel_name = entity.entity_value; break;
      case 'voyage_number': data.voyage_number = entity.entity_value; break;
      case 'port_of_loading': data.port_of_loading = entity.entity_value; break;
      case 'port_of_loading_code': data.port_of_loading_code = entity.entity_value; break;
      case 'port_of_discharge': data.port_of_discharge = entity.entity_value; break;
      case 'port_of_discharge_code': data.port_of_discharge_code = entity.entity_value; break;
      case 'etd': data.etd = entity.entity_value; break;
      case 'eta': data.eta = entity.entity_value; break;
      case 'si_cutoff': data.si_cutoff = entity.entity_value; break;
      case 'vgm_cutoff': data.vgm_cutoff = entity.entity_value; break;
      case 'cargo_cutoff': data.cargo_cutoff = entity.entity_value; break;
      case 'gate_cutoff': data.gate_cutoff = entity.entity_value; break;
      case 'shipper': data.shipper_name = entity.entity_value; break;
      case 'consignee': data.consignee_name = entity.entity_value; break;
      case 'commodity': data.commodity_description = entity.entity_value; break;
    }
  }
  return data;
}

async function runBackfill() {
  console.log('='.repeat(60));
  console.log('RUNNING SHIPMENT BACKFILL');
  console.log('='.repeat(60));

  const results = {
    shipmentsCreated: 0,
    emailsLinked: 0,
    journeyEventsCreated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  // Get all booking confirmations
  const { data: bookingEmails, error: fetchError } = await supabase
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

  if (fetchError) {
    console.error('Fetch error:', fetchError.message);
    return;
  }

  const directCarrierEmails: any[] = [];
  const internalForwards: any[] = [];

  for (const email of bookingEmails || []) {
    const rawEmail = email.raw_emails as any;
    if (isDirectCarrier(rawEmail.true_sender_email, rawEmail.sender_email)) {
      directCarrierEmails.push({ ...email, rawEmail });
    } else {
      internalForwards.push({ ...email, rawEmail });
    }
  }

  console.log(`\nProcessing ${directCarrierEmails.length} direct carrier emails...`);

  // STEP 1: Create shipments from direct carrier emails
  for (const email of directCarrierEmails) {
    try {
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', email.email_id);

      const bookingNumber = entities?.find(e => e.entity_type === 'booking_number')?.entity_value;
      if (!bookingNumber) {
        results.skipped++;
        continue;
      }

      // Check if shipment already exists
      const { data: existingShipment } = await supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', bookingNumber)
        .single();

      if (existingShipment) {
        await linkEmailToShipment(email.email_id, existingShipment.id, 'booking_confirmation');
        results.emailsLinked++;
        continue;
      }

      const shipmentData = buildShipmentFromEntities(entities || []);
      const carrierName = detectCarrierName(email.rawEmail.true_sender_email || email.rawEmail.sender_email);

      // Look up carrier_id if we detected a carrier name
      let carrierId: string | null = null;
      if (carrierName) {
        carrierId = await lookupCarrierId(carrierName);
      }

      const { data: newShipment, error: insertError } = await supabase
        .from('shipments')
        .insert({
          booking_number: bookingNumber,
          ...shipmentData,
          carrier_id: carrierId,
          status: 'booked',
          created_from_email_id: email.email_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (insertError || !newShipment) {
        results.errors.push(`${bookingNumber}: ${insertError?.message || 'Insert failed'}`);
        continue;
      }

      results.shipmentsCreated++;

      await linkEmailToShipment(email.email_id, newShipment.id, 'booking_confirmation');
      results.emailsLinked++;

      await supabase.from('shipment_journey_events').insert({
        shipment_id: newShipment.id,
        event_category: 'document',
        event_type: 'booking_received_from_carrier',
        event_description: `Booking confirmation received from ${carrierName || 'carrier'}`,
        direction: 'inbound',
        party_name: carrierName || 'Unknown Carrier',
        party_type: 'carrier',
        email_id: email.email_id,
        event_data: {
          sender: email.rawEmail.true_sender_email || email.rawEmail.sender_email,
          subject: email.rawEmail.subject,
        },
        occurred_at: email.rawEmail.received_at,
      });
      results.journeyEventsCreated++;

    } catch (err: any) {
      results.errors.push(`${email.email_id}: ${err.message}`);
    }
  }

  console.log(`\nProcessing ${internalForwards.length} internal forwards...`);

  // STEP 2: Link internal forwards
  for (const email of internalForwards) {
    try {
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', email.email_id);

      const bookingNumber = entities?.find(e => e.entity_type === 'booking_number')?.entity_value;
      if (!bookingNumber) {
        results.skipped++;
        continue;
      }

      const { data: existingShipment } = await supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', bookingNumber)
        .single();

      if (!existingShipment) {
        results.skipped++;
        continue;
      }

      await linkEmailToShipment(email.email_id, existingShipment.id, 'booking_confirmation');
      results.emailsLinked++;

      const sender = email.rawEmail.true_sender_email || email.rawEmail.sender_email || '';
      const isOutbound = sender.includes('intoglo.com');

      await supabase.from('shipment_journey_events').insert({
        shipment_id: existingShipment.id,
        event_category: 'communication',
        event_type: isOutbound ? 'booking_shared_with_customer' : 'customer_response',
        event_description: isOutbound
          ? 'Booking confirmation shared with customer'
          : 'Response received regarding booking',
        direction: isOutbound ? 'outbound' : 'inbound',
        party_name: isOutbound ? 'Customer' : sender.split('@')[0],
        party_type: isOutbound ? 'customer' : 'external',
        email_id: email.email_id,
        event_data: {
          sender: sender,
          subject: email.rawEmail.subject,
          is_internal_forward: true,
        },
        occurred_at: email.rawEmail.received_at,
      });
      results.journeyEventsCreated++;

    } catch (err: any) {
      results.errors.push(`${email.email_id}: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Shipments created: ${results.shipmentsCreated}`);
  console.log(`🔗 Emails linked: ${results.emailsLinked}`);
  console.log(`📍 Journey events: ${results.journeyEventsCreated}`);
  console.log(`⏭️  Skipped (no booking#): ${results.skipped}`);
  if (results.errors.length > 0) {
    console.log(`❌ Errors: ${results.errors.length}`);
    results.errors.slice(0, 5).forEach(e => console.log(`   - ${e}`));
  }
}

runBackfill().catch(console.error);
