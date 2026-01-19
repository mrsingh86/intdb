/**
 * Migration Runner: 009-014 (Document Hierarchy System)
 *
 * Runs all migrations for the document-hierarchy based intelligence system.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const MIGRATIONS = [
  '009_add_document_authority.sql',
  '010_add_workflow_states.sql',
  '011_add_si_reconciliation.sql',
  '012_add_milestones.sql',
  '013_add_extraction_prompts.sql',
  '014_add_shipment_extended_columns.sql',
];

async function runMigration(filename: string): Promise<{ success: boolean; error?: string }> {
  const filePath = path.join(__dirname, '..', 'database', 'migrations', filename);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const sql = fs.readFileSync(filePath, 'utf-8');

  // Split by semicolons but handle edge cases
  const statements = sql
    .split(/;(?=\s*(?:--|CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|COMMENT|$))/i)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`  Found ${statements.length} statements`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt || stmt.startsWith('--')) continue;

    try {
      const { error } = await supabase.rpc('exec_sql', { sql_query: stmt });
      if (error) {
        // Try direct execution for DDL statements
        const { error: directError } = await supabase.from('_migrations_temp').select().limit(0);
        if (directError && !directError.message.includes('does not exist')) {
          console.log(`    Statement ${i + 1}: Warning - ${error.message.substring(0, 50)}...`);
        }
      }
    } catch (e: any) {
      // Many DDL operations don't have direct Supabase client support
      // We'll need to use the SQL editor or psql
      console.log(`    Statement ${i + 1}: Needs manual execution`);
    }
  }

  return { success: true };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Document Hierarchy System - Migration Runner');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Database: ${supabaseUrl}`);
  console.log('');

  // Note: Supabase JS client can't run raw DDL
  // We need to output the SQL for manual execution
  console.log('⚠️  Supabase JS client cannot run DDL statements directly.');
  console.log('   Please run these migrations via:');
  console.log('   1. Supabase Dashboard → SQL Editor');
  console.log('   2. Or psql command line');
  console.log('');
  console.log('   Concatenating all migrations for easy copy/paste...');
  console.log('');

  let allSql = '';

  for (const migration of MIGRATIONS) {
    const filePath = path.join(__dirname, '..', 'database', 'migrations', migration);

    if (!fs.existsSync(filePath)) {
      console.log(`❌ ${migration}: File not found`);
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf-8');
    allSql += `-- ════════════════════════════════════════════════════════════\n`;
    allSql += `-- MIGRATION: ${migration}\n`;
    allSql += `-- ════════════════════════════════════════════════════════════\n\n`;
    allSql += sql;
    allSql += '\n\n';

    console.log(`✓ ${migration}: Loaded`);
  }

  // Write combined SQL to a temp file for easy access
  const outputPath = path.join(__dirname, '..', 'database', 'migrations', 'COMBINED_009-014.sql');
  fs.writeFileSync(outputPath, allSql);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Combined SQL written to: ${outputPath}`);
  console.log('  Copy this file content to Supabase SQL Editor and run it.');
  console.log('═══════════════════════════════════════════════════════════');

  // Also output to stdout for piping
  console.log('\n\n--- COMBINED SQL OUTPUT ---\n');
  console.log(allSql);
}

main().catch(console.error);
