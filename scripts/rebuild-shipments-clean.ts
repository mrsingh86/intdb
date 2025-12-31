/**
 * Rebuild Shipments Clean
 *
 * CORRECT BUSINESS LOGIC:
 * 1. Shipments ONLY created from booking_confirmation + direct carrier sender
 * 2. Other documents (amendments, BLs, arrival notices) LINK to existing shipments
 * 3. No shipment creation from random documents with identifiers
 *
 * This script:
 * - Step 1: Delete ALL existing shipments (clean slate)
 * - Step 2: Create shipments ONLY from direct carrier booking confirmations
 * - Step 3: Link all other documents to shipments by matching identifiers
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Direct carrier email patterns - ONLY these can create shipments
const DIRECT_CARRIER_PATTERNS = [
  'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'coscon.com',
  'one-line.com',
  'evergreen-line.com',
  'yangming.com',
  'hmm21.com',
  'zim.com',
  'pilship.com',
  'wanhai.com'
];

const CARRIER_NAMES: Record<string, string> = {
  'hapag-lloyd.com': 'Hapag-Lloyd',
  'maersk.com': 'Maersk',
  'msc.com': 'MSC',
  'cma-cgm.com': 'CMA CGM',
  'coscon.com': 'COSCO',
  'one-line.com': 'ONE',
  'evergreen-line.com': 'Evergreen',
  'yangming.com': 'Yang Ming',
  'hmm21.com': 'HMM',
  'zim.com': 'ZIM',
  'pilship.com': 'PIL',
  'wanhai.com': 'Wan Hai'
};

function isDirectCarrier(senderEmail: string): { isCarrier: boolean; carrierName: string | null } {
  const sender = (senderEmail || '').toLowerCase();
  for (const pattern of DIRECT_CARRIER_PATTERNS) {
    if (sender.includes(pattern)) {
      return { isCarrier: true, carrierName: CARRIER_NAMES[pattern] || pattern };
    }
  }
  return { isCarrier: false, carrierName: null };
}

async function main() {
  console.log('='.repeat(80));
  console.log('          REBUILD SHIPMENTS - CLEAN SLATE');
  console.log('='.repeat(80));
  console.log('');

  // ============================================================
  // STEP 1: Delete ALL existing shipments
  // ============================================================
  console.log('STEP 1: Deleting all existing shipments...');
  console.log('-'.repeat(60));

  // Delete related data first (foreign keys)
  await supabase.from('shipment_documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_journey_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_blockers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('stakeholder_communication_timeline').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('action_tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('shipment_insights').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Delete all shipments
  const { error: deleteError } = await supabase
    .from('shipments')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (deleteError) {
    console.error('Error deleting shipments:', deleteError.message);
    return;
  }

  const { count: remainingShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`  All shipments deleted. Remaining: ${remainingShipments}`);
  console.log('');

  // ============================================================
  // STEP 2: Create shipments ONLY from booking_confirmation + direct carrier
  // ============================================================
  console.log('STEP 2: Creating shipments from direct carrier booking confirmations...');
  console.log('-'.repeat(60));

  // Get all booking_confirmation emails
  const { data: bookingConfirmations, error: classError } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .eq('document_type', 'booking_confirmation');

  if (classError) {
    console.error('Error fetching classifications:', classError.message);
    return;
  }

  console.log(`  Total booking_confirmation emails: ${bookingConfirmations?.length || 0}`);

  // Get email details for these
  const emailIds = (bookingConfirmations || []).map(c => c.email_id);

  // Fetch in batches to avoid query limits
  const emailMap = new Map<string, { sender: string; subject: string; receivedAt: string }>();

  for (let i = 0; i < emailIds.length; i += 500) {
    const chunk = emailIds.slice(i, i + 500);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, true_sender_email, subject, received_at')
      .in('id', chunk);

    for (const email of emails || []) {
      emailMap.set(email.id, {
        sender: email.true_sender_email || email.sender_email || '',
        subject: email.subject || '',
        receivedAt: email.received_at
      });
    }
  }

  // Get booking numbers from entity_extractions
  const bookingNumberMap = new Map<string, string>();

  for (let i = 0; i < emailIds.length; i += 500) {
    const chunk = emailIds.slice(i, i + 500);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_value')
      .in('email_id', chunk)
      .eq('entity_type', 'booking_number')
      .not('entity_value', 'is', null);

    for (const entity of entities || []) {
      if (entity.entity_value) {
        bookingNumberMap.set(entity.email_id, entity.entity_value);
      }
    }
  }

  // Filter to ONLY direct carrier booking confirmations
  const directCarrierBookings: {
    emailId: string;
    bookingNumber: string;
    carrierName: string;
    subject: string;
    receivedAt: string;
  }[] = [];

  const seenBookingNumbers = new Set<string>();

  for (const classification of bookingConfirmations || []) {
    const emailData = emailMap.get(classification.email_id);
    const bookingNumber = bookingNumberMap.get(classification.email_id);

    if (!emailData || !bookingNumber) continue;

    const { isCarrier, carrierName } = isDirectCarrier(emailData.sender);

    if (isCarrier && !seenBookingNumbers.has(bookingNumber)) {
      seenBookingNumbers.add(bookingNumber);
      directCarrierBookings.push({
        emailId: classification.email_id,
        bookingNumber,
        carrierName: carrierName!,
        subject: emailData.subject,
        receivedAt: emailData.receivedAt
      });
    }
  }

  console.log(`  Direct carrier booking confirmations: ${directCarrierBookings.length}`);
  console.log('');

  // Create shipments
  let shipmentsCreated = 0;
  const shipmentMap = new Map<string, string>(); // booking_number -> shipment_id

  for (const booking of directCarrierBookings) {
    const { data: newShipment, error: insertError } = await supabase
      .from('shipments')
      .insert({
        booking_number: booking.bookingNumber,
        carrier_name: booking.carrierName,
        status: 'booked',
        is_direct_carrier_confirmed: true,
        source_email_id: booking.emailId
      })
      .select('id')
      .single();

    if (insertError) {
      console.log(`  Error creating shipment for ${booking.bookingNumber}: ${insertError.message}`);
      continue;
    }

    shipmentMap.set(booking.bookingNumber, newShipment.id);

    // Link the source email
    await supabase
      .from('shipment_documents')
      .insert({
        email_id: booking.emailId,
        shipment_id: newShipment.id,
        document_type: 'booking_confirmation',
        link_method: 'regex',
        document_number: booking.bookingNumber,
        link_confidence_score: 100
      });

    shipmentsCreated++;
    if (shipmentsCreated % 20 === 0) {
      console.log(`  Created ${shipmentsCreated} shipments...`);
    }
  }

  console.log(`  Total shipments created: ${shipmentsCreated}`);
  console.log('');

  // ============================================================
  // STEP 3: Link other documents to existing shipments
  // ============================================================
  console.log('STEP 3: Linking other documents to shipments...');
  console.log('-'.repeat(60));

  // Get all identifier entities (booking_number, bl_number, container_number)
  const identifierTypes = ['booking_number', 'bl_number', 'container_number'];

  // Build lookup maps from shipments
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, container_numbers');

  const blToShipment = new Map<string, string>();
  const containerToShipment = new Map<string, string>();

  for (const s of allShipments || []) {
    if (s.bl_number) blToShipment.set(s.bl_number, s.id);
    if (s.container_numbers) {
      for (const c of s.container_numbers) {
        containerToShipment.set(c, s.id);
      }
    }
  }

  // Get all linked emails (to skip already linked)
  const { data: existingLinks } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedEmailIds = new Set((existingLinks || []).map(l => l.email_id));

  // Get all entity extractions with pagination
  let linksCreated = 0;
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('entity_type', identifierTypes)
      .not('entity_value', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (!entities || entities.length === 0) break;

    for (const entity of entities) {
      if (linkedEmailIds.has(entity.email_id)) continue;

      let shipmentId: string | undefined;

      if (entity.entity_type === 'booking_number') {
        shipmentId = shipmentMap.get(entity.entity_value);
      } else if (entity.entity_type === 'bl_number') {
        shipmentId = blToShipment.get(entity.entity_value);
      } else if (entity.entity_type === 'container_number') {
        shipmentId = containerToShipment.get(entity.entity_value);
      }

      if (!shipmentId) continue;

      // Get document type
      const { data: classification } = await supabase
        .from('document_classifications')
        .select('document_type')
        .eq('email_id', entity.email_id)
        .single();

      const { error: linkError } = await supabase
        .from('shipment_documents')
        .insert({
          email_id: entity.email_id,
          shipment_id: shipmentId,
          document_type: classification?.document_type || 'unknown',
          link_method: 'regex',
          document_number: entity.entity_value,
          link_confidence_score: entity.entity_type === 'booking_number' ? 95 :
                                 entity.entity_type === 'bl_number' ? 90 : 75
        });

      if (!linkError) {
        linksCreated++;
        linkedEmailIds.add(entity.email_id);
      }
    }

    offset += batchSize;
    if (entities.length < batchSize) break;
  }

  console.log(`  Documents linked: ${linksCreated}`);
  console.log('');

  // ============================================================
  // FINAL SUMMARY
  // ============================================================
  console.log('='.repeat(80));
  console.log('                         REBUILD COMPLETE');
  console.log('='.repeat(80));
  console.log('');

  const { count: finalShipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: finalLinkCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  // Count unique linked emails
  const { data: uniqueLinked } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const uniqueLinkedCount = new Set((uniqueLinked || []).map(l => l.email_id)).size;
  const linkPct = Math.round(uniqueLinkedCount / (totalEmails || 1) * 100);

  console.log('  FINAL STATUS:');
  console.log('  ' + '-'.repeat(50));
  console.log(`  Shipments:           ${finalShipmentCount}`);
  console.log(`  Document links:      ${finalLinkCount}`);
  console.log(`  Emails linked:       ${uniqueLinkedCount} / ${totalEmails} (${linkPct}%)`);
  console.log('');
  console.log('  BUSINESS LOGIC:');
  console.log('  ' + '-'.repeat(50));
  console.log('  ✓ Shipments ONLY from direct carrier booking_confirmation');
  console.log('  ✓ Other documents linked to existing shipments');
  console.log('  ✓ No duplicate shipments');
  console.log('');
  console.log('='.repeat(80));
}

main().catch(console.error);
