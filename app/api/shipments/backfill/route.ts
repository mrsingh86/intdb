import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Direct carrier domains - only these create shipments
const DIRECT_CARRIER_DOMAINS = [
  'maersk', 'hlag', 'hapag', 'cma-cgm', 'cmacgm', 'msc.com',
  'coscon', 'cosco', 'oocl', 'one-line', 'evergreen', 'yangming',
  'hmm21', 'zim.com', 'paborlines', 'namsung', 'sinokor',
  'heung-a', 'kmtc', 'wanhai', 'tslines', 'sitc'
];

function isDirectCarrier(trueSenderEmail: string | null, senderEmail: string | null): boolean {
  // Check true_sender_email first (actual sender before forwarding)
  const emailToCheck = trueSenderEmail || senderEmail || '';
  const domain = emailToCheck.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

function detectCarrier(email: string): string | null {
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

/**
 * POST /api/shipments/backfill
 *
 * CORRECT BUSINESS LOGIC:
 * 1. CREATE shipment only from booking_confirmation + direct carrier
 * 2. LINK internal forwards to existing shipments
 * 3. TRACK journey events for document flow visibility
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = body.limit || 50;
    const dryRun = body.dryRun || false;

    const results = {
      shipmentsCreated: 0,
      emailsLinked: 0,
      journeyEventsCreated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // STEP 1: Get all booking_confirmation emails with their entities
    const { data: bookingEmails, error: fetchError } = await supabase
      .from('document_classifications')
      .select(`
        email_id,
        document_type,
        raw_emails!inner (
          id,
          sender_email,
          true_sender_email,
          subject,
          received_at
        )
      `)
      .eq('document_type', 'booking_confirmation')
      .limit(limit);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // STEP 2: Separate into direct carrier vs internal forwards
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

    if (dryRun) {
      return NextResponse.json({
        message: 'Dry run - no changes made',
        directCarrierEmails: directCarrierEmails.length,
        internalForwards: internalForwards.length,
        sampleDirectCarrier: directCarrierEmails.slice(0, 3).map(e => ({
          subject: e.rawEmail.subject,
          true_sender: e.rawEmail.true_sender_email,
        })),
        sampleInternalForwards: internalForwards.slice(0, 3).map(e => ({
          subject: e.rawEmail.subject,
          true_sender: e.rawEmail.true_sender_email,
        })),
      });
    }

    // STEP 3: Create shipments from direct carrier emails
    for (const email of directCarrierEmails) {
      try {
        // Get booking number from entities
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
          // Just link the email
          await linkEmailToShipment(email.email_id, existingShipment.id, 'booking_confirmation');
          results.emailsLinked++;
          continue;
        }

        // Build shipment record from entities
        const shipmentData = buildShipmentFromEntities(entities || []);
        const carrier = detectCarrier(email.rawEmail.true_sender_email || email.rawEmail.sender_email);

        // Create shipment
        const { data: newShipment, error: insertError } = await supabase
          .from('shipments')
          .insert({
            booking_number: bookingNumber,
            ...shipmentData,
            carrier_name: carrier,
            status: 'booked',
            created_from_email_id: email.email_id,
            is_direct_carrier_booking: true,
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

        // Link email to shipment
        await linkEmailToShipment(email.email_id, newShipment.id, 'booking_confirmation');
        results.emailsLinked++;

        // Create journey event: booking received from carrier
        await supabase.from('shipment_journey_events').insert({
          shipment_id: newShipment.id,
          event_category: 'document',
          event_type: 'booking_received_from_carrier',
          event_description: `Booking confirmation received from ${carrier}`,
          direction: 'inbound',
          party_name: carrier,
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

    // STEP 4: Link internal forwards and track journey
    for (const email of internalForwards) {
      try {
        // Get booking number from entities
        const { data: entities } = await supabase
          .from('entity_extractions')
          .select('entity_type, entity_value')
          .eq('email_id', email.email_id);

        const bookingNumber = entities?.find(e => e.entity_type === 'booking_number')?.entity_value;
        if (!bookingNumber) {
          results.skipped++;
          continue;
        }

        // Find existing shipment
        const { data: existingShipment } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', bookingNumber)
          .single();

        if (!existingShipment) {
          // No shipment to link to - skip but don't error
          results.skipped++;
          continue;
        }

        // Link email to shipment
        await linkEmailToShipment(email.email_id, existingShipment.id, 'booking_confirmation');
        results.emailsLinked++;

        // Determine if this is outbound (ops → customer) or inbound (customer → ops)
        const sender = email.rawEmail.true_sender_email || email.rawEmail.sender_email || '';
        const isOutbound = sender.includes('intoglo.com');

        // Create journey event: document shared or acknowledged
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

    return NextResponse.json({
      message: 'Shipment backfill complete',
      totalBookingConfirmations: bookingEmails?.length || 0,
      directCarrierEmails: directCarrierEmails.length,
      internalForwards: internalForwards.length,
      results,
      errors: results.errors.slice(0, 10),
    });

  } catch (error: any) {
    console.error('[API:POST /shipments/backfill] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function linkEmailToShipment(emailId: string, shipmentId: string, documentType: string) {
  // Check if already linked
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
    link_method: 'backfill',
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

/**
 * GET /api/shipments/backfill
 *
 * Get stats on backfill status
 */
export async function GET() {
  try {
    // Get booking confirmation breakdown
    const { data: bookingEmails } = await supabase
      .from('document_classifications')
      .select(`
        email_id,
        raw_emails!inner (
          sender_email,
          true_sender_email
        )
      `)
      .eq('document_type', 'booking_confirmation');

    let directCarrier = 0;
    let internalForward = 0;

    for (const email of bookingEmails || []) {
      const rawEmail = email.raw_emails as any;
      if (isDirectCarrier(rawEmail.true_sender_email, rawEmail.sender_email)) {
        directCarrier++;
      } else {
        internalForward++;
      }
    }

    // Get current shipment counts
    const { count: totalShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true });

    const { count: journeyEvents } = await supabase
      .from('shipment_journey_events')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      bookingConfirmations: {
        total: bookingEmails?.length || 0,
        directCarrier,
        internalForward,
      },
      currentState: {
        shipments: totalShipments || 0,
        journeyEvents: journeyEvents || 0,
      },
      expected: {
        shipmentsToCreate: directCarrier,
        forwardsToTrack: internalForward,
      }
    });

  } catch (error: any) {
    console.error('[API:GET /shipments/backfill] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
