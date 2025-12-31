/**
 * Rebuild Shipments V2 - Using Carrier Entity Extraction
 *
 * FIXED APPROACH:
 * - Use carrier entity from entity_extractions (NOT sender domain matching)
 * - entity_type = 'carrier' is populated and reliable
 *
 * CORRECT BUSINESS LOGIC:
 * 1. Shipments ONLY created from booking_confirmation + carrier entity exists
 * 2. Other documents LINK to existing shipments by identifier matching
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Recognized carrier names (from entity_extractions where entity_type = 'carrier')
const RECOGNIZED_CARRIERS = [
  'maersk', 'hapag-lloyd', 'hapag lloyd', 'cma cgm', 'cma-cgm', 'msc',
  'cosco', 'one', 'ocean network express', 'evergreen', 'yang ming',
  'hmm', 'hyundai', 'zim', 'pil', 'wan hai', 'wanhai'
];

function normalizeCarrierName(carrier: string): string | null {
  if (!carrier) return null;
  const lower = carrier.toLowerCase().trim();

  // Map variations to standard names
  if (lower.includes('maersk')) return 'Maersk';
  if (lower.includes('hapag')) return 'Hapag-Lloyd';
  if (lower.includes('cma')) return 'CMA CGM';
  if (lower.includes('msc')) return 'MSC';
  if (lower.includes('cosco')) return 'COSCO';
  if (lower.includes('one') || lower.includes('ocean network')) return 'ONE';
  if (lower.includes('evergreen')) return 'Evergreen';
  if (lower.includes('yang')) return 'Yang Ming';
  if (lower.includes('hmm') || lower.includes('hyundai')) return 'HMM';
  if (lower.includes('zim')) return 'ZIM';
  if (lower.includes('pil')) return 'PIL';
  if (lower.includes('wan')) return 'Wan Hai';

  return null; // Unknown carrier
}

async function main() {
  console.log('='.repeat(80));
  console.log('     REBUILD SHIPMENTS V2 - Using Carrier Entity Extraction');
  console.log('='.repeat(80));
  console.log('');

  // ============================================================
  // STEP 1: Delete ALL existing shipments (clean slate)
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
  await supabase.from('shipments').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const { count: remainingShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`  All shipments deleted. Remaining: ${remainingShipments}`);
  console.log('');

  // ============================================================
  // STEP 2: Find booking_confirmation emails WITH carrier entity
  // ============================================================
  console.log('STEP 2: Finding booking_confirmation emails with carrier entity...');
  console.log('-'.repeat(60));

  // Get all booking_confirmation emails
  const { data: bookingConfirmations } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  console.log(`  Total booking_confirmation emails: ${bookingConfirmations?.length || 0}`);

  const emailIds = (bookingConfirmations || []).map(c => c.email_id);

  // Get carrier entities for these emails
  const carrierMap = new Map<string, string>(); // email_id -> carrier_name

  for (let i = 0; i < emailIds.length; i += 500) {
    const chunk = emailIds.slice(i, i + 500);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_value')
      .in('email_id', chunk)
      .eq('entity_type', 'carrier')
      .not('entity_value', 'is', null);

    for (const entity of entities || []) {
      const normalized = normalizeCarrierName(entity.entity_value);
      if (normalized) {
        carrierMap.set(entity.email_id, normalized);
      }
    }
  }

  console.log(`  Emails with recognized carrier entity: ${carrierMap.size}`);

  // Get booking numbers for these emails
  const bookingNumberMap = new Map<string, string>(); // email_id -> booking_number

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

  console.log(`  Emails with booking_number entity: ${bookingNumberMap.size}`);
  console.log('');

  // ============================================================
  // STEP 3: Create shipments from direct carrier booking confirmations
  // ============================================================
  console.log('STEP 3: Creating shipments...');
  console.log('-'.repeat(60));

  const seenBookingNumbers = new Set<string>();
  const shipmentMap = new Map<string, string>(); // booking_number -> shipment_id
  let shipmentsCreated = 0;

  for (const classification of bookingConfirmations || []) {
    const emailId = classification.email_id;
    const carrierName = carrierMap.get(emailId);
    const bookingNumber = bookingNumberMap.get(emailId);

    // Must have BOTH carrier entity AND booking number
    if (!carrierName || !bookingNumber) continue;

    // Dedupe by booking number
    if (seenBookingNumbers.has(bookingNumber)) continue;
    seenBookingNumbers.add(bookingNumber);

    // Create shipment
    const { data: newShipment, error: insertError } = await supabase
      .from('shipments')
      .insert({
        booking_number: bookingNumber,
        carrier_name: carrierName,
        status: 'booked',
        is_direct_carrier_confirmed: true,
        source_email_id: emailId
      })
      .select('id')
      .single();

    if (insertError) {
      console.log(`  Error creating shipment for ${bookingNumber}: ${insertError.message}`);
      continue;
    }

    shipmentMap.set(bookingNumber, newShipment.id);

    // Link the source email
    await supabase
      .from('shipment_documents')
      .insert({
        email_id: emailId,
        shipment_id: newShipment.id,
        document_type: 'booking_confirmation',
        link_method: 'regex',
        document_number: bookingNumber,
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
  // STEP 4: Link other documents to existing shipments
  // ============================================================
  console.log('STEP 4: Linking other documents to shipments...');
  console.log('-'.repeat(60));

  // Get all linked emails (to skip already linked)
  const { data: existingLinks } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedEmailIds = new Set((existingLinks || []).map(l => l.email_id));

  // Build BL and container lookup maps from shipments
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

  // Get all identifier entities with pagination
  let linksCreated = 0;
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('entity_type', ['booking_number', 'bl_number', 'container_number'])
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
  console.log('  APPROACH USED:');
  console.log('  ' + '-'.repeat(50));
  console.log('  ✓ Carrier entity extraction (NOT sender domain)');
  console.log('  ✓ Only booking_confirmation + recognized carrier');
  console.log('  ✓ Documents linked by identifier matching');
  console.log('');
  console.log('='.repeat(80));
}

main().catch(console.error);
