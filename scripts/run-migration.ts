/**
 * Run Database Migration
 * Executes SQL migration files against Supabase
 */

import { supabase } from '../utils/supabase-client';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration(migrationFile: string) {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                   RUNNING DATABASE MIGRATION                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  const migrationPath = path.join(__dirname, '..', 'database', 'migrations', migrationFile);

  console.log(`📄 Migration file: ${migrationFile}`);
  console.log(`📂 Full path: ${migrationPath}\n`);

  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf-8');
  console.log(`📊 SQL size: ${sql.length} characters\n`);

  console.log('⏳ Executing migration...\n');

  try {
    // Split SQL by statement (rough split on semicolons, handling comments)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    let executed = 0;
    let failed = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments and empty statements
      if (!statement || statement.startsWith('--') || statement.length < 10) {
        continue;
      }

      // Extract operation type for logging
      const operationType = statement.split(' ')[0].toUpperCase();
      const tableName = extractTableName(statement);

      console.log(`[${i + 1}/${statements.length}] ${operationType} ${tableName}...`);

      try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

        if (error) {
          // Try direct execution as fallback
          const directResult = await executeDirect(statement);
          if (directResult.error) {
            console.error(`   ❌ Error: ${error.message}`);
            failed++;
          } else {
            console.log(`   ✅ Success (direct)`);
            executed++;
          }
        } else {
          console.log(`   ✅ Success`);
          executed++;
        }

      } catch (err: any) {
        console.error(`   ❌ Error: ${err.message}`);
        failed++;
      }
    }

    console.log('\n' + '═'.repeat(100));
    console.log('MIGRATION SUMMARY');
    console.log('═'.repeat(100));
    console.log(`Total statements:  ${statements.length}`);
    console.log(`Executed:          ${executed} ✅`);
    console.log(`Failed:            ${failed} ❌`);
    console.log('');

    if (failed === 0) {
      console.log('✅ Migration completed successfully!\n');
    } else {
      console.log(`⚠️  Migration completed with ${failed} errors\n`);
    }

  } catch (error: any) {
    console.error(`❌ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

async function executeDirect(sql: string): Promise<any> {
  // Supabase client doesn't support direct SQL execution
  // This is a placeholder - in production, use Supabase SQL Editor or pg client
  return { error: new Error('Direct execution not supported') };
}

function extractTableName(sql: string): string {
  // Extract table name from SQL statement
  const match = sql.match(/(?:TABLE|VIEW|INDEX)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(\w+)/i);
  return match ? match[1] : '';
}

// Run migration
const migrationFile = process.argv[2] || '002_add_thread_handling.sql';
runMigration(migrationFile).catch(console.error);
