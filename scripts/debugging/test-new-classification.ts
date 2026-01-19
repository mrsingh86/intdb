/**
 * Test Script: New Classification Method Quality
 *
 * Reprocesses 50 emails with the new method and compares to old classification.
 * Shows quality metrics for the new learning system.
 *
 * Usage: npx tsx scripts/test-new-classification.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import {
  ChronicleService,
  ChronicleLogger,
  createChronicleGmailService,
} from '../lib/chronicle';

const TEST_SIZE = 50;

interface TestRecord {
  gmail_message_id: string;
  old_doc_type: string;
  subject: string;
  from_party: string;
}

async function main() {
  console.log('='.repeat(70));
  console.log('NEW CLASSIFICATION METHOD - QUALITY TEST');
  console.log('='.repeat(70));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const gmailService = createChronicleGmailService();
  const logger = new ChronicleLogger(supabase);
  const chronicleService = new ChronicleService(supabase, gmailService, logger);

  // Step 1: Get 50 random emails to reprocess
  console.log(`\n📧 Step 1: Selecting ${TEST_SIZE} random emails for reprocessing...`);

  const { data: testEmails, error: selectError } = await supabase
    .from('chronicle')
    .select('gmail_message_id, document_type, subject, from_party')
    .gt('occurred_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order('occurred_at', { ascending: false })
    .limit(TEST_SIZE);

  if (selectError || !testEmails) {
    console.error('Failed to select test emails:', selectError);
    process.exit(1);
  }

  const testRecords: TestRecord[] = testEmails.map(e => ({
    gmail_message_id: e.gmail_message_id,
    old_doc_type: e.document_type,
    subject: e.subject,
    from_party: e.from_party,
  }));

  console.log(`   Selected ${testRecords.length} emails`);

  // Step 2: Store old classifications for comparison
  const oldClassifications = new Map<string, string>();
  testRecords.forEach(r => oldClassifications.set(r.gmail_message_id, r.old_doc_type));

  // Step 3: Delete from chronicle (so they can be reprocessed)
  console.log('\n🗑️  Step 2: Removing old records to allow reprocessing...');

  const messageIds = testRecords.map(r => r.gmail_message_id);
  const messageIdList = messageIds.map(id => `'${id}'`).join(',');

  // Use raw SQL for reliable deletion (Supabase client .in() can be unreliable)
  const deleteSQL = `
    -- Delete from referencing tables first
    DELETE FROM learning_episodes WHERE chronicle_id IN (SELECT id FROM chronicle WHERE gmail_message_id IN (${messageIdList}));
    DELETE FROM shipment_events WHERE chronicle_id IN (SELECT id FROM chronicle WHERE gmail_message_id IN (${messageIdList}));
    UPDATE shipment_narrative_chains SET trigger_chronicle_id = NULL WHERE trigger_chronicle_id IN (SELECT id FROM chronicle WHERE gmail_message_id IN (${messageIdList}));
    UPDATE shipment_narrative_chains SET resolution_chronicle_id = NULL WHERE resolution_chronicle_id IN (SELECT id FROM chronicle WHERE gmail_message_id IN (${messageIdList}));
    -- Finally delete chronicle records
    DELETE FROM chronicle WHERE gmail_message_id IN (${messageIdList});
  `;

  const { error: deleteError } = await supabase.rpc('exec_sql', { sql: deleteSQL });

  // If exec_sql doesn't exist, delete one by one
  if (deleteError) {
    console.log('   Using fallback delete method...');
    for (const msgId of messageIds) {
      // Get chronicle id
      const { data: rec } = await supabase.from('chronicle').select('id').eq('gmail_message_id', msgId).single();
      if (rec) {
        await supabase.from('learning_episodes').delete().eq('chronicle_id', rec.id);
        await supabase.from('shipment_events').delete().eq('chronicle_id', rec.id);
        await supabase.from('shipment_narrative_chains').update({ trigger_chronicle_id: null }).eq('trigger_chronicle_id', rec.id);
        await supabase.from('shipment_narrative_chains').update({ resolution_chronicle_id: null }).eq('resolution_chronicle_id', rec.id);
        await supabase.from('chronicle').delete().eq('id', rec.id);
      }
    }
  }

  // Verify deletion
  const { count: remainingCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .in('gmail_message_id', messageIds);

  console.log(`   Deleted records. Remaining: ${remainingCount || 0}`);

  // Step 4: Reprocess with new method - fetch specific message IDs
  console.log('\n🔄 Step 3: Reprocessing with NEW classification method...');
  console.log('   (Thread position, enum normalization, flow validation, learning episodes)\n');

  // Fetch these specific emails from Gmail
  const emails = await gmailService.fetchEmailsByMessageIds(messageIds);
  console.log(`   Fetched ${emails.length} emails from Gmail`);

  // Process the batch
  const result = await chronicleService.processBatch(emails, undefined, TEST_SIZE, 3);

  console.log(`\n   Processed: ${result.processed}`);
  console.log(`   Succeeded: ${result.succeeded}`);
  console.log(`   Failed: ${result.failed}`);

  // Step 5: Get new classifications
  console.log('\n📊 Step 4: Comparing OLD vs NEW classifications...\n');

  const { data: newRecords } = await supabase
    .from('chronicle')
    .select('gmail_message_id, document_type, subject')
    .in('gmail_message_id', messageIds);

  if (!newRecords) {
    console.error('Failed to fetch new records');
    process.exit(1);
  }

  // Compare classifications
  let matches = 0;
  let changes = 0;
  const changeDetails: { subject: string; old: string; new: string }[] = [];

  for (const newRec of newRecords) {
    const oldType = oldClassifications.get(newRec.gmail_message_id);
    if (oldType === newRec.document_type) {
      matches++;
    } else {
      changes++;
      changeDetails.push({
        subject: newRec.subject.substring(0, 60) + (newRec.subject.length > 60 ? '...' : ''),
        old: oldType || 'unknown',
        new: newRec.document_type,
      });
    }
  }

  console.log('━'.repeat(70));
  console.log('COMPARISON RESULTS');
  console.log('━'.repeat(70));
  console.log(`   Total compared:    ${newRecords.length}`);
  console.log(`   Same as before:    ${matches} (${Math.round(matches/newRecords.length*100)}%)`);
  console.log(`   Changed:           ${changes} (${Math.round(changes/newRecords.length*100)}%)`);

  if (changeDetails.length > 0) {
    console.log('\n📝 Classification Changes:');
    console.log('─'.repeat(70));
    changeDetails.slice(0, 20).forEach((c, i) => {
      console.log(`${i+1}. ${c.subject}`);
      console.log(`   OLD: ${c.old}  →  NEW: ${c.new}`);
    });
    if (changeDetails.length > 20) {
      console.log(`   ... and ${changeDetails.length - 20} more changes`);
    }
  }

  // Step 6: Check learning episodes quality
  console.log('\n📋 Step 5: Learning Episodes Analysis...');

  const { data: episodes } = await supabase
    .from('learning_episodes')
    .select('predicted_document_type, prediction_method, prediction_confidence, thread_position, classification_strategy, flow_validation_passed')
    .order('created_at', { ascending: false })
    .limit(TEST_SIZE);

  if (episodes && episodes.length > 0) {
    // Strategy breakdown
    const strategyCount = episodes.reduce((acc, e) => {
      acc[e.classification_strategy || 'unknown'] = (acc[e.classification_strategy || 'unknown'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Method breakdown
    const methodCount = episodes.reduce((acc, e) => {
      acc[e.prediction_method || 'unknown'] = (acc[e.prediction_method || 'unknown'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Flow validation
    const flowPassed = episodes.filter(e => e.flow_validation_passed).length;

    console.log('─'.repeat(70));
    console.log(`   Total episodes:      ${episodes.length}`);
    console.log(`   Flow validation OK:  ${flowPassed} (${Math.round(flowPassed/episodes.length*100)}%)`);
    console.log('\n   Classification Strategy:');
    Object.entries(strategyCount).forEach(([k, v]) => {
      console.log(`     ${k}: ${v} (${Math.round(v/episodes.length*100)}%)`);
    });
    console.log('\n   Prediction Method:');
    Object.entries(methodCount).forEach(([k, v]) => {
      console.log(`     ${k}: ${v} (${Math.round(v/episodes.length*100)}%)`);
    });
  }

  // Step 7: Document type distribution in new classifications
  console.log('\n📊 Step 6: New Classification Distribution...');

  const docTypeCount = newRecords.reduce((acc, r) => {
    acc[r.document_type] = (acc[r.document_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedTypes = Object.entries(docTypeCount).sort((a, b) => b[1] - a[1]);

  console.log('─'.repeat(70));
  sortedTypes.forEach(([type, count]) => {
    const bar = '█'.repeat(Math.round(count / newRecords.length * 30));
    console.log(`   ${type.padEnd(25)} ${count.toString().padStart(3)} ${bar}`);
  });

  // Check for generic types
  const genericTypes = ['request', 'notification', 'internal_notification', 'system_notification', 'unknown'];
  const genericCount = sortedTypes
    .filter(([type]) => genericTypes.includes(type))
    .reduce((sum, [, count]) => sum + count, 0);

  console.log('\n━'.repeat(70));
  console.log('QUALITY SCORE');
  console.log('━'.repeat(70));
  const qualityScore = Math.round((newRecords.length - genericCount) / newRecords.length * 100);
  console.log(`   Specific classifications: ${newRecords.length - genericCount}/${newRecords.length}`);
  console.log(`   Generic classifications:  ${genericCount}/${newRecords.length}`);
  console.log(`   Quality Score:            ${qualityScore}%`);
  console.log('━'.repeat(70));

  // Pattern match stats
  const stats = chronicleService.getPatternMatchStats();
  console.log('\n📈 Pattern Matching Performance:');
  console.log(`   Pattern matches: ${stats.matched}`);
  console.log(`   AI fallback:     ${stats.aiNeeded}`);
  console.log(`   Match rate:      ${stats.matchRate}`);

  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
