import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jkvlggqkccozyouvipso.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprdmxnZ3FrY2NvenlvdXZpcHNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzM0OTU5MSwiZXhwIjoyMDc4OTI1NTkxfQ.tPe-CS4zRZSksZa_PAIOAsMOYLiNCT7eon3crO_LgKY';

async function runMigration() {
  console.log('=== RUNNING MIGRATION 003: FEEDBACK SYSTEM ===\n');

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  // Read migration file
  const migrationPath = join(process.cwd(), 'database/migrations/003_add_feedback_system.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf-8');

  console.log('Executing migration SQL...\n');

  try {
    // Since Supabase REST API doesn't support executing raw SQL directly,
    // we'll need to use a different approach. Let's check if tables exist first.

    console.log('Checking if tables already exist...\n');

    const { data: existingTables, error: checkError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', [
        'classification_feedback',
        'entity_feedback',
        'classification_rules',
        'feedback_applications',
        'feedback_impact_metrics'
      ]);

    if (existingTables && existingTables.length > 0) {
      console.log('⚠️  Some tables already exist:');
      existingTables.forEach(t => console.log(`  - ${t.table_name}`));
      console.log('\nMigration may have already been run. Skipping...\n');
      return;
    }

    console.log('ℹ️  Tables not found. Migration needs to be run.\n');
    console.log('📝 Migration SQL file location:');
    console.log(`   ${migrationPath}\n`);
    console.log('⚠️  Note: Supabase REST API does not support executing raw DDL SQL.\n');
    console.log('Please run this migration using one of these methods:\n');
    console.log('1. Supabase Dashboard:');
    console.log('   - Go to https://supabase.com/dashboard/project/jkvlggqkccozyouvipso/sql');
    console.log('   - Copy and paste the SQL from the migration file');
    console.log('   - Click "Run"\n');
    console.log('2. Direct PostgreSQL connection:');
    console.log('   - Install psql');
    console.log('   - Run: psql -h db.jkvlggqkccozyouvipso.supabase.co -U postgres -d postgres -f database/migrations/003_add_feedback_system.sql\n');
    console.log('3. Supabase CLI:');
    console.log('   - Run: npx supabase db push\n');

    console.log('📋 Copying migration SQL to clipboard for easy pasting...\n');

    // Print the SQL for easy copying
    console.log('='.repeat(80));
    console.log('MIGRATION SQL (copy this to Supabase SQL Editor):');
    console.log('='.repeat(80));
    console.log(migrationSQL);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

runMigration();
