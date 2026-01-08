/**
 * Backfill Thread Summaries
 *
 * Computes thread authority for all existing threads and optionally
 * repairs cross-linked documents.
 *
 * Usage:
 *   npx tsx scripts/backfill-thread-summaries.ts              # Dry run
 *   npx tsx scripts/backfill-thread-summaries.ts --execute    # Execute backfill
 *   npx tsx scripts/backfill-thread-summaries.ts --repair     # Also repair cross-links
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DRY_RUN = !process.argv.includes('--execute');
const REPAIR_CROSS_LINKS = process.argv.includes('--repair');

// Identifier priority (higher = better for linking)
const IDENTIFIER_PRIORITY: Record<string, number> = {
  booking_number: 100,
  bl_number: 90,
  container_number: 80,
  reference_number: 50,
};

interface ThreadAuthority {
  thread_id: string;
  authority_email_id: string;
  primary_identifier_type: string;
  primary_identifier_value: string;
  received_at: string;
  subject: string;
  confidence_score: number;
}

async function main() {
  console.log('BACKFILL: Thread Summaries');
  console.log('='.repeat(70));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('Repair cross-links:', REPAIR_CROSS_LINKS ? 'YES' : 'NO (use --repair to enable)');
  console.log('');

  // Step 1: Get all unique threads
  console.log('Step 1: Finding all threads...');
  const { data: threads } = await supabase
    .from('raw_emails')
    .select('thread_id')
    .not('thread_id', 'is', null)
    .order('thread_id');

  const uniqueThreadIds = [...new Set(threads?.map(t => t.thread_id) || [])];
  console.log(`  Found ${uniqueThreadIds.length} unique threads`);

  // Step 2: Check existing summaries
  const { data: existingSummaries } = await supabase
    .from('email_thread_summaries')
    .select('thread_id');

  const existingThreadIds = new Set(existingSummaries?.map(s => s.thread_id) || []);
  const threadsToProcess = uniqueThreadIds.filter(id => !existingThreadIds.has(id));

  console.log(`  Already have summaries: ${existingThreadIds.size}`);
  console.log(`  Need to process: ${threadsToProcess.length}`);
  console.log('');

  // Step 3: Compute authorities
  console.log('Step 2: Computing thread authorities...');
  const authorities: ThreadAuthority[] = [];
  let processed = 0;
  let noIdentifier = 0;

  for (const threadId of threadsToProcess) {
    const authority = await computeThreadAuthority(threadId);
    if (authority) {
      authorities.push(authority);
    } else {
      noIdentifier++;
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`  Processed ${processed}/${threadsToProcess.length}...`);
    }
  }

  console.log(`  Computed ${authorities.length} authorities`);
  console.log(`  Threads with no identifier: ${noIdentifier}`);
  console.log('');

  // Step 4: Show sample
  console.log('Step 3: Sample authorities (first 10):');
  for (const auth of authorities.slice(0, 10)) {
    console.log(`  ${auth.primary_identifier_type}: ${auth.primary_identifier_value}`);
    console.log(`    Subject: ${auth.subject?.substring(0, 50)}...`);
  }
  console.log('');

  // Step 5: Insert authorities
  if (!DRY_RUN && authorities.length > 0) {
    console.log('Step 4: Inserting thread summaries...');

    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < authorities.length; i += batchSize) {
      const batch = authorities.slice(i, i + batchSize).map(a => ({
        thread_id: a.thread_id,
        authority_email_id: a.authority_email_id,
        primary_identifier_type: a.primary_identifier_type,
        primary_identifier_value: a.primary_identifier_value,
        received_at: a.received_at,
        subject: a.subject,
        confidence_score: a.confidence_score,
      }));

      const { error } = await supabase
        .from('email_thread_summaries')
        .upsert(batch, { onConflict: 'thread_id' });

      if (error) {
        console.error(`  Error inserting batch: ${error.message}`);
      } else {
        inserted += batch.length;
        console.log(`  Inserted ${inserted}/${authorities.length}`);
      }
    }
  }

  // Step 6: Repair cross-links
  if (REPAIR_CROSS_LINKS) {
    console.log('');
    console.log('Step 5: Checking for cross-linked documents...');
    await repairCrossLinks(DRY_RUN);
  }

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY:');
  console.log(`  Threads processed: ${threadsToProcess.length}`);
  console.log(`  Authorities computed: ${authorities.length}`);
  console.log(`  Threads without identifier: ${noIdentifier}`);
  if (DRY_RUN) {
    console.log('');
    console.log('DRY RUN - No changes made. Run with --execute to apply.');
  }
}

async function computeThreadAuthority(threadId: string): Promise<ThreadAuthority | null> {
  // Get thread emails sorted by: original first, then by date
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, thread_id, is_response, received_at, subject')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (!emails || emails.length === 0) return null;

  // Sort: originals first, then by date
  const sorted = [...emails].sort((a, b) => {
    if ((a.is_response || false) !== (b.is_response || false)) {
      return (a.is_response || false) ? 1 : -1;
    }
    return (a.received_at || '').localeCompare(b.received_at || '');
  });

  // Get extractions for all thread emails
  const emailIds = sorted.map(e => e.id);

  // Check NEW extraction tables first
  const { data: emailExtractions } = await supabase
    .from('email_extractions')
    .select('email_id, entity_type, entity_value, confidence_score')
    .in('email_id', emailIds)
    .in('entity_type', ['booking_number', 'bl_number', 'container_number', 'reference_number'])
    .eq('is_valid', true);

  const { data: docExtractions } = await supabase
    .from('document_extractions')
    .select('email_id, entity_type, entity_value, confidence_score')
    .in('email_id', emailIds)
    .in('entity_type', ['booking_number', 'bl_number', 'container_number', 'reference_number'])
    .eq('is_valid', true);

  // ALSO check OLD entity_extractions table (has bulk of data)
  const { data: oldExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value, confidence_score')
    .in('email_id', emailIds)
    .in('entity_type', ['booking_number', 'bl_number', 'container_number', 'reference_number']);

  const allExtractions = [
    ...(emailExtractions || []),
    ...(docExtractions || []),
    ...(oldExtractions || []),
  ];

  // Group by email
  const extractionsByEmail = new Map<string, typeof allExtractions>();
  for (const ext of allExtractions) {
    const existing = extractionsByEmail.get(ext.email_id) || [];
    existing.push(ext);
    extractionsByEmail.set(ext.email_id, existing);
  }

  // Find first email with identifier
  for (const email of sorted) {
    const exts = extractionsByEmail.get(email.id) || [];
    if (exts.length === 0) continue;

    // Sort by priority then confidence
    const sortedExts = [...exts].sort((a, b) => {
      const priorityA = IDENTIFIER_PRIORITY[a.entity_type] || 0;
      const priorityB = IDENTIFIER_PRIORITY[b.entity_type] || 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      return b.confidence_score - a.confidence_score;
    });

    const best = sortedExts[0];
    if (best) {
      return {
        thread_id: threadId,
        authority_email_id: email.id,
        primary_identifier_type: best.entity_type,
        primary_identifier_value: best.entity_value,
        received_at: email.received_at,
        subject: email.subject || '',
        confidence_score: best.confidence_score,
      };
    }
  }

  return null;
}

async function repairCrossLinks(dryRun: boolean) {
  // Get reply emails that are linked to shipments
  const { data: linkedReplies } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      email_id,
      shipment_id,
      document_type,
      shipments(booking_number),
      raw_emails!inner(thread_id, is_response, subject)
    `)
    .eq('raw_emails.is_response', true)
    .not('raw_emails.thread_id', 'is', null)
    .limit(500);

  if (!linkedReplies || linkedReplies.length === 0) {
    console.log('  No reply emails linked to shipments found');
    return;
  }

  console.log(`  Checking ${linkedReplies.length} linked reply emails...`);

  let crossLinksFound = 0;
  let repaired = 0;
  const repairs: Array<{
    email_subject: string;
    old_booking: string;
    new_booking: string;
  }> = [];

  for (const doc of linkedReplies) {
    const email = (doc as any).raw_emails;
    const currentShipment = (doc as any).shipments;

    // Get thread authority
    const { data: authority } = await supabase
      .from('email_thread_summaries')
      .select('*')
      .eq('thread_id', email.thread_id)
      .single();

    if (!authority) continue;

    // Find correct shipment based on authority
    let correctShipmentId: string | null = null;

    if (authority.primary_identifier_type === 'booking_number') {
      const { data: ship } = await supabase
        .from('shipments')
        .select('id, booking_number')
        .eq('booking_number', authority.primary_identifier_value)
        .single();
      if (ship) correctShipmentId = ship.id;
    } else if (authority.primary_identifier_type === 'bl_number') {
      const { data: ship } = await supabase
        .from('shipments')
        .select('id, booking_number')
        .eq('mbl_number', authority.primary_identifier_value.toUpperCase())
        .single();
      if (ship) correctShipmentId = ship.id;
    }

    if (!correctShipmentId) continue;

    // Check if cross-linked
    if (correctShipmentId !== doc.shipment_id) {
      crossLinksFound++;

      // Get correct shipment booking number for logging
      const { data: correctShip } = await supabase
        .from('shipments')
        .select('booking_number')
        .eq('id', correctShipmentId)
        .single();

      repairs.push({
        email_subject: email.subject?.substring(0, 40) || 'N/A',
        old_booking: currentShipment?.booking_number || 'unknown',
        new_booking: correctShip?.booking_number || authority.primary_identifier_value,
      });

      if (!dryRun) {
        // Delete old link
        await supabase
          .from('shipment_documents')
          .delete()
          .eq('id', doc.id);

        // Create correct link
        await supabase
          .from('shipment_documents')
          .insert({
            email_id: doc.email_id,
            shipment_id: correctShipmentId,
            document_type: doc.document_type,
            link_source: 'migration',
            link_identifier_type: authority.primary_identifier_type,
            link_identifier_value: authority.primary_identifier_value,
          });

        repaired++;
      }
    }
  }

  console.log(`  Cross-links found: ${crossLinksFound}`);
  if (repairs.length > 0) {
    console.log('');
    console.log('  Cross-link repairs (first 10):');
    for (const r of repairs.slice(0, 10)) {
      console.log(`    ${r.email_subject}...`);
      console.log(`      ${r.old_booking} → ${r.new_booking}`);
    }
  }

  if (!dryRun) {
    console.log(`  Repaired: ${repaired}`);
  }
}

main().catch(console.error);
