/**
 * Rebuild Shipments with Correct Model
 *
 * CORRECT MODEL:
 * - 1 booking_number = 1 shipment (UNIQUE)
 * - Multiple emails linked via shipment_documents
 * - Entity priority: booking_confirmation > booking_amendment > other
 *
 * LINKING LOGIC:
 * 1. Extract booking_number from emails
 * 2. Group emails by booking_number
 * 3. Create ONE shipment per booking_number
 * 4. Link ALL related emails to that shipment
 * 5. Aggregate entity data with priority
 */

import { supabase } from '../utils/supabase-client';
import { parseEntityDate, parseEntityDateTime } from '../lib/utils/date-parser';
import dotenv from 'dotenv';

dotenv.config();

// Document type priority for entity extraction
const DOCUMENT_PRIORITY: Record<string, number> = {
  'booking_confirmation': 100,
  'booking_amendment': 90,
  'shipping_instruction': 80,
  'bill_of_lading': 70,
  'cargo_manifest': 60,
  'arrival_notice': 50,
  'invoice': 40,
  'delivery_order': 30,
  'rate_confirmation': 20,
  'unknown': 10,
};

interface EmailWithBooking {
  email_id: string;
  booking_number: string;
  subject: string;
  sender_email: string;
  received_at: string;
  document_type: string;
  carrier_id: string | null;
}

interface AggregatedEntities {
  booking_number: string;
  bl_number: string | null;
  container_number: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  etd: string | null;
  eta: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  commodity: string | null;
}

