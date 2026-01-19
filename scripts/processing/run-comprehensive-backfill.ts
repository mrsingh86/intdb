#!/usr/bin/env npx tsx
/**
 * Comprehensive Backfill Script
 *
 * Links all unlinked emails to their matching shipments using:
 * - booking_number (primary)
 * - bl_number (secondary)
 * - container_number (tertiary)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Direct carrier domains for authority scoring
const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com', 'maersk.com', 'msc.com', 'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com', 'oocl.com', 'cosco.com',
  'coscoshipping.com', 'yangming.com', 'one-line.com', 'zim.com',
  'hmm21.com', 'pilship.com', 'wanhai.com', 'sitc.com',
];

function isDirectCarrier(trueSender: string | null, sender: string | null): boolean {
  const email = trueSender || sender || '';
  const domain = email.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

function getEmailAuthority(trueSender: string | null, sender: string | null): number {
  const email = trueSender || sender || '';
  const domain = email.toLowerCase().split('@')[1] || '';

  if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) return 1; // Direct carrier
  if (domain.includes('intoglo.com')) return 3; // Internal
  return 4; // Third party
}

interface LinkCandidate {
  email_id: string;
  shipment_id: string;
  identifier_type: string;
  identifier_value: string;
  document_type: string;
  email_authority: number;
  confidence_score: number;
}

async function runBackfill() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('          COMPREHENSIVE EMAIL-SHIPMENT BACKFILL');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Get all shipments with their identifiers
  console.log('1. Loading shipments...');
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, container_number_primary, container_numbers');

  console.log(`   Found ${shipments?.length || 0} shipments`);

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

  console.log(`   Booking numbers: ${bookingToShipment.size}`);
  console.log(`   BL numbers: ${blToShipment.size}`);
  console.log(`   Container numbers: ${containerToShipment.size}`);
  console.log('');

  // Step 2: Get all linkable entity extractions
  console.log('2. Loading entity extractions...');
  const entities: { email_id: string; entity_type: string; entity_value: string }[] = [];
  let offset = 0;

  while (true) {
    const { data } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('entity_type', ['booking_number', 'bl_number', 'container_number'])
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    entities.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`   Found ${entities.length} linkable entities`);
  console.log('');

  // Step 3: Get currently linked emails
  console.log('3. Loading existing links...');
  const { data: existingLinks } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id');

  const linkedPairs = new Set(
    existingLinks?.map(l => `${l.email_id}:${l.shipment_id}`) || []
  );
  const linkedEmails = new Set(existingLinks?.map(l => l.email_id) || []);

  console.log(`   Existing links: ${existingLinks?.length || 0}`);
  console.log(`   Unique linked emails: ${linkedEmails.size}`);
  console.log('');

  // Step 4: Find new links
  console.log('4. Finding new links...');
  const candidates: LinkCandidate[] = [];

  for (const entity of entities) {
    let shipmentId: string | undefined;
    let identifierType = entity.entity_type;

    if (entity.entity_type === 'booking_number') {
      shipmentId = bookingToShipment.get(entity.entity_value);
    } else if (entity.entity_type === 'bl_number') {
      shipmentId = blToShipment.get(entity.entity_value);
    } else if (entity.entity_type === 'container_number') {
      shipmentId = containerToShipment.get(entity.entity_value);
    }

    if (!shipmentId) continue;

    // Check if already linked
    const pairKey = `${entity.email_id}:${shipmentId}`;
    if (linkedPairs.has(pairKey)) continue;

    // Get email details for document type and authority
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', entity.email_id)
      .single();

    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', entity.email_id)
      .single();

    const authority = getEmailAuthority(
      email?.true_sender_email || null,
      email?.sender_email || null
    );

    // Calculate confidence
    let confidence = 95;
    if (identifierType === 'bl_number') confidence = 90;
    if (identifierType === 'container_number') confidence = 75;
    if (authority === 1) confidence += 5;

    candidates.push({
      email_id: entity.email_id,
      shipment_id: shipmentId,
      identifier_type: identifierType,
      identifier_value: entity.entity_value,
      document_type: classification?.document_type || 'unknown',
      email_authority: authority,
      confidence_score: Math.min(100, confidence),
    });

    // Mark as seen to avoid duplicates
    linkedPairs.add(pairKey);
  }

  // Deduplicate by email_id + shipment_id (prefer booking_number links)
  const uniqueCandidates = new Map<string, LinkCandidate>();
  for (const c of candidates) {
    const key = `${c.email_id}:${c.shipment_id}`;
    const existing = uniqueCandidates.get(key);
    if (!existing || c.confidence_score > existing.confidence_score) {
      uniqueCandidates.set(key, c);
    }
  }

  const finalCandidates = Array.from(uniqueCandidates.values());
  console.log(`   New links to create: ${finalCandidates.length}`);
  console.log('');

  // Step 5: Create the links
  console.log('5. Creating links...');

  let created = 0;
  let failed = 0;
  const byIdentifierType: Record<string, number> = {};
  const byDocumentType: Record<string, number> = {};

  for (const candidate of finalCandidates) {
    const { error } = await supabase.from('shipment_documents').insert({
      email_id: candidate.email_id,
      shipment_id: candidate.shipment_id,
      document_type: candidate.document_type,
      is_primary: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (!error.message.includes('duplicate')) {
        failed++;
      }
    } else {
      created++;
      byIdentifierType[candidate.identifier_type] = (byIdentifierType[candidate.identifier_type] || 0) + 1;
      byDocumentType[candidate.document_type] = (byDocumentType[candidate.document_type] || 0) + 1;
    }

    // Progress indicator
    if ((created + failed) % 50 === 0) {
      process.stdout.write(`   Progress: ${created + failed}/${finalCandidates.length}\r`);
    }
  }

  console.log('');
  console.log('');

  // Step 6: Summary
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('RESULTS:');
  console.log('─'.repeat(60));
  console.log(`   Links created:     ${created}`);
  console.log(`   Failed/Skipped:    ${failed}`);
  console.log('');

  console.log('BY IDENTIFIER TYPE:');
  console.log('─'.repeat(60));
  for (const [type, count] of Object.entries(byIdentifierType).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type.padEnd(25)} ${count}`);
  }
  console.log('');

  console.log('BY DOCUMENT TYPE (Top 10):');
  console.log('─'.repeat(60));
  const sortedDocTypes = Object.entries(byDocumentType).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [type, count] of sortedDocTypes) {
    console.log(`   ${type.padEnd(30)} ${count}`);
  }
  console.log('');

  // Verify final counts
  const { data: finalLinks } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const finalLinkedEmails = new Set(finalLinks?.map(l => l.email_id) || []);

  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('id', { count: 'exact', head: true });

  const linkRate = Math.round(finalLinkedEmails.size / (totalEmails || 1) * 100);

  console.log('FINAL STATUS:');
  console.log('─'.repeat(60));
  console.log(`   Total emails:      ${totalEmails}`);
  console.log(`   Linked emails:     ${finalLinkedEmails.size}`);
  console.log(`   Link rate:         ${linkRate}%`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

runBackfill().catch(console.error);
