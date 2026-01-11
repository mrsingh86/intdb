/**
 * Test Integrated Chronicle Service with Logger
 * Verifies that logging is working correctly when integrated into the service
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { ChronicleLogger } from '../lib/chronicle/chronicle-logger';
import { createChronicleService, createChronicleGmailService } from '../lib/chronicle';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testIntegratedService() {
  console.log('\n=== TESTING INTEGRATED CHRONICLE SERVICE ===\n');

  // 1. Create Gmail service
  console.log('1. Creating Gmail service...');
  const gmailService = createChronicleGmailService();
  const connected = await gmailService.testConnection();
  if (!connected) {
    console.error('Gmail connection failed');
    process.exit(1);
  }
  console.log('   Gmail connected ✓');

  // 2. Create Logger
  console.log('2. Creating Chronicle Logger...');
  const logger = new ChronicleLogger(supabase);
  console.log('   Logger created ✓');

  // 3. Create integrated service
  console.log('3. Creating integrated ChronicleService with logger...');
  const service = createChronicleService(supabase, gmailService, logger);
  console.log('   Service created ✓');

  // 4. Process a small batch (5 emails from last 1 day)
  console.log('4. Processing 5 emails from last 1 day...\n');

  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

  const result = await service.fetchAndProcess({
    after: oneDayAgo,
    maxResults: 5,
  });

  console.log('\n=== PROCESSING RESULTS ===\n');
  console.log(`   Processed: ${result.processed}`);
  console.log(`   Succeeded: ${result.succeeded}`);
  console.log(`   Failed: ${result.failed}`);
  console.log(`   Linked: ${result.linked}`);
  console.log(`   Time: ${result.totalTimeMs}ms`);

  // 5. Verify logging data in database
  console.log('\n=== VERIFYING DATABASE LOGS ===\n');

  const { data: runs } = await supabase
    .from('chronicle_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  if (runs && runs.length > 0) {
    const run = runs[0];
    console.log('✓ chronicle_runs:');
    console.log(`   - Run ID: ${run.id}`);
    console.log(`   - Status: ${run.status}`);
    console.log(`   - Emails total: ${run.emails_total}`);
    console.log(`   - Emails processed: ${run.emails_processed}`);
    console.log(`   - Emails succeeded: ${run.emails_succeeded}`);
    console.log(`   - Shipments created: ${run.shipments_created}`);
    console.log(`   - Stage changes: ${run.stage_changes}`);

    // Check stage metrics
    const { data: metrics } = await supabase
      .from('chronicle_stage_metrics')
      .select('*')
      .eq('run_id', run.id);

    if (metrics && metrics.length > 0) {
      console.log(`\n✓ chronicle_stage_metrics: ${metrics.length} stages logged`);
      for (const m of metrics) {
        console.log(`   - ${m.stage}: success=${m.success_count} fail=${m.failure_count} avg=${m.avg_duration_ms}ms`);
      }
    }

    // Check errors
    const { data: errors } = await supabase
      .from('chronicle_errors')
      .select('*')
      .eq('run_id', run.id);

    if (errors && errors.length > 0) {
      console.log(`\n⚠ chronicle_errors: ${errors.length} errors logged`);
      for (const e of errors.slice(0, 3)) {
        console.log(`   - ${e.stage}: ${e.error_type}`);
      }
    } else {
      console.log('\n✓ chronicle_errors: No errors (clean run)');
    }

    // Check shipment events
    const { data: events } = await supabase
      .from('shipment_events')
      .select('*')
      .eq('run_id', run.id);

    if (events && events.length > 0) {
      console.log(`\n✓ shipment_events: ${events.length} events logged`);
      for (const e of events.slice(0, 5)) {
        console.log(`   - ${e.event_type}: ${e.event_description?.substring(0, 50)}`);
      }
    }
  } else {
    console.log('✗ No runs found in chronicle_runs');
  }

  // 6. Check shipments created
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, mbl_number, stage')
    .order('created_at', { ascending: false })
    .limit(5);

  if (shipments && shipments.length > 0) {
    console.log(`\n✓ shipments: ${shipments.length} recent shipments`);
    for (const s of shipments) {
      console.log(`   - ${s.booking_number || s.mbl_number || s.id.substring(0, 8)}: stage=${s.stage}`);
    }
  }

  console.log('\n=== INTEGRATION TEST COMPLETE ===\n');
}

testIntegratedService()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Test failed:', e);
    process.exit(1);
  });
