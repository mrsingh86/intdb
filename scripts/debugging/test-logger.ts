/**
 * Test Chronicle Logger
 * Verifies that logging is working correctly with the new schema
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { ChronicleLogger } from '../lib/chronicle/chronicle-logger';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testLogger() {
  console.log('\n=== TESTING CHRONICLE LOGGER ===\n');

  const logger = new ChronicleLogger(supabase);

  // 1. Start a test run
  console.log('1. Starting test run...');
  const runId = await logger.startRun({
    queryAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
    maxResults: 100,
    emailsTotal: 10,
  });
  console.log(`   Run ID: ${runId}`);

  // 2. Log some stage metrics
  console.log('2. Logging stage metrics...');

  const pdfStart = logger.logStageStart('pdf_extract');
  await new Promise(r => setTimeout(r, 50));
  logger.logStageSuccess('pdf_extract', pdfStart, { text_extract: 1 });

  const aiStart = logger.logStageStart('ai_analysis');
  await new Promise(r => setTimeout(r, 100));
  logger.logStageSuccess('ai_analysis', aiStart);

  const dbStart = logger.logStageStart('db_save');
  await new Promise(r => setTimeout(r, 30));
  logger.logStageSuccess('db_save', dbStart);

  // 3. Log an error
  console.log('3. Logging test error...');
  const errorStart = logger.logStageStart('pdf_extract');
  logger.logStageFailure(
    'pdf_extract',
    errorStart,
    new Error('Test error: PDF password protected'),
    { gmailMessageId: 'test-123', attachmentName: 'test.pdf' },
    true
  );

  // 4. Log email processed
  console.log('4. Logging email processed...');
  logger.logEmailProcessed(true);
  logger.logEmailProcessed(true);
  logger.logEmailProcessed(false);

  // 5. End run
  console.log('5. Ending run...');
  await logger.endRun('completed');

  // 6. Verify data in database
  console.log('\n=== VERIFICATION ===\n');

  const { data: runs } = await supabase
    .from('chronicle_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runs) {
    console.log('✓ chronicle_runs:');
    console.log(`  - Status: ${runs.status}`);
    console.log(`  - Emails total: ${runs.emails_total}`);
    console.log(`  - Emails processed: ${runs.emails_processed}`);
    console.log(`  - Emails succeeded: ${runs.emails_succeeded}`);
    console.log(`  - Emails failed: ${runs.emails_failed}`);
  } else {
    console.log('✗ chronicle_runs: NOT FOUND');
  }

  const { data: metrics } = await supabase
    .from('chronicle_stage_metrics')
    .select('*')
    .eq('run_id', runId);

  if (metrics && metrics.length > 0) {
    console.log(`\n✓ chronicle_stage_metrics: ${metrics.length} records`);
    for (const m of metrics) {
      console.log(`  - ${m.stage}: success=${m.success_count} fail=${m.failure_count} avg=${m.avg_duration_ms}ms`);
    }
  } else {
    console.log('\n✗ chronicle_stage_metrics: NOT FOUND');
  }

  const { data: errors } = await supabase
    .from('chronicle_errors')
    .select('*')
    .eq('run_id', runId);

  if (errors && errors.length > 0) {
    console.log(`\n✓ chronicle_errors: ${errors.length} records`);
    for (const e of errors) {
      console.log(`  - ${e.stage}: ${e.error_type} - ${e.error_message?.substring(0, 50)}`);
    }
  } else {
    console.log('\n✗ chronicle_errors: NOT FOUND');
  }

  // 7. Cleanup test data
  console.log('\n=== CLEANUP ===\n');
  await supabase.from('chronicle_errors').delete().eq('run_id', runId);
  await supabase.from('chronicle_stage_metrics').delete().eq('run_id', runId);
  await supabase.from('chronicle_runs').delete().eq('id', runId);
  console.log('Test data cleaned up.\n');

  console.log('=== LOGGER TEST PASSED ===\n');
}

testLogger()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Test failed:', e);
    process.exit(1);
  });
