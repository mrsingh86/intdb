#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Check if document_authority_rules table exists and has data
  const { data, error } = await supabase
    .from('document_authority_rules')
    .select('*')
    .order('authority_level');

  if (error) {
    console.log('ERROR:', error.message);
    console.log('');
    console.log('The document_authority_rules table may not exist.');
    return;
  }

  if (!data || data.length === 0) {
    console.log('NO AUTHORITY RULES FOUND');
    console.log('The table exists but has no data.');
    return;
  }

  console.log('DOCUMENT AUTHORITY RULES:');
  console.log('─'.repeat(80));
  console.log('');

  // Group by entity_type
  const byEntity: Record<string, any[]> = {};
  for (const rule of data) {
    if (!byEntity[rule.entity_type]) byEntity[rule.entity_type] = [];
    byEntity[rule.entity_type].push(rule);
  }

  for (const [entity, rules] of Object.entries(byEntity).sort()) {
    console.log(entity + ':');
    for (const r of rules as any[]) {
      const level = r.authority_level === 1 ? 'PRIMARY' : r.authority_level === 2 ? 'SECONDARY' : 'FALLBACK';
      console.log('  ' + level.padEnd(12) + r.document_type);
    }
    console.log('');
  }

  console.log('Total rules:', data?.length);
}

check().catch(console.error);
