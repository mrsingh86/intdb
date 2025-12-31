#!/usr/bin/env npx tsx
/**
 * Analyze Orphaned Emails
 *
 * Emails that have extractions but no shipment to link to
 * (because no booking_confirmation exists for their booking number)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyze() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('ORPHANED EMAILS ANALYSIS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all linked email IDs
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedIds = new Set(links?.map(l => l.email_id) || []);

  // Get all emails with classifications
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  // Find orphaned emails (classified but not linked)
  const orphanedByType: Record<string, string[]> = {};

  for (const c of classifications || []) {
    if (!linkedIds.has(c.email_id)) {
      if (!orphanedByType[c.document_type]) {
        orphanedByType[c.document_type] = [];
      }
      orphanedByType[c.document_type].push(c.email_id);
    }
  }

  const totalOrphaned = Object.values(orphanedByType).flat().length;

  console.log(`Total emails: ${classifications?.length}`);
  console.log(`Linked to shipments: ${linkedIds.size}`);
  console.log(`ORPHANED (not linked): ${totalOrphaned}`);
  console.log('');

  console.log('ORPHANED BY DOCUMENT TYPE:');
  console.log('─'.repeat(60));

  const sorted = Object.entries(orphanedByType).sort((a, b) => b[1].length - a[1].length);
  for (const [type, ids] of sorted) {
    console.log(`  ${type.padEnd(35)} ${ids.length}`);
  }

  // Check if orphaned emails have booking numbers that don't exist as shipments
  console.log('');
  console.log('ORPHANED EMAILS WITH BOOKING NUMBERS:');
  console.log('─'.repeat(60));

  // Get all booking numbers from entity_extractions for orphaned emails
  const orphanedIds = Object.values(orphanedByType).flat();

  const { data: orphanedEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', orphanedIds.slice(0, 500))
    .eq('entity_type', 'booking_number');

  // Get existing shipment booking numbers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number');

  const existingBookings = new Set(shipments?.map(s => s.booking_number).filter(Boolean));

  // Check which orphaned booking numbers don't have shipments
  const missingBookings = new Set<string>();
  const matchableBookings = new Set<string>();

  for (const e of orphanedEntities || []) {
    if (e.entity_value) {
      if (existingBookings.has(e.entity_value)) {
        matchableBookings.add(e.entity_value);
      } else {
        missingBookings.add(e.entity_value);
      }
    }
  }

  console.log(`  Orphaned emails with booking#: ${orphanedEntities?.length}`);
  console.log(`  Booking# that EXIST in shipments: ${matchableBookings.size} (should be linkable!)`);
  console.log(`  Booking# that DON'T exist: ${missingBookings.size} (need booking_confirmation)`);

  if (matchableBookings.size > 0) {
    console.log('');
    console.log('  ⚠️  ISSUE: These emails have booking numbers that exist in shipments');
    console.log('  but are not linked. The linking step may have failed.');
    console.log('');
    console.log('  Sample matchable booking numbers:');
    Array.from(matchableBookings).slice(0, 5).forEach(b => {
      console.log(`    - ${b}`);
    });
  }

  if (missingBookings.size > 0) {
    console.log('');
    console.log('  Booking numbers without shipments (need booking_confirmation):');
    Array.from(missingBookings).slice(0, 10).forEach(b => {
      console.log(`    - ${b}`);
    });
  }

  // Show what entities are being lost
  console.log('');
  console.log('ENTITIES IN ORPHANED EMAILS (data being lost):');
  console.log('─'.repeat(60));

  const { data: allOrphanedEntities } = await supabase
    .from('entity_extractions')
    .select('entity_type')
    .in('email_id', orphanedIds.slice(0, 1000));

  const entityCounts: Record<string, number> = {};
  for (const e of allOrphanedEntities || []) {
    entityCounts[e.entity_type] = (entityCounts[e.entity_type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(entityCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
