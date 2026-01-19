/**
 * Run Migration 020: Add Idempotency Constraints
 *
 * This script adds UNIQUE constraints and performance indexes
 * to prevent duplicate records during cron job runs.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('Running Migration 020: Add Idempotency Constraints...\n');

  const results: { step: string; status: 'success' | 'skipped' | 'error'; message?: string }[] = [];

  // Step 1: Add unique constraint on notifications.email_id
  console.log('Step 1: Adding unique constraint on notifications.email_id...');
  try {
    // First check if constraint exists
    const { data: existingConstraint } = await supabase.rpc('exec_sql', {
      sql: `SELECT 1 FROM pg_constraint WHERE conname = 'notifications_email_id_key'`
    });

    // Try adding the constraint
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE notifications
        DROP CONSTRAINT IF EXISTS notifications_email_id_key;

        ALTER TABLE notifications
        ADD CONSTRAINT notifications_email_id_key UNIQUE (email_id);
      `
    });

    if (error) {
      // Try alternative approach - direct query
      const { error: altError } = await supabase
        .from('notifications')
        .select('email_id')
        .limit(1);

      if (altError) {
        results.push({ step: 'notifications unique constraint', status: 'error', message: error.message });
      } else {
        results.push({ step: 'notifications unique constraint', status: 'skipped', message: 'RPC not available, constraint may already exist' });
      }
    } else {
      results.push({ step: 'notifications unique constraint', status: 'success' });
    }
  } catch (err: any) {
    results.push({ step: 'notifications unique constraint', status: 'error', message: err.message });
  }

  // Step 2: Add unique constraint on stakeholder_extraction_queue.email_id
  console.log('Step 2: Adding unique constraint on stakeholder_extraction_queue.email_id...');
  try {
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE stakeholder_extraction_queue
        DROP CONSTRAINT IF EXISTS stakeholder_extraction_queue_email_id_key;

        ALTER TABLE stakeholder_extraction_queue
        ADD CONSTRAINT stakeholder_extraction_queue_email_id_key UNIQUE (email_id);
      `
    });

    if (error) {
      results.push({ step: 'extraction_queue unique constraint', status: 'skipped', message: 'RPC not available' });
    } else {
      results.push({ step: 'extraction_queue unique constraint', status: 'success' });
    }
  } catch (err: any) {
    results.push({ step: 'extraction_queue unique constraint', status: 'error', message: err.message });
  }

  // Step 3: Create indexes
  console.log('Step 3: Creating performance indexes...');
  const indexes = [
    { name: 'idx_notifications_email_id', sql: 'CREATE INDEX IF NOT EXISTS idx_notifications_email_id ON notifications(email_id)' },
    { name: 'idx_stakeholder_extraction_email', sql: 'CREATE INDEX IF NOT EXISTS idx_stakeholder_extraction_email ON stakeholder_extraction_queue(email_id)' },
    { name: 'idx_doc_lifecycle_shipment_status', sql: 'CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_shipment_status ON document_lifecycle(shipment_id, lifecycle_status)' },
  ];

  for (const index of indexes) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: index.sql });
      if (error) {
        results.push({ step: `index ${index.name}`, status: 'skipped', message: 'RPC not available' });
      } else {
        results.push({ step: `index ${index.name}`, status: 'success' });
      }
    } catch (err: any) {
      results.push({ step: `index ${index.name}`, status: 'error', message: err.message });
    }
  }

  // Print results
  console.log('\n=== Migration Results ===\n');
  for (const result of results) {
    const icon = result.status === 'success' ? '✅' : result.status === 'skipped' ? '⏭️' : '❌';
    console.log(`${icon} ${result.step}: ${result.status}${result.message ? ` (${result.message})` : ''}`);
  }

  // Alternative: Check if we need to run via Supabase Dashboard
  console.log('\n=== Alternative: Run via Supabase SQL Editor ===');
  console.log('If RPC is not available, run the following SQL in Supabase Dashboard:');
  console.log('');
  console.log(`
-- Add unique constraint on notifications.email_id
ALTER TABLE notifications
ADD CONSTRAINT notifications_email_id_key UNIQUE (email_id);

-- Add unique constraint on stakeholder_extraction_queue.email_id
ALTER TABLE stakeholder_extraction_queue
ADD CONSTRAINT stakeholder_extraction_queue_email_id_key UNIQUE (email_id);

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_email_id ON notifications(email_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_extraction_email ON stakeholder_extraction_queue(email_id);
CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_shipment_status ON document_lifecycle(shipment_id, lifecycle_status);
  `);
}

runMigration().catch(console.error);
