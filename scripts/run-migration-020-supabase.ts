/**
 * Run Migration 020: Add Idempotency Constraints (using Supabase client)
 *
 * Since direct SQL execution requires database credentials,
 * we'll verify the constraints can be applied by checking existing data
 * and provide the SQL for manual execution.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkData() {
  console.log('=== Migration 020: Idempotency Constraints Check ===\n');

  // Check notifications table
  console.log('1. Checking notifications table for duplicate email_ids...');
  const { data: notifDupes, error: notifError } = await supabase
    .from('notifications')
    .select('email_id')
    .not('email_id', 'is', null);

  if (notifError) {
    console.log(`   ⚠️ Error checking notifications: ${notifError.message}`);
  } else {
    const emailIds = notifDupes?.map(n => n.email_id) || [];
    const uniqueIds = new Set(emailIds);
    if (emailIds.length === uniqueIds.size) {
      console.log(`   ✅ No duplicates found (${emailIds.length} records, all unique)`);
    } else {
      console.log(`   ❌ Found duplicates: ${emailIds.length} records, ${uniqueIds.size} unique`);
    }
  }

  // Check stakeholder_extraction_queue table
  console.log('\n2. Checking stakeholder_extraction_queue for duplicate email_ids...');
  const { data: extractDupes, error: extractError } = await supabase
    .from('stakeholder_extraction_queue')
    .select('email_id')
    .not('email_id', 'is', null);

  if (extractError) {
    console.log(`   ⚠️ Error checking extraction queue: ${extractError.message}`);
  } else {
    const emailIds = extractDupes?.map(e => e.email_id) || [];
    const uniqueIds = new Set(emailIds);
    if (emailIds.length === uniqueIds.size) {
      console.log(`   ✅ No duplicates found (${emailIds.length} records, all unique)`);
    } else {
      console.log(`   ❌ Found duplicates: ${emailIds.length} records, ${uniqueIds.size} unique`);
    }
  }

  // Check document_lifecycle table
  console.log('\n3. Checking document_lifecycle for duplicate shipment+document_type...');
  const { data: docLifecycle, error: docError } = await supabase
    .from('document_lifecycle')
    .select('shipment_id, document_type');

  if (docError) {
    console.log(`   ⚠️ Error checking document_lifecycle: ${docError.message}`);
  } else {
    const keys = docLifecycle?.map(d => `${d.shipment_id}:${d.document_type}`) || [];
    const uniqueKeys = new Set(keys);
    if (keys.length === uniqueKeys.size) {
      console.log(`   ✅ No duplicates found (${keys.length} records, all unique)`);
    } else {
      console.log(`   ❌ Found duplicates: ${keys.length} records, ${uniqueKeys.size} unique`);
    }
  }

  // Output SQL to run manually
  console.log('\n=== SQL to Run in Supabase Dashboard ===\n');
  console.log(`Copy and paste this SQL into the Supabase SQL Editor:`);
  console.log(`Dashboard URL: https://supabase.com/dashboard/project/jkvlggqkccozyouvipso/sql/new\n`);

  const sql = `
-- ============================================================================
-- MIGRATION 020: ADD IDEMPOTENCY CONSTRAINTS
-- Run this SQL in the Supabase Dashboard SQL Editor
-- ============================================================================

-- 1. Add unique constraint on notifications.email_id
ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_email_id_key;

ALTER TABLE notifications
ADD CONSTRAINT notifications_email_id_key UNIQUE (email_id);

-- 2. Add unique constraint on stakeholder_extraction_queue.email_id
ALTER TABLE stakeholder_extraction_queue
DROP CONSTRAINT IF EXISTS stakeholder_extraction_queue_email_id_key;

ALTER TABLE stakeholder_extraction_queue
ADD CONSTRAINT stakeholder_extraction_queue_email_id_key UNIQUE (email_id);

-- 3. Performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_email_id
  ON notifications(email_id);

CREATE INDEX IF NOT EXISTS idx_stakeholder_extraction_email
  ON stakeholder_extraction_queue(email_id);

CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_shipment_status
  ON document_lifecycle(shipment_id, lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_notifications_overdue_critical
  ON notifications(deadline_date, priority)
  WHERE deadline_date IS NOT NULL
    AND status NOT IN ('actioned', 'dismissed');

-- Verify constraints were created
SELECT conname, conrelid::regclass as table_name
FROM pg_constraint
WHERE conname IN (
  'notifications_email_id_key',
  'stakeholder_extraction_queue_email_id_key'
);
`;

  console.log(sql);

  // Copy to clipboard
  try {
    const { exec } = await import('child_process');
    exec(`echo ${JSON.stringify(sql)} | pbcopy`);
    console.log('\n✅ SQL copied to clipboard!');
  } catch {
    console.log('\n(Could not copy to clipboard automatically)');
  }
}

checkData().catch(console.error);
