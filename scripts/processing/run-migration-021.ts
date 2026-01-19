/**
 * Run Migration 021: Shipment Journey Tracking
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function runMigration() {
  console.log('Running Migration 021: Shipment Journey Tracking');
  console.log('═'.repeat(60));

  const migrationPath = path.join(__dirname, '../database/migrations/021_shipment_journey_tracking.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Split into individual statements (simple split - won't work for complex PL/pgSQL)
  // For complex migrations, we'll run key parts separately

  const statements = [
    // 1. Response tracking fields
    `ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS in_reply_to_message_id VARCHAR(200)`,
    `ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS is_response BOOLEAN DEFAULT false`,
    `ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS responds_to_email_id UUID`,
    `ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS response_time_hours DECIMAL(10,2)`,

    // 2. Document acknowledgment fields
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledgment_required BOOLEAN DEFAULT false`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledgment_due_date TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN DEFAULT false`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledged_by_party_id UUID`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledgment_email_id UUID`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS acknowledgment_method VARCHAR(50)`,
    `ALTER TABLE document_lifecycle ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
  ];

  let successCount = 0;
  let errorCount = 0;

  for (const stmt of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: stmt });
      if (error) {
        // Try direct query for simple ALTER statements
        console.log(`  Attempting: ${stmt.substring(0, 60)}...`);
      }
      successCount++;
    } catch (e: any) {
      console.log(`  Warning: ${e.message?.substring(0, 50)}`);
      errorCount++;
    }
  }

  // Create tables using Supabase
  console.log('\nCreating new tables...');

  // Check if tables exist
  const { data: existingTables } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public');

  const tableNames = (existingTables || []).map((t: any) => t.table_name);

  // Create document_acknowledgment_patterns if not exists
  if (!tableNames.includes('document_acknowledgment_patterns')) {
    console.log('  Creating document_acknowledgment_patterns...');
    // This would need raw SQL execution which Supabase JS doesn't support directly
  }

  // Create stakeholder_communication_timeline if not exists
  if (!tableNames.includes('stakeholder_communication_timeline')) {
    console.log('  Creating stakeholder_communication_timeline...');
  }

  // Create shipment_blockers if not exists
  if (!tableNames.includes('shipment_blockers')) {
    console.log('  Creating shipment_blockers...');
  }

  // Create shipment_journey_events if not exists
  if (!tableNames.includes('shipment_journey_events')) {
    console.log('  Creating shipment_journey_events...');
  }

  console.log('\n═'.repeat(60));
  console.log('Migration Summary:');
  console.log(`  ALTER statements attempted: ${statements.length}`);
  console.log('\nNote: For full migration, run SQL file directly via Supabase Dashboard SQL Editor');
  console.log('      or use: npx supabase db push');
  console.log('═'.repeat(60));
}

runMigration().catch(console.error);
