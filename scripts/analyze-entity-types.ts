#!/usr/bin/env npx tsx
/**
 * Analyze Entity Types in Database
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyzeEntityTypes() {
  console.log('Fetching all entity extractions...');

  // Get all entities (may need pagination for large datasets)
  const allEntities: Array<{ entity_type: string }> = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error:', error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allEntities.push(...data);
    offset += limit;

    if (data.length < limit) break;
  }

  console.log(`Total entities: ${allEntities.length}`);
  console.log('');

  // Count by type
  const counts: Record<string, number> = {};
  for (const e of allEntities) {
    counts[e.entity_type] = (counts[e.entity_type] || 0) + 1;
  }

  console.log('Entity type counts:');
  console.log('─'.repeat(50));

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    const pct = Math.round(count / allEntities.length * 100);
    console.log(`  ${type.padEnd(30)} ${String(count).padStart(5)} (${pct}%)`);
  }
}

analyzeEntityTypes().catch(console.error);
