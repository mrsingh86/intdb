#!/usr/bin/env npx tsx
/**
 * Fix Confidence Scores
 *
 * Updates all shipment_documents that have null link_confidence_score
 * with calculated values based on the identifier type used for linking.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function fixConfidenceScores() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    FIXING CONFIDENCE SCORES');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Get all links with null confidence
  console.log('1. Loading links to update...');

  let allLinks: any[] = [];
  let offset = 0;

  while (true) {
    const { data: links } = await supabase
      .from('shipment_documents')
      .select('id, email_id, shipment_id, document_type')
      .is('link_confidence_score', null)
      .range(offset, offset + 999);

    if (!links || links.length === 0) break;
    allLinks = allLinks.concat(links);
    offset += 1000;
    if (links.length < 1000) break;
  }

  console.log(`   Found ${allLinks.length} links with null confidence`);

  if (allLinks.length === 0) {
    console.log('   Nothing to update!');
    return;
  }

  // Step 2: Get ALL entity extractions with linkable types
  console.log('');
  console.log('2. Loading all entity extractions...');

  const emailIdentifiers = new Map<string, { type: string; value: string }>();
  let entityOffset = 0;

  // Load ALL entity_extractions with linkable types
  while (true) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('entity_type', ['booking_number', 'bl_number', 'container_number'])
      .range(entityOffset, entityOffset + 999);

    if (!entities || entities.length === 0) break;

    for (const e of entities) {
      const existing = emailIdentifiers.get(e.email_id);
      // Priority: booking_number > bl_number > container_number
      if (!existing ||
          (e.entity_type === 'booking_number') ||
          (e.entity_type === 'bl_number' && existing.type !== 'booking_number')) {
        emailIdentifiers.set(e.email_id, { type: e.entity_type, value: e.entity_value });
      }
    }

    entityOffset += 1000;
    if (entities.length < 1000) break;
    process.stdout.write(`   Loaded ${entityOffset} entities...\r`);
  }

  console.log(`   Found identifiers for ${emailIdentifiers.size} unique emails`);

  // Step 3: Update confidence scores
  console.log('');
  console.log('3. Updating confidence scores...');

  let updated = 0;
  let skipped = 0;
  const byConfidence: Record<number, number> = {};
  const byIdentifier: Record<string, number> = { booking_number: 0, bl_number: 0, container_number: 0, unknown: 0 };

  for (const link of allLinks) {
    const identifier = emailIdentifiers.get(link.email_id);

    // Calculate confidence based on identifier type
    let confidence = 70; // Default for unknown
    let identifierType = 'unknown';

    if (identifier) {
      identifierType = identifier.type;
      if (identifier.type === 'booking_number') {
        confidence = 95;
      } else if (identifier.type === 'bl_number') {
        confidence = 90;
      } else if (identifier.type === 'container_number') {
        confidence = 75;
      }
    }

    // Update the record
    const { error } = await supabase
      .from('shipment_documents')
      .update({
        link_confidence_score: confidence,
        link_method: identifier ? 'entity_match' : 'ai'
      })
      .eq('id', link.id);

    if (error) {
      skipped++;
    } else {
      updated++;
      byConfidence[confidence] = (byConfidence[confidence] || 0) + 1;
      byIdentifier[identifierType]++;
    }

    // Progress
    if ((updated + skipped) % 200 === 0) {
      process.stdout.write(`   Progress: ${updated + skipped}/${allLinks.length}\r`);
    }
  }

  console.log('');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              DONE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('RESULTS:');
  console.log('─'.repeat(60));
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log('');
  console.log('BY CONFIDENCE SCORE:');
  console.log('─'.repeat(60));
  for (const [score, count] of Object.entries(byConfidence).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    console.log(`   ${score}%: ${count}`);
  }
  console.log('');
  console.log('BY IDENTIFIER TYPE:');
  console.log('─'.repeat(60));
  for (const [type, count] of Object.entries(byIdentifier).sort((a, b) => b[1] - a[1])) {
    if (count > 0) console.log(`   ${type.padEnd(20)}: ${count}`);
  }
  console.log('');
}

fixConfidenceScores().catch(console.error);
