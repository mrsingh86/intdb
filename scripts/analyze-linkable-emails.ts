#!/usr/bin/env npx tsx
/**
 * Analyze how many emails can be linked to the 111 direct carrier shipments
 * and by which linker (booking_number, bl_number, container_number, etc.)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com', 'msc.com', 'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com', 'cosco.com', 'coscoshipping.com',
  'yangming.com', 'one-line.com', 'zim.com',
  'hmm21.com', 'pilship.com', 'wanhai.com', 'sitc.com',
];

function isDirectCarrier(trueSender: string | null, sender: string | null): boolean {
  if (trueSender) {
    const domain = trueSender.toLowerCase().split('@')[1] || '';
    if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) return true;
  }
  if (sender) {
    const domain = sender.toLowerCase().split('@')[1] || '';
    return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
  }
  return false;
}

async function analyze() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('        LINKABLE EMAILS ANALYSIS - What can link to 111 Direct Shipments');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Get the 111 direct carrier shipments
  const { data: bookingClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const directCarrierEmailIds: string[] = [];
  for (const b of bookingClassifications || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', b.email_id)
      .single();

    if (email && isDirectCarrier(email.true_sender_email, email.sender_email)) {
      directCarrierEmailIds.push(b.email_id);
    }
  }

  // Get linked shipment IDs
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .in('email_id', directCarrierEmailIds);

  const shipmentIds = [...new Set(links?.map(l => l.shipment_id) || [])];

  // Get shipment details
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, container_number_primary, container_numbers')
    .in('id', shipmentIds);

  console.log(`1. TARGET SHIPMENTS: ${shipments?.length || 0}`);
  console.log('─'.repeat(70));

  // Build lookup maps
  const bookingToShipment = new Map<string, string>();
  const blToShipment = new Map<string, string>();
  const containerToShipment = new Map<string, string>();

  for (const s of shipments || []) {
    if (s.booking_number) bookingToShipment.set(s.booking_number, s.id);
    if (s.bl_number) blToShipment.set(s.bl_number, s.id);
    if (s.container_number_primary) containerToShipment.set(s.container_number_primary, s.id);
    if (s.container_numbers) {
      for (const c of s.container_numbers) {
        containerToShipment.set(c, s.id);
      }
    }
  }

  console.log(`   Booking numbers available: ${bookingToShipment.size}`);
  console.log(`   BL numbers available:      ${blToShipment.size}`);
  console.log(`   Container numbers:         ${containerToShipment.size}`);
  console.log('');

  // Step 2: Get ALL emails and their extracted entities
  console.log('2. SCANNING ALL EMAILS FOR LINKABLE ENTITIES...');
  console.log('─'.repeat(70));

  // Get all entity extractions
  const allEntities: { email_id: string; entity_type: string; entity_value: string }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('entity_type', ['booking_number', 'bl_number', 'container_number'])
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    allEntities.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`   Total linkable entities found: ${allEntities.length}`);
  console.log('');

  // Step 3: Match emails to shipments
  const linkableByBooking = new Map<string, Set<string>>(); // emailId -> shipmentIds
  const linkableByBL = new Map<string, Set<string>>();
  const linkableByContainer = new Map<string, Set<string>>();

  for (const e of allEntities) {
    if (e.entity_type === 'booking_number' && bookingToShipment.has(e.entity_value)) {
      if (!linkableByBooking.has(e.email_id)) linkableByBooking.set(e.email_id, new Set());
      linkableByBooking.get(e.email_id)!.add(bookingToShipment.get(e.entity_value)!);
    }
    if (e.entity_type === 'bl_number' && blToShipment.has(e.entity_value)) {
      if (!linkableByBL.has(e.email_id)) linkableByBL.set(e.email_id, new Set());
      linkableByBL.get(e.email_id)!.add(blToShipment.get(e.entity_value)!);
    }
    if (e.entity_type === 'container_number' && containerToShipment.has(e.entity_value)) {
      if (!linkableByContainer.has(e.email_id)) linkableByContainer.set(e.email_id, new Set());
      linkableByContainer.get(e.email_id)!.add(containerToShipment.get(e.entity_value)!);
    }
  }

  // Get currently linked emails
  const { data: currentLinks } = await supabase
    .from('shipment_documents')
    .select('email_id')
    .in('shipment_id', shipmentIds);

  const alreadyLinked = new Set(currentLinks?.map(l => l.email_id) || []);

  // Calculate NEW linkable (not already linked)
  const newByBooking = new Set<string>();
  const newByBL = new Set<string>();
  const newByContainer = new Set<string>();

  for (const emailId of linkableByBooking.keys()) {
    if (!alreadyLinked.has(emailId)) newByBooking.add(emailId);
  }
  for (const emailId of linkableByBL.keys()) {
    if (!alreadyLinked.has(emailId)) newByBL.add(emailId);
  }
  for (const emailId of linkableByContainer.keys()) {
    if (!alreadyLinked.has(emailId)) newByContainer.add(emailId);
  }

  // Unique new emails (union)
  const allNewLinkable = new Set([...newByBooking, ...newByBL, ...newByContainer]);

  console.log('3. LINKING ANALYSIS');
  console.log('─'.repeat(70));
  console.log('');
  console.log('   LINKER               TOTAL    ALREADY    NEW TO LINK');
  console.log('   ' + '─'.repeat(55));
  console.log(`   By booking_number    ${String(linkableByBooking.size).padStart(5)}    ${String(linkableByBooking.size - newByBooking.size).padStart(7)}    ${String(newByBooking.size).padStart(5)}`);
  console.log(`   By bl_number         ${String(linkableByBL.size).padStart(5)}    ${String(linkableByBL.size - newByBL.size).padStart(7)}    ${String(newByBL.size).padStart(5)}`);
  console.log(`   By container_number  ${String(linkableByContainer.size).padStart(5)}    ${String(linkableByContainer.size - newByContainer.size).padStart(7)}    ${String(newByContainer.size).padStart(5)}`);
  console.log('   ' + '─'.repeat(55));
  console.log(`   TOTAL UNIQUE NEW     ${String(allNewLinkable.size).padStart(5)}`);
  console.log('');

  // Step 4: Breakdown by document type
  console.log('4. NEW LINKABLE EMAILS BY DOCUMENT TYPE');
  console.log('─'.repeat(70));

  const docTypeBreakdown: Record<string, number> = {};

  for (const emailId of allNewLinkable) {
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', emailId)
      .single();

    const docType = classification?.document_type || 'unclassified';
    docTypeBreakdown[docType] = (docTypeBreakdown[docType] || 0) + 1;
  }

  for (const [type, count] of Object.entries(docTypeBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type.padEnd(35)} ${count}`);
  }
  console.log('');

  // Step 5: Sample of new linkable emails
  console.log('5. SAMPLE NEW LINKABLE EMAILS (first 10)');
  console.log('─'.repeat(70));

  let shown = 0;
  for (const emailId of allNewLinkable) {
    if (shown >= 10) break;

    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', emailId)
      .single();

    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('id', emailId)
      .single();

    // Get the matching entity
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', emailId)
      .in('entity_type', ['booking_number', 'bl_number', 'container_number']);

    const matchingEntity = entities?.find(e =>
      (e.entity_type === 'booking_number' && bookingToShipment.has(e.entity_value)) ||
      (e.entity_type === 'bl_number' && blToShipment.has(e.entity_value)) ||
      (e.entity_type === 'container_number' && containerToShipment.has(e.entity_value))
    );

    console.log('');
    console.log(`   ${(email?.subject || 'N/A').substring(0, 55)}...`);
    console.log(`   ├─ Type:   ${classification?.document_type || 'unclassified'}`);
    console.log(`   ├─ From:   ${email?.sender_email || 'N/A'}`);
    console.log(`   └─ Link:   ${matchingEntity?.entity_type} = ${matchingEntity?.entity_value}`);

    shown++;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                                 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`   Target shipments:          ${shipments?.length || 0}`);
  console.log(`   Already linked emails:     ${alreadyLinked.size}`);
  console.log(`   NEW emails to link:        ${allNewLinkable.size}`);
  console.log('');
  console.log(`   Primary linker:            booking_number (${newByBooking.size} new)`);
  console.log(`   Secondary linker:          bl_number (${newByBL.size} new)`);
  console.log(`   Tertiary linker:           container_number (${newByContainer.size} new)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
