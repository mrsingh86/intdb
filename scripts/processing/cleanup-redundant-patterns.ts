/**
 * Cleanup Redundant Memory Patterns
 *
 * Removes patterns that duplicate system prompt and detection_patterns table.
 * Keeps only error patterns and learned context infrastructure.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  CLEANING UP REDUNDANT MEMORY PATTERNS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let totalDeleted = 0;

  // 1. Delete carrier patterns (redundant with system prompt)
  console.log('Deleting carrier patterns (redundant with system prompt)...');
  const { data: carrier } = await supabase
    .from('ai_memories')
    .delete()
    .like('scope_id', 'pattern-carrier-%')
    .select('id');
  console.log(`  ✓ Deleted ${carrier?.length || 0} carrier patterns`);
  totalDeleted += carrier?.length || 0;

  // 2. Delete field patterns (redundant with system prompt)
  console.log('Deleting field patterns (redundant with system prompt)...');
  const { data: field } = await supabase
    .from('ai_memories')
    .delete()
    .like('scope_id', 'pattern-field-%')
    .select('id');
  console.log(`  ✓ Deleted ${field?.length || 0} field patterns`);
  totalDeleted += field?.length || 0;

  // 3. Delete document type patterns (redundant with system prompt + detection_patterns)
  console.log('Deleting doctype patterns (redundant with detection_patterns table)...');
  const { data: doctype } = await supabase
    .from('ai_memories')
    .delete()
    .like('scope_id', 'pattern-doctype-%')
    .select('id');
  console.log(`  ✓ Deleted ${doctype?.length || 0} doctype patterns`);
  totalDeleted += doctype?.length || 0;

  // 4. Delete email patterns (redundant with system prompt rules)
  console.log('Deleting email patterns (redundant with system prompt)...');
  const { data: email } = await supabase
    .from('ai_memories')
    .delete()
    .like('scope_id', 'pattern-email-%')
    .select('id');
  console.log(`  ✓ Deleted ${email?.length || 0} email patterns`);
  totalDeleted += email?.length || 0;

  // 5. Delete customer patterns (not integrated yet)
  console.log('Deleting customer patterns (not integrated)...');
  const { data: customer } = await supabase
    .from('ai_memories')
    .delete()
    .like('scope_id', 'pattern-customer-%')
    .select('id');
  console.log(`  ✓ Deleted ${customer?.length || 0} customer patterns`);
  totalDeleted += customer?.length || 0;

  // Show what's kept
  console.log('\n' + '─'.repeat(60));
  console.log('KEPT (These add real value):');
  console.log('─'.repeat(60));

  const { data: errors } = await supabase
    .from('ai_memories')
    .select('scope_id, content')
    .like('scope_id', 'error-pattern-%');

  if (errors && errors.length > 0) {
    console.log(`\n✓ Error patterns (${errors.length}):`);
    for (const e of errors) {
      const title = e.content.split('\n')[0].substring(0, 50);
      console.log(`  - ${e.scope_id}: ${title}...`);
    }
  }

  // Show all remaining memories
  const { data: remaining } = await supabase
    .from('ai_memories')
    .select('scope, scope_id')
    .order('scope');

  console.log(`\n✓ All remaining memories (${remaining?.length || 0}):`);
  const byScope: Record<string, string[]> = {};
  for (const m of remaining || []) {
    if (!byScope[m.scope]) byScope[m.scope] = [];
    byScope[m.scope].push(m.scope_id);
  }
  for (const [scope, ids] of Object.entries(byScope)) {
    console.log(`  ${scope}: ${ids.length} memories`);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY:');
  console.log('═'.repeat(60));
  console.log(`  Deleted: ${totalDeleted} redundant patterns`);
  console.log(`  Kept:    ${remaining?.length || 0} memories`);
  console.log('\n  The memory layer now focuses on:');
  console.log('  1. Error patterns (pre-initialized, useful for AI warnings)');
  console.log('  2. Sender profiles (learned from processing)');
  console.log('  3. Shipment context (accumulated per booking)');
  console.log('  4. Thread context (cached per conversation)');
  console.log('═'.repeat(60));
}

cleanup().catch(console.error);
