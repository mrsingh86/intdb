/**
 * Pipeline Integration Test
 *
 * Tests the full email processing pipeline with registry wiring.
 * Run with: npx tsx scripts/test-pipeline-integration.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables. Check .env.local');
  process.exit(1);
}

async function runTest() {
  console.log('='.repeat(80));
  console.log('PIPELINE INTEGRATION TEST');
  console.log('='.repeat(80));

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Get pending emails
  console.log('\n[1] Fetching pending emails...');
  const { data: pendingEmails, error: fetchError } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .eq('processing_status', 'pending')
    .limit(10);

  if (fetchError) {
    console.error('Failed to fetch emails:', fetchError);
    return;
  }

  console.log(`Found ${pendingEmails?.length || 0} pending emails`);

  if (!pendingEmails || pendingEmails.length === 0) {
    console.log('No pending emails to process');
    return;
  }

  // 2. Initialize orchestrator
  console.log('\n[2] Initializing EmailProcessingOrchestrator...');
  const orchestrator = new EmailProcessingOrchestrator(supabaseUrl, supabaseKey);
  await orchestrator.initialize();

  // 3. Process each email
  console.log('\n[3] Processing emails through pipeline...\n');
  const results: Array<{
    emailId: string;
    subject: string;
    success: boolean;
    stage?: string;
    error?: string;
    shipmentId?: string;
  }> = [];

  for (const email of pendingEmails) {
    console.log(`Processing: ${email.subject?.substring(0, 60)}...`);
    try {
      const result = await orchestrator.processEmail(email.id);
      results.push({
        emailId: email.id,
        subject: email.subject || '',
        success: result.success,
        stage: result.stage,
        error: result.error,
        shipmentId: result.shipmentId,
      });
      console.log(`  -> ${result.success ? '✓' : '✗'} ${result.stage}${result.shipmentId ? ` (shipment: ${result.shipmentId})` : ''}${result.error ? ` - ${result.error}` : ''}\n`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        emailId: email.id,
        subject: email.subject || '',
        success: false,
        error: errorMsg,
      });
      console.log(`  -> ✗ Exception: ${errorMsg}\n`);
    }
  }

  // 4. Check database state after processing
  console.log('\n[4] Checking database state after processing...');

  const [
    emailSenders,
    shipments,
    parties,
    documents,
    workstateHistory,
    processedEmails,
  ] = await Promise.all([
    supabase.from('email_senders').select('*', { count: 'exact', head: true }),
    supabase.from('shipments').select('*', { count: 'exact', head: true }),
    supabase.from('parties').select('*', { count: 'exact', head: true }),
    supabase.from('documents').select('*', { count: 'exact', head: true }),
    supabase.from('workflow_state_history').select('*', { count: 'exact', head: true }),
    supabase.from('raw_emails').select('*', { count: 'exact', head: true }).eq('processing_status', 'processed'),
  ]);

  console.log('\nDatabase State:');
  console.log(`  email_senders:         ${emailSenders.count || 0}`);
  console.log(`  shipments:             ${shipments.count || 0}`);
  console.log(`  parties:               ${parties.count || 0}`);
  console.log(`  documents:             ${documents.count || 0}`);
  console.log(`  workflow_state_history: ${workstateHistory.count || 0}`);
  console.log(`  processed emails:      ${processedEmails.count || 0}`);

  // 5. Get sample data for evaluation
  console.log('\n[5] Sample data for LLM judge evaluation...\n');

  // Sample email senders
  const { data: sampleSenders } = await supabase
    .from('email_senders')
    .select('email_address, domain, email_count, first_seen_at')
    .limit(5);

  if (sampleSenders && sampleSenders.length > 0) {
    console.log('Email Senders Registered:');
    sampleSenders.forEach(s => {
      console.log(`  - ${s.email_address} (${s.domain}) - ${s.email_count} emails`);
    });
  }

  // Sample shipments
  const { data: sampleShipments } = await supabase
    .from('shipments')
    .select('booking_number, workflow_state, carrier_id, port_of_loading, port_of_discharge')
    .limit(5);

  if (sampleShipments && sampleShipments.length > 0) {
    console.log('\nShipments Created:');
    sampleShipments.forEach(s => {
      console.log(`  - ${s.booking_number || 'N/A'}: ${s.workflow_state || 'N/A'} (${s.port_of_loading || '?'} → ${s.port_of_discharge || '?'})`);
    });
  }

  // Sample workflow history
  const { data: sampleHistory } = await supabase
    .from('workflow_state_history')
    .select('previous_state, new_state, triggered_by_document_type, transitioned_at')
    .limit(5);

  if (sampleHistory && sampleHistory.length > 0) {
    console.log('\nWorkflow State History:');
    sampleHistory.forEach(h => {
      console.log(`  - ${h.previous_state || 'null'} → ${h.new_state} (triggered by: ${h.triggered_by_document_type || 'N/A'})`);
    });
  }

  // 6. Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  console.log(`\nProcessing Results:`);
  console.log(`  Total:    ${results.length}`);
  console.log(`  Success:  ${successCount}`);
  console.log(`  Failed:   ${failureCount}`);

  if (failureCount > 0) {
    console.log('\nFailures:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.subject?.substring(0, 50)}: ${r.error}`);
    });
  }

  // Output JSON for LLM judge
  console.log('\n' + '='.repeat(80));
  console.log('JSON OUTPUT FOR LLM JUDGE');
  console.log('='.repeat(80));
  console.log(JSON.stringify({
    testRun: {
      timestamp: new Date().toISOString(),
      emailsProcessed: results.length,
      successRate: `${Math.round((successCount / results.length) * 100)}%`,
    },
    databaseState: {
      emailSenders: emailSenders.count || 0,
      shipments: shipments.count || 0,
      parties: parties.count || 0,
      documents: documents.count || 0,
      workflowStateHistory: workstateHistory.count || 0,
    },
    processingResults: results,
    sampleData: {
      emailSenders: sampleSenders,
      shipments: sampleShipments,
      workflowHistory: sampleHistory,
    },
  }, null, 2));
}

runTest().catch(console.error);
