/**
 * Run Migration 006: Add Source Tracking
 * Adds source_document_type to entity_extractions for multi-source ETA/ETD conflict detection
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
  console.log('║                     MIGRATION 006: ADD SOURCE TRACKING                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '006_add_source_tracking.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log(`📄 Migration file: 006_add_source_tracking.sql`);
  console.log(`📊 SQL size: ${sql.length} characters\n`);

  console.log('This migration adds:');
  console.log('  - source_document_type column to entity_extractions');
  console.log('  - revision_type and revision_number columns to document_classifications');
  console.log('  - Cutoff date entity types (si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff)');
  console.log('  - v_multi_source_entities view for conflict detection\n');

  console.log('⚠️  Please run this migration manually in Supabase SQL Editor:');
  console.log('   1. Open Supabase Dashboard → SQL Editor → New Query');
  console.log('   2. Paste the migration SQL (already copied to clipboard)');
  console.log('   3. Click "Run"\n');
  console.log(`📂 File location: ${migrationPath}\n`);

  // Verify tables exist
  console.log('Verifying current state...\n');

  const { data: entityCheck, error: entityError } = await supabase
    .from('entity_extractions')
    .select('id')
    .limit(1);

  if (entityError) {
    console.log('❌ Could not verify entity_extractions table:', entityError.message);
  } else {
    console.log('✅ entity_extractions table exists');
  }

  const { data: classCheck, error: classError } = await supabase
    .from('document_classifications')
    .select('id')
    .limit(1);

  if (classError) {
    console.log('❌ Could not verify document_classifications table:', classError.message);
  } else {
    console.log('✅ document_classifications table exists');
  }

  console.log('\n' + '═'.repeat(100));
  console.log('NEXT STEPS');
  console.log('═'.repeat(100));
  console.log('\n1. Run the migration in Supabase SQL Editor');
  console.log('2. Run: npx tsx scripts/backfill-source-document-type.ts (to backfill existing data)');
  console.log('3. Run: npx tsx scripts/classify-all-74-emails.ts (to re-classify with new fields)\n');
}

runMigration().catch(console.error);