async function rebuildShipments() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         REBUILD SHIPMENTS - CORRECT MODEL                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Clear existing shipments (clean rebuild)
  console.log('Step 1: Clearing existing shipments...');

  // Clear in correct order (respecting foreign keys)
  await supabase.from('shipment_audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_link_candidates').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_financials').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_containers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: clearDocsError } = await supabase.from('shipment_documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error: clearShipmentsError } = await supabase.from('shipments').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  if (clearDocsError || clearShipmentsError) {
    console.error('Error clearing tables:', clearDocsError?.message || clearShipmentsError?.message);
    return;
  }
  console.log('  ✓ Cleared existing data\n');

  // Step 2: Get all emails with booking numbers
  console.log('Step 2: Finding all emails with booking numbers...');

  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  if (!bookingEntities || bookingEntities.length === 0) {
    console.log('No booking numbers found in entity_extractions');
    return;
  }

  console.log(`  Found ${bookingEntities.length} booking number entities\n`);

  // Step 3: Get email details and classifications
  console.log('Step 3: Enriching with email details and classifications...');

  const emailIds = [...new Set(bookingEntities.map(e => e.email_id))];

  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, received_at')
    .in('id', emailIds);

  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, carrier_id')
    .in('email_id', emailIds);

  // Build lookup maps
  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);
  const classMap = new Map(classifications?.map(c => [c.email_id, c]) || []);

  // Step 4: Group emails by normalized booking number
  console.log('Step 4: Grouping emails by booking number...\n');

  const bookingGroups = new Map<string, EmailWithBooking[]>();

  for (const entity of bookingEntities) {
    // Normalize booking number (remove HL- prefix, trim)
    const rawBN = entity.entity_value;
    const normalizedBN = rawBN.replace(/^HL-/i, '').split(',')[0].trim();

    const email = emailMap.get(entity.email_id);
    const classification = classMap.get(entity.email_id);

    if (!email) continue;

    const emailWithBooking: EmailWithBooking = {
      email_id: entity.email_id,
      booking_number: normalizedBN,
      subject: email.subject,
      sender_email: email.sender_email,
      received_at: email.received_at,
      document_type: classification?.document_type || 'unknown',
      carrier_id: classification?.carrier_id || null,
    };

    if (!bookingGroups.has(normalizedBN)) {
      bookingGroups.set(normalizedBN, []);
    }
    bookingGroups.get(normalizedBN)!.push(emailWithBooking);
  }

  console.log(`  Found ${bookingGroups.size} unique booking numbers\n`);

  // Step 5: Create shipments and link documents
  console.log('Step 5: Creating shipments and linking documents...\n');

  let shipmentsCreated = 0;
  let documentsLinked = 0;
  const stats = { withCutoffs: 0, withETD: 0, withETA: 0 };

  for (const [bookingNumber, emails] of bookingGroups) {
    // Sort emails by document priority (highest first)
    emails.sort((a, b) => {
      const priorityA = DOCUMENT_PRIORITY[a.document_type] || 0;
      const priorityB = DOCUMENT_PRIORITY[b.document_type] || 0;
      return priorityB - priorityA;
    });

    // Get primary email (highest priority document)
    const primaryEmail = emails[0];

    // Aggregate entities from all emails, respecting priority
    const entities = await aggregateEntities(bookingNumber, emails);

    // Determine carrier from emails
    const carrierId = await determineCarrier(emails);

    // Determine status based on document types
    const status = determineStatus(emails);

    // Create shipment
    const { data: shipment, error: createError } = await supabase
      .from('shipments')
      .insert({
        booking_number: bookingNumber,
        bl_number: entities.bl_number,
        container_number_primary: entities.container_number,
        vessel_name: entities.vessel_name,
        voyage_number: entities.voyage_number,
        port_of_loading: entities.port_of_loading,
        port_of_discharge: entities.port_of_discharge,
        etd: entities.etd,
        eta: entities.eta,
        si_cutoff: entities.si_cutoff,
        vgm_cutoff: entities.vgm_cutoff,
        cargo_cutoff: entities.cargo_cutoff,
        gate_cutoff: entities.gate_cutoff,
        commodity_description: entities.commodity,
        carrier_id: carrierId,
        status: status,
        created_from_email_id: primaryEmail.email_id,
      })
      .select()
      .single();

    if (createError) {
      // May be duplicate - skip
      console.log(`  ⚠️ Skipping ${bookingNumber}: ${createError.message}`);
      continue;
    }

    shipmentsCreated++;

    // Track stats
    if (entities.si_cutoff) stats.withCutoffs++;
    if (entities.etd) stats.withETD++;
    if (entities.eta) stats.withETA++;

    // Link all emails to this shipment
    for (const email of emails) {
      const isPrimary = email.email_id === primaryEmail.email_id;

      const { error: linkError } = await supabase
        .from('shipment_documents')
        .insert({
          shipment_id: shipment.id,
          email_id: email.email_id,
          document_type: email.document_type,
          is_primary: isPrimary,
          link_confidence_score: 95,
          link_method: 'regex',
        });

      if (!linkError) {
        documentsLinked++;
      }
    }

    // Log progress
    const docsCount = emails.length;
    const cutoffStatus = entities.si_cutoff ? '✅' : '❌';
    console.log(`  ${cutoffStatus} ${bookingNumber}: ${docsCount} docs linked`);
  }

  // Step 6: Summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log(`  Shipments created:   ${shipmentsCreated}`);
  console.log(`  Documents linked:    ${documentsLinked}`);
  console.log(`  Avg docs/shipment:   ${(documentsLinked / shipmentsCreated).toFixed(1)}`);
  console.log('');
  console.log(`  With ETD:            ${stats.withETD}/${shipmentsCreated} (${(stats.withETD/shipmentsCreated*100).toFixed(0)}%)`);
  console.log(`  With ETA:            ${stats.withETA}/${shipmentsCreated} (${(stats.withETA/shipmentsCreated*100).toFixed(0)}%)`);
  console.log(`  With Cutoffs:        ${stats.withCutoffs}/${shipmentsCreated} (${(stats.withCutoffs/shipmentsCreated*100).toFixed(0)}%)`);
  console.log('');
}

/**
 * Aggregate entities from all emails for a booking number
 * Priority: booking_confirmation > booking_amendment > other
 */
