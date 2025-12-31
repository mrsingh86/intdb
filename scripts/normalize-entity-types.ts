/**
 * Normalize Entity Types
 *
 * Standardizes entity type names for consistency:
 * - estimated_departure_date → etd
 * - estimated_arrival_date → eta
 * - etc.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

const ENTITY_TYPE_MAPPING: Record<string, string> = {
  'estimated_departure_date': 'etd',
  'estimated_arrival_date': 'eta',
  'departure_date': 'etd',
  'arrival_date': 'eta',
  'port_of_load': 'port_of_loading',
  'pol': 'port_of_loading',
  'port_of_discharge': 'port_of_discharge',
  'pod': 'port_of_discharge',
  'bl': 'bl_number',
  'booking': 'booking_number',
  'container': 'container_number',
  'vessel': 'vessel_name',
  'voyage': 'voyage_number',
};

async function normalizeEntityTypes() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         NORMALIZE ENTITY TYPES                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get current entity type distribution
  const { data: entityCounts } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  if (!entityCounts) {
    console.error('Failed to fetch entities');
    return;
  }

  // Count by type
  const typeCounts: Record<string, number> = {};
  entityCounts.forEach(e => {
    typeCounts[e.entity_type] = (typeCounts[e.entity_type] || 0) + 1;
  });

  console.log('Current Entity Type Distribution:');
  console.log('─'.repeat(50));
  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const needsNorm = ENTITY_TYPE_MAPPING[type] ? ` → ${ENTITY_TYPE_MAPPING[type]}` : '';
      console.log(`  ${type.padEnd(30)} ${String(count).padStart(4)}${needsNorm}`);
    });

  console.log('\nApplying Normalizations...');

  let totalUpdated = 0;

  for (const [oldType, newType] of Object.entries(ENTITY_TYPE_MAPPING)) {
    const { data: updated, error } = await supabase
      .from('entity_extractions')
      .update({ entity_type: newType })
      .eq('entity_type', oldType)
      .select('id');

    if (!error && updated && updated.length > 0) {
      console.log(`  ✅ ${oldType} → ${newType}: ${updated.length} records`);
      totalUpdated += updated.length;
    }
  }

  console.log(`\n✅ Total entities normalized: ${totalUpdated}`);

  // Show updated distribution
  const { data: newCounts } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  if (newCounts) {
    const newTypeCounts: Record<string, number> = {};
    newCounts.forEach(e => {
      newTypeCounts[e.entity_type] = (newTypeCounts[e.entity_type] || 0) + 1;
    });

    console.log('\nUpdated Entity Type Distribution:');
    console.log('─'.repeat(50));
    Object.entries(newTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type.padEnd(30)} ${String(count).padStart(4)}`);
      });
  }

  console.log('\n🎉 Done! Run shipment resync to update shipments.\n');
}

normalizeEntityTypes().catch(console.error);
