#!/usr/bin/env npx tsx
/**
 * Run migration 022: Bi-Directional Linking
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function runMigration() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('MIGRATION 022: Bi-Directional Email-Shipment Linking');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Add columns to shipment_documents (one at a time for safety)
  console.log('1. Adding columns to shipment_documents...');

  const columns = [
    { name: 'link_source', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS link_source VARCHAR(20) DEFAULT 'realtime'" },
    { name: 'link_identifier_type', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS link_identifier_type VARCHAR(30)" },
    { name: 'link_identifier_value', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS link_identifier_value TEXT" },
    { name: 'link_confidence_score', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS link_confidence_score INTEGER DEFAULT 95" },
    { name: 'email_authority', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS email_authority INTEGER DEFAULT 4" },
    { name: 'is_source_of_truth', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS is_source_of_truth BOOLEAN DEFAULT false" },
    { name: 'linked_at', sql: "ALTER TABLE shipment_documents ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()" },
  ];

  for (const col of columns) {
    const { error } = await supabase.rpc('exec_sql', { sql: col.sql });
    if (error && !error.message.includes('already exists')) {
      console.log(`   ⚠ ${col.name}: ${error.message}`);
    } else {
      console.log(`   ✓ ${col.name}`);
    }
  }

  // 2. Create shipment_link_audit table
  console.log('');
  console.log('2. Creating shipment_link_audit table...');

  const auditTableSql = `
    CREATE TABLE IF NOT EXISTS shipment_link_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_id UUID NOT NULL,
      shipment_id UUID NOT NULL,
      operation VARCHAR(20) NOT NULL,
      link_source VARCHAR(20) NOT NULL,
      link_identifier_type VARCHAR(30),
      link_identifier_value TEXT,
      confidence_score INTEGER,
      confidence_breakdown JSONB,
      email_authority INTEGER,
      conflict_type VARCHAR(50),
      conflict_resolution JSONB,
      created_by UUID,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      notes TEXT
    )
  `;

  const { error: auditError } = await supabase.rpc('exec_sql', { sql: auditTableSql });
  if (auditError && !auditError.message.includes('already exists')) {
    console.log(`   ⚠ ${auditError.message}`);
  } else {
    console.log('   ✓ shipment_link_audit table created');
  }

  // 3. Update existing shipment_documents
  console.log('');
  console.log('3. Updating existing shipment_documents with defaults...');

  const { data: updated, error: updateError } = await supabase
    .from('shipment_documents')
    .update({
      link_source: 'migration',
      link_identifier_type: 'booking_number',
    })
    .is('link_identifier_type', null)
    .select('id');

  if (updateError) {
    console.log(`   ⚠ ${updateError.message}`);
  } else {
    console.log(`   ✓ Updated ${updated?.length || 0} existing records`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

runMigration().catch(console.error);
