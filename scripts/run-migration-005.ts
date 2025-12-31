/**
 * Run Migration 005: Add Type Configurations
 * Executes SQL migration to create entity_type_config and document_type_config tables
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        MIGRATION 005: ADD TYPE CONFIGURATIONS                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '005_add_type_configurations.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log(`📄 Migration file: 005_add_type_configurations.sql`);
  console.log(`📊 SQL size: ${sql.length} characters\n`);

  try {
    // Execute the entire SQL file as one transaction
    const { data, error } = await supabase.rpc('exec', {
      sql: sql
    });

    if (error) {
      // If RPC doesn't work, try executing directly via REST API
      console.log('⏳ Executing via direct query...\n');

      // Split into individual statements and execute one by one
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => {
          // Filter out comments and empty lines
          return s.length > 0 &&
                 !s.startsWith('--') &&
                 !s.match(/^\/\*/) &&
                 s !== '$$' &&
                 !s.match(/^\s*COMMENT/);
        });

      let executed = 0;
      let failed = 0;

      for (const statement of statements) {
        if (!statement) continue;

        const operationType = statement.split(' ')[0].toUpperCase();
        console.log(`Executing: ${operationType}...`);

        try {
          // For CREATE TABLE statements
          if (statement.includes('CREATE TABLE')) {
            const tableName = statement.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/)?.[1];
            const { error: createError } = await supabase.rpc('execute_sql', { query: statement + ';' });

            if (createError) {
              // Try alternative: Use pgadmin/postgrest syntax
              console.log(`   ⚠️  RPC failed, using Supabase query...`);
              // Since Supabase client doesn't support raw SQL, we'll log this for manual execution
              console.log(`   ⚠️  Please execute this manually in Supabase SQL Editor:`);
              console.log(`   ${statement.substring(0, 100)}...`);
              failed++;
            } else {
              console.log(`   ✅ Created table: ${tableName}`);
              executed++;
            }
          }
        } catch (err: any) {
          console.error(`   ❌ Error: ${err.message}`);
          failed++;
        }
      }

      console.log('\n' + '═'.repeat(100));
      console.log('MIGRATION STATUS');
      console.log('═'.repeat(100));
      console.log(`\n⚠️  This migration requires manual execution in Supabase SQL Editor.`);
      console.log(`\n📋 Please copy the migration file content and paste it into:`);
      console.log(`   Supabase Dashboard → SQL Editor → New Query\n`);
      console.log(`📂 File location: ${migrationPath}\n`);
      return;
    }

    console.log('✅ Migration completed successfully!\n');

  } catch (error: any) {
    console.error(`❌ Fatal error: ${error.message}`);
    console.log(`\n⚠️  Please run this migration manually in Supabase SQL Editor.`);
    console.log(`📂 File location: ${migrationPath}\n`);
    process.exit(1);
  }
}

runMigration().catch(console.error);
