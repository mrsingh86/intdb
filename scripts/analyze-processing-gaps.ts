#!/usr/bin/env npx tsx
/**
 * Analyze Processing Pipeline Gaps
 *
 * Shows exactly where emails are stuck in the pipeline and what's missing.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyze() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('EMAIL PROCESSING PIPELINE ANALYSIS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Total emails by processing_status
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, processing_status');

  const byStatus: Record<string, number> = {};
  const emailIds = new Set<string>();
  for (const e of emails || []) {
    emailIds.add(e.id);
    byStatus[e.processing_status || 'null'] = (byStatus[e.processing_status || 'null'] || 0) + 1;
  }

  console.log('PROCESSING STATUS DISTRIBUTION:');
  console.log('─'.repeat(50));
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(count / (emails?.length || 1) * 100);
    console.log(`  ${status.padEnd(20)} ${String(count).padStart(5)} (${pct}%)`);
  }
  console.log('');

  // 2. Emails with classifications
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id');

  const classifiedIds = new Set(classifications?.map(c => c.email_id) || []);
  console.log('PIPELINE STEP COVERAGE:');
  console.log('─'.repeat(50));
  console.log(`  Total emails:                  ${emails?.length}`);
  console.log(`  With classification (step 2):  ${classifiedIds.size}`);

  // 3. Emails with entity extractions
  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .limit(10000);

  const extractedIds = new Set(extractions?.map(e => e.email_id) || []);
  console.log(`  With extractions (step 3):     ${extractedIds.size}`);

  // 4. Emails linked to shipments
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedIds = new Set(links?.map(l => l.email_id) || []);
  console.log(`  Linked to shipment (step 4):   ${linkedIds.size}`);

  // 5. Find what's missing at each step
  console.log('');
  console.log('GAP ANALYSIS:');
  console.log('─'.repeat(50));

  // Emails classified but not extracted
  let classifiedNotExtracted = 0;
  for (const id of classifiedIds) {
    if (!extractedIds.has(id)) classifiedNotExtracted++;
  }
  console.log(`  Classified but NOT extracted:  ${classifiedNotExtracted}`);

  // Emails extracted but not linked
  let extractedNotLinked = 0;
  for (const id of extractedIds) {
    if (!linkedIds.has(id)) extractedNotLinked++;
  }
  console.log(`  Extracted but NOT linked:      ${extractedNotLinked}`);

  // Check why extracted emails aren't linked - do they have identifiers?
  console.log('');
  console.log('UNLINKED EMAILS WITH EXTRACTIONS - IDENTIFIER CHECK:');
  console.log('─'.repeat(60));

  // Get all entities for unlinked emails
  const unlinkedExtracted: string[] = [];
  for (const id of extractedIds) {
    if (!linkedIds.has(id)) unlinkedExtracted.push(id);
  }

  const { data: unlinkedEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', unlinkedExtracted.slice(0, 500));

  // Group by email and check for identifiers
  const entitiesByEmail = new Map<string, Set<string>>();
  for (const e of unlinkedEntities || []) {
    if (!entitiesByEmail.has(e.email_id)) {
      entitiesByEmail.set(e.email_id, new Set());
    }
    entitiesByEmail.get(e.email_id)!.add(e.entity_type);
  }

  let hasBooking = 0;
  let hasBl = 0;
  let hasContainer = 0;
  let hasNoIdentifier = 0;

  for (const [emailId, types] of entitiesByEmail) {
    const hasAny = types.has('booking_number') || types.has('bl_number') ||
      types.has('container_number') || types.has('container_numbers');

    if (types.has('booking_number')) hasBooking++;
    if (types.has('bl_number')) hasBl++;
    if (types.has('container_number') || types.has('container_numbers')) hasContainer++;
    if (!hasAny) hasNoIdentifier++;
  }

  console.log(`  Has booking_number:            ${hasBooking}`);
  console.log(`  Has bl_number:                 ${hasBl}`);
  console.log(`  Has container_number:          ${hasContainer}`);
  console.log(`  Has NO identifier (can't link): ${hasNoIdentifier}`);

  // 6. Check the 57 that had identifiers but no matching shipment
  console.log('');
  console.log('EMAILS WITH IDENTIFIERS BUT NO MATCHING SHIPMENT:');
  console.log('─'.repeat(60));
  console.log('(These need NEW shipments created, not just linking)');
  console.log('');

  // Get unique booking numbers from unlinked emails
  const { data: unlinkedBookings } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number')
    .in('email_id', unlinkedExtracted);

  // Get all existing shipment booking numbers
  const { data: existingShipments } = await supabase
    .from('shipments')
    .select('booking_number');

  const existingBookings = new Set(existingShipments?.map(s => s.booking_number) || []);

  // Find booking numbers that don't exist
  const newBookingsNeeded = new Set<string>();
  for (const e of unlinkedBookings || []) {
    if (e.entity_value && !existingBookings.has(e.entity_value)) {
      newBookingsNeeded.add(e.entity_value);
    }
  }

  console.log(`  Unique booking numbers in unlinked emails: ${unlinkedBookings?.length}`);
  console.log(`  Booking numbers WITHOUT existing shipment: ${newBookingsNeeded.size}`);
  console.log('');

  if (newBookingsNeeded.size > 0) {
    console.log('  Sample booking numbers needing NEW shipments:');
    const samples = Array.from(newBookingsNeeded).slice(0, 10);
    for (const booking of samples) {
      console.log(`    - ${booking}`);
    }
  }

  // 7. Show document types for unlinked emails
  console.log('');
  console.log('UNLINKED EMAILS BY DOCUMENT TYPE:');
  console.log('─'.repeat(60));

  const { data: unlinkedClassifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', unlinkedExtracted);

  const byDocType: Record<string, number> = {};
  for (const c of unlinkedClassifications || []) {
    byDocType[c.document_type] = (byDocType[c.document_type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(byDocType).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${type.padEnd(35)} ${count}`);
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
