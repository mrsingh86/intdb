/**
 * Fix Entity Source Document Types
 *
 * Updates source_document_type from 'unknown' to actual document type
 * based on the classification of the source email.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function fixEntitySources() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         FIX ENTITY SOURCE DOCUMENT TYPES                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all entities with unknown source
  const { data: unknownEntities, error } = await supabase
    .from('entity_extractions')
    .select('id, email_id, source_document_type')
    .or('source_document_type.is.null,source_document_type.eq.unknown');

  if (error || !unknownEntities) {
    console.error('Error fetching entities:', error);
    return;
  }

  console.log(`Found ${unknownEntities.length} entities with unknown source\n`);

  // Group by email_id for efficiency
  const emailIds = [...new Set(unknownEntities.map(e => e.email_id))];
  console.log(`From ${emailIds.length} unique emails\n`);

  let updatedCount = 0;

  for (const emailId of emailIds) {
    // Get classification for this email
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', emailId)
      .limit(1)
      .single();

    if (!classification) {
      console.log(`  ⚠️  No classification for email ${emailId.substring(0, 8)}...`);
      continue;
    }

    // Update all entities for this email
    const { error: updateError, count } = await supabase
      .from('entity_extractions')
      .update({ source_document_type: classification.document_type })
      .eq('email_id', emailId)
      .or('source_document_type.is.null,source_document_type.eq.unknown');

    if (!updateError) {
      updatedCount += count || 0;
      console.log(`  ✅ Email ${emailId.substring(0, 8)}... → ${classification.document_type}`);
    }
  }

  console.log(`\n✅ Updated ${updatedCount} entities\n`);

  // Show updated stats
  const { data: stats } = await supabase
    .from('entity_extractions')
    .select('source_document_type, entity_type');

  if (stats) {
    const bySource: Record<string, Record<string, number>> = {};
    stats.forEach(e => {
      const source = e.source_document_type || 'unknown';
      if (!bySource[source]) bySource[source] = {};
      bySource[source][e.entity_type] = (bySource[source][e.entity_type] || 0) + 1;
    });

    console.log('Updated Entity Distribution by Source:');
    for (const [source, types] of Object.entries(bySource)) {
      const cutoffs = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']
        .filter(t => types[t])
        .map(t => `${t}:${types[t]}`)
        .join(', ');
      if (cutoffs) {
        console.log(`  ${source}: ${cutoffs}`);
      }
    }
  }
}

fixEntitySources().catch(console.error);
