/**
 * Backfill source_document_type for existing entity_extractions
 *
 * This script updates existing entity records with the source_document_type
 * from their associated document_classifications.
 */

import { supabase } from '../utils/supabase-client';

async function backfillSourceDocumentType() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              BACKFILL: Source Document Type for Entity Extractions                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all entities without source_document_type
  const { data: entities, error: fetchError } = await supabase
    .from('entity_extractions')
    .select('id, email_id, classification_id')
    .is('source_document_type', null);

  if (fetchError) {
    console.error('❌ Error fetching entities:', fetchError.message);
    return;
  }

  if (!entities || entities.length === 0) {
    console.log('✅ All entities already have source_document_type set!');
    return;
  }

  console.log(`📊 Found ${entities.length} entities without source_document_type\n`);

  // Get all classifications for lookup
  const classificationIds = [...new Set(entities.map(e => e.classification_id).filter(Boolean))];
  const emailIds = [...new Set(entities.map(e => e.email_id).filter(Boolean))];

  console.log(`📋 Fetching ${classificationIds.length} classifications...`);

  const { data: classifications, error: classError } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_type')
    .or(`id.in.(${classificationIds.join(',')}),email_id.in.(${emailIds.join(',')})`);

  if (classError) {
    console.error('❌ Error fetching classifications:', classError.message);
    return;
  }

  // Create lookup maps
  const classById = new Map(classifications?.map(c => [c.id, c.document_type]) || []);
  const classByEmailId = new Map(classifications?.map(c => [c.email_id, c.document_type]) || []);

  let updated = 0;
  let failed = 0;

  for (const entity of entities) {
    // Try to get document_type from classification_id first, then email_id
    let documentType = entity.classification_id
      ? classById.get(entity.classification_id)
      : classByEmailId.get(entity.email_id);

    if (!documentType) {
      console.log(`  ⚠️  No classification found for entity ${entity.id}`);
      failed++;
      continue;
    }

    const { error: updateError } = await supabase
      .from('entity_extractions')
      .update({ source_document_type: documentType })
      .eq('id', entity.id);

    if (updateError) {
      console.error(`  ❌ Failed to update entity ${entity.id}:`, updateError.message);
      failed++;
    } else {
      updated++;
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('BACKFILL COMPLETE');
  console.log('═'.repeat(100));
  console.log(`\n✅ Updated: ${updated}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`📊 Total:   ${entities.length}\n`);
}

backfillSourceDocumentType().catch(console.error);