async function aggregateEntities(
  bookingNumber: string,
  emails: EmailWithBooking[]
): Promise<AggregatedEntities> {
  const result: AggregatedEntities = {
    booking_number: bookingNumber,
    bl_number: null,
    container_number: null,
    vessel_name: null,
    voyage_number: null,
    port_of_loading: null,
    port_of_discharge: null,
    etd: null,
    eta: null,
    si_cutoff: null,
    vgm_cutoff: null,
    cargo_cutoff: null,
    gate_cutoff: null,
    commodity: null,
  };

  // Process emails in priority order
  for (const email of emails) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.email_id);

    if (!entities) continue;

    for (const entity of entities) {
      const value = entity.entity_value;
      const type = entity.entity_type;

      // Only set if not already set (priority order)
      switch (type) {
        case 'bl_number':
          if (!result.bl_number) result.bl_number = value;
          break;
        case 'container_number':
          if (!result.container_number) result.container_number = value;
          break;
        case 'vessel_name':
          if (!result.vessel_name) result.vessel_name = value;
          break;
        case 'voyage_number':
          if (!result.voyage_number) result.voyage_number = value;
          break;
        case 'port_of_loading':
          if (!result.port_of_loading) result.port_of_loading = value;
          break;
        case 'port_of_discharge':
          if (!result.port_of_discharge) result.port_of_discharge = value;
          break;
        case 'etd':
          if (!result.etd) result.etd = parseEntityDate(value);
          break;
        case 'eta':
          if (!result.eta) result.eta = parseEntityDate(value);
          break;
        // Cutoffs use parseEntityDateTime to preserve time
        case 'si_cutoff':
          if (!result.si_cutoff) result.si_cutoff = parseEntityDateTime(value);
          break;
        case 'vgm_cutoff':
          if (!result.vgm_cutoff) result.vgm_cutoff = parseEntityDateTime(value);
          break;
        case 'cargo_cutoff':
          if (!result.cargo_cutoff) result.cargo_cutoff = parseEntityDateTime(value);
          break;
        case 'gate_cutoff':
          if (!result.gate_cutoff) result.gate_cutoff = parseEntityDateTime(value);
          break;
        case 'commodity':
        case 'commodity_description':
          if (!result.commodity) result.commodity = value;
          break;
      }
    }
  }

  return result;
}

/**
 * Determine carrier from linked emails
 */
async function determineCarrier(emails: EmailWithBooking[]): Promise<string | null> {
  // First try from classification
  for (const email of emails) {
    if (email.carrier_id) return email.carrier_id;
  }

  // Try to infer from sender
  for (const email of emails) {
    const sender = email.sender_email.toLowerCase();

    if (sender.includes('hlag.com') || sender.includes('hapag')) {
      const { data } = await supabase.from('carriers').select('id').eq('carrier_code', 'HAPAG').single();
      return data?.id || null;
    }
    if (sender.includes('maersk')) {
      const { data } = await supabase.from('carriers').select('id').eq('carrier_code', 'MAERSK').single();
      return data?.id || null;
    }
    if (sender.includes('msc') || sender.includes('medlog')) {
      const { data } = await supabase.from('carriers').select('id').eq('carrier_code', 'MSC').single();
      return data?.id || null;
    }
    if (sender.includes('cma-cgm')) {
      const { data } = await supabase.from('carriers').select('id').eq('carrier_code', 'CMACGM').single();
      return data?.id || null;
    }
  }

  return null;
}

/**
 * Determine shipment status from document types
 */
function determineStatus(emails: EmailWithBooking[]): string {
  const docTypes = emails.map(e => e.document_type);

  if (docTypes.includes('delivery_order')) return 'delivered';
  if (docTypes.includes('arrival_notice')) return 'arrived';
  if (docTypes.includes('bill_of_lading')) return 'in_transit';
  if (docTypes.includes('shipping_instruction')) return 'booked';
  if (docTypes.includes('booking_confirmation') || docTypes.includes('booking_amendment')) return 'booked';

  return 'draft';
}

rebuildShipments().catch(console.error);
