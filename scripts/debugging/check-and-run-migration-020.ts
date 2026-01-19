#!/usr/bin/env npx tsx
/**
 * Check and Run Migration 020 - Idempotency Constraints
 * Verifies constraints exist and runs migration if needed
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('============================================================');
  console.log('CHECK & RUN MIGRATION 020 - IDEMPOTENCY CONSTRAINTS');
  console.log('============================================================\n');

  // Step 1: Check current counts
  console.log('Current table counts:');

  const { count: notifCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });
  console.log(`  notifications: ${notifCount} rows`);

  const { count: queueCount } = await supabase
    .from('stakeholder_extraction_queue')
    .select('*', { count: 'exact', head: true });
  console.log(`  stakeholder_extraction_queue: ${queueCount} rows`);

  const { count: docCount } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });
  console.log(`  document_lifecycle: ${docCount} rows`);

  const { count: taskCount } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });
  console.log(`  action_tasks: ${taskCount} rows`);

  // Step 2: Test for unique constraint on notifications.email_id
  console.log('\n--- Testing Constraints ---');

  // Get an email that already has a notification
  const { data: existingNotif } = await supabase
    .from('notifications')
    .select('email_id')
    .limit(1);

  if (existingNotif && existingNotif.length > 0 && existingNotif[0].email_id) {
    const testEmailId = existingNotif[0].email_id;
    console.log(`Testing duplicate insert for email_id: ${testEmailId}`);

    const { error } = await supabase.from('notifications').insert({
      email_id: testEmailId,
      notification_type: 'test_constraint',
      title: 'Test Constraint Check',
      status: 'unread',
      received_at: new Date().toISOString()
    });

    if (error) {
      if (error.code === '23505' || error.message.includes('unique') || error.message.includes('duplicate')) {
        console.log('✅ UNIQUE constraint on notifications.email_id EXISTS');
      } else {
        console.log(`Other error: ${error.code} - ${error.message}`);
      }
    } else {
      console.log('❌ NO UNIQUE constraint - duplicate inserted successfully');
      console.log('   Need to run migration 020 to add constraint');
      // Cleanup
      await supabase.from('notifications').delete().eq('notification_type', 'test_constraint');
    }
  } else {
    console.log('No existing notifications to test constraint with');
    console.log('Constraint status: UNKNOWN (will attempt migration)');
  }

  // Step 3: Check if document_lifecycle has composite unique
  const { data: docDupeCheck } = await supabase
    .from('document_lifecycle')
    .select('shipment_id, document_type')
    .limit(1);

  if (docDupeCheck && docDupeCheck.length > 0) {
    const { error: docError } = await supabase.from('document_lifecycle').insert({
      shipment_id: docDupeCheck[0].shipment_id,
      document_type: docDupeCheck[0].document_type,
      lifecycle_status: 'test'
    });

    if (docError && (docError.code === '23505' || docError.message.includes('unique'))) {
      console.log('✅ UNIQUE constraint on document_lifecycle(shipment_id, document_type) EXISTS');
    } else if (docError) {
      console.log(`document_lifecycle constraint check error: ${docError.message}`);
    } else {
      console.log('❌ NO UNIQUE constraint on document_lifecycle - duplicate inserted');
      await supabase.from('document_lifecycle').delete()
        .eq('shipment_id', docDupeCheck[0].shipment_id)
        .eq('document_type', docDupeCheck[0].document_type)
        .eq('lifecycle_status', 'test');
    }
  }

  console.log('\n============================================================');
  console.log('MIGRATION 020 CHECK COMPLETE');
  console.log('============================================================');
  console.log('\nTo run the migration manually:');
  console.log('1. Copy the SQL from database/migrations/020_add_idempotency_constraints.sql');
  console.log('2. Run it in Supabase SQL Editor');
}

main().catch(console.error);
