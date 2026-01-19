#!/usr/bin/env npx tsx
/**
 * Analyze the first 100 emails (oldest) to understand linking gaps
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyze() {
  // Get emails ordered by received_at (oldest first - same as extraction)
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, received_at, processing_status')
    .order('received_at', { ascending: true })
    .limit(100);

  // Get linked email IDs
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id, document_type');

  const linkedMap = new Map<string, any>();
  for (const link of links || []) {
    linkedMap.set(link.email_id, link);
  }

  // Analyze each email
  let linked = 0;
  let unlinked = 0;
  const unlinkedEmails: any[] = [];

  for (const email of emails || []) {
    if (linkedMap.has(email.id)) {
      linked++;
    } else {
      unlinked++;

      // Get classification
      const { data: classification } = await supabase
        .from('document_classifications')
        .select('document_type, confidence_score')
        .eq('email_id', email.id)
        .single();

      // Get entity extractions
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', email.id);

      const bookingNum = entities?.find(e => e.entity_type === 'booking_number')?.entity_value;
      const blNum = entities?.find(e => e.entity_type === 'bl_number')?.entity_value;
      const containerNum = entities?.find(e => e.entity_type === 'container_number')?.entity_value;

      let reason: string;
      if (!classification) {
        reason = 'No classification';
      } else if (!entities || entities.length === 0) {
        reason = 'No entities extracted';
      } else if (!bookingNum && !blNum && !containerNum) {
        reason = 'No identifiers extracted';
      } else {
        reason = 'No matching shipment found';
      }

      unlinkedEmails.push({
        subject: (email.subject || '').substring(0, 50),
        docType: classification?.document_type || 'NOT_CLASSIFIED',
        hasEntities: (entities?.length || 0) > 0,
        entityCount: entities?.length || 0,
        bookingNum,
        blNum,
        containerNum,
        reason
      });
    }
  }

  console.log('ANALYSIS OF FIRST 100 EMAILS (oldest first):');
  console.log('═'.repeat(70));
  console.log('');
  console.log('SUMMARY:');
  console.log('  Linked to shipments:', linked);
  console.log('  NOT linked:', unlinked);
  console.log('');

  // Group by reason
  const byReason: Record<string, number> = {};
  for (const e of unlinkedEmails) {
    byReason[e.reason] = (byReason[e.reason] || 0) + 1;
  }

  console.log('UNLINKED BY REASON:');
  console.log('─'.repeat(50));
  for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + reason + ': ' + count);
  }

  // Group by document type
  const byDocType: Record<string, number> = {};
  for (const e of unlinkedEmails) {
    byDocType[e.docType] = (byDocType[e.docType] || 0) + 1;
  }

  console.log('');
  console.log('UNLINKED BY DOCUMENT TYPE:');
  console.log('─'.repeat(50));
  for (const [docType, count] of Object.entries(byDocType).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + docType.padEnd(30) + count);
  }

  console.log('');
  console.log('SAMPLE UNLINKED EMAILS (first 15):');
  console.log('─'.repeat(70));

  for (const e of unlinkedEmails.slice(0, 15)) {
    console.log('');
    console.log('  Subject: ' + e.subject);
    console.log('  DocType: ' + e.docType);
    console.log('  Reason:  ' + e.reason);
    console.log('  Entities: ' + e.entityCount);
    if (e.bookingNum) console.log('  Booking#: ' + e.bookingNum);
    if (e.blNum) console.log('  BL#: ' + e.blNum);
    if (e.containerNum) console.log('  Container#: ' + e.containerNum);
  }

  // For "No matching shipment" cases, check if shipment exists
  console.log('');
  console.log('═'.repeat(70));
  console.log('DEEP DIVE: Emails with identifiers but no matching shipment');
  console.log('═'.repeat(70));

  const noMatchEmails = unlinkedEmails.filter(e => e.reason === 'No matching shipment found');

  for (const e of noMatchEmails.slice(0, 10)) {
    console.log('');
    console.log('Subject: ' + e.subject);
    console.log('DocType: ' + e.docType);

    // Check if shipment exists with this booking number
    if (e.bookingNum) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, booking_number')
        .eq('booking_number', e.bookingNum)
        .maybeSingle();

      if (shipment) {
        console.log('  Booking# ' + e.bookingNum + ' → SHIPMENT EXISTS: ' + shipment.id.substring(0, 8));
        console.log('  ⚠️ BUG: Should have been linked!');
      } else {
        console.log('  Booking# ' + e.bookingNum + ' → No shipment (needs booking_confirmation first)');
      }
    }

    if (e.blNum) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, bl_number')
        .eq('bl_number', e.blNum)
        .maybeSingle();

      if (shipment) {
        console.log('  BL# ' + e.blNum + ' → SHIPMENT EXISTS: ' + shipment.id.substring(0, 8));
        console.log('  ⚠️ BUG: Should have been linked!');
      } else {
        console.log('  BL# ' + e.blNum + ' → No shipment');
      }
    }

    if (e.containerNum) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, container_number_primary')
        .eq('container_number_primary', e.containerNum)
        .maybeSingle();

      if (shipment) {
        console.log('  Container# ' + e.containerNum + ' → SHIPMENT EXISTS: ' + shipment.id.substring(0, 8));
      } else {
        console.log('  Container# ' + e.containerNum + ' → No shipment');
      }
    }
  }
}

analyze().catch(console.error);
