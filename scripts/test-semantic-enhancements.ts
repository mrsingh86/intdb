/**
 * Test Semantic Enhancements
 * Verifies both ActionRulesService vector intent detection and HaikuSummaryService semantic grouping
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { ActionRulesService } from '../lib/chronicle/action-rules-service';
import { createEmbeddingService } from '../lib/chronicle/embedding-service';
import { createSemanticGroupingService, CommunicationItem } from '../lib/chronicle-v2/services/semantic-grouping-service';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// TEST 1: ActionRulesService - Vector Intent Detection
// ============================================================================

async function testActionRulesVectorIntent() {
  console.log('='.repeat(70));
  console.log('TEST 1: ActionRulesService - Vector Intent Detection');
  console.log('='.repeat(70));

  const actionRulesService = new ActionRulesService(supabase);
  const embeddingService = createEmbeddingService(supabase);
  actionRulesService.setEmbeddingService(embeddingService);

  // Test cases that should be detected by vector intent
  const testCases = [
    {
      subject: 'Update on shipment status',
      body: 'Dear Team, Could you please respond to this matter at your earliest convenience? We need clarification on the delivery schedule.',
      expected: 'action_required (vector intent)',
    },
    {
      subject: 'RE: Booking Confirmation',
      body: 'Thank you for your message. This has been processed and completed successfully. No further action needed from your end.',
      expected: 'no_action (vector intent)',
    },
    {
      subject: 'Urgent: Missing Documents',
      body: 'We are still awaiting the required documentation. This requires your immediate attention to avoid delays.',
      expected: 'action_required (phrases)',
    },
    {
      subject: 'FYI: Schedule Update',
      body: 'Please note the vessel has departed as scheduled. This is for your information only.',
      expected: 'no_action (phrases)',
    },
  ];

  console.log('\nTesting vector-based intent detection...\n');

  for (const tc of testCases) {
    const result = await actionRulesService.determineAction(
      'notification', // Generic document type to test fallback
      tc.subject,
      tc.body
    );

    const status = result.hasAction ? '⚡ ACTION REQUIRED' : '✅ NO ACTION';
    console.log(`📝 "${tc.subject.substring(0, 40)}..."`);
    console.log(`   Expected: ${tc.expected}`);
    console.log(`   Result: ${status} (${result.source}, ${result.confidence}% confidence)`);
    console.log(`   Reason: ${result.reason.substring(0, 80)}`);
    console.log('');
  }
}

// ============================================================================
// TEST 2: ActionRulesService - Learn from Similar Emails
// ============================================================================

async function testLearnFromSimilar() {
  console.log('='.repeat(70));
  console.log('TEST 2: ActionRulesService - Learn from Similar Emails');
  console.log('='.repeat(70));

  const actionRulesService = new ActionRulesService(supabase);
  const embeddingService = createEmbeddingService(supabase);
  actionRulesService.setEmbeddingService(embeddingService);

  // Test with a query about booking confirmations
  const result = await actionRulesService.learnFromSimilarEmails(
    'Booking Confirmation - 123456',
    'Your booking has been confirmed. Vessel: APL MERLION. ETD: Jan 25. Please review and confirm.',
    'booking_confirmation'
  );

  console.log('\nLearning from similar booking confirmation emails...');
  console.log(`   Matched: ${result.matched}`);
  console.log(`   Source: ${result.source}`);
  console.log(`   Requires Action: ${result.requiresAction}`);
  console.log(`   Confidence: ${result.confidence}%`);
  console.log(`   Reasoning: ${result.reasoning}`);
}

// ============================================================================
// TEST 3: SemanticGroupingService - Group Communications
// ============================================================================

async function testSemanticGrouping() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: SemanticGroupingService - Group Communications');
  console.log('='.repeat(70));

  const groupingService = createSemanticGroupingService(supabase);

  // Get a real shipment with communications
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .not('booking_number', 'is', null)
    .limit(1)
    .single();

  if (!shipment) {
    console.log('No shipment found for testing');
    return;
  }

  console.log(`\nUsing shipment: ${shipment.booking_number} (${shipment.id})`);

  // Get recent communications
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, occurred_at, direction, from_party, document_type, summary, has_issue, issue_type, has_action, action_description, thread_id')
    .eq('shipment_id', shipment.id)
    .order('occurred_at', { ascending: false })
    .limit(20);

  if (!chronicles || chronicles.length === 0) {
    console.log('No communications found for this shipment');
    return;
  }

  console.log(`Found ${chronicles.length} communications\n`);

  // Convert to CommunicationItem format
  const communications: CommunicationItem[] = chronicles.map((c, i) => ({
    id: c.id,
    occurredAt: c.occurred_at,
    direction: c.direction,
    fromParty: c.from_party,
    documentType: c.document_type,
    summary: c.summary,
    hasIssue: c.has_issue,
    issueType: c.issue_type,
    hasAction: c.has_action,
    actionDescription: c.action_description,
    threadId: c.thread_id,
  }));

  // Run semantic grouping
  const result = await groupingService.groupCommunications(shipment.id, communications);

  console.log(`Semantic Grouping Results:`);
  console.log(`   Total groups: ${result.groups.length}`);
  console.log(`   Historical context items: ${result.historicalContext.length}`);
  console.log(`   Ungrouped count: ${result.ungroupedCount}\n`);

  // Show groups
  for (const group of result.groups) {
    const statusIcon = group.isOngoing ? '🔴' : '✅';
    console.log(`\n${statusIcon} ${group.topic} (${group.topicType})`);
    console.log(`   ${group.communications.length} messages, ${group.summary}`);
    console.log(`   Date range: ${new Date(group.oldestDate).toLocaleDateString()} - ${new Date(group.newestDate).toLocaleDateString()}`);
  }

  // Show historical context
  if (result.historicalContext.length > 0) {
    console.log('\n📜 Historical Context:');
    for (const ctx of result.historicalContext) {
      console.log(`   ${new Date(ctx.occurredAt).toLocaleDateString()} [${ctx.documentType}] ${ctx.summary.substring(0, 50)}... (${Math.round(ctx.similarity * 100)}% relevant to "${ctx.relevantTo}")`);
    }
  }

  // Show prompt section preview
  console.log('\n📝 Prompt Section Preview:');
  const promptSection = groupingService.buildPromptSection(result);
  console.log(promptSection.substring(0, 500) + '...');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║           SEMANTIC ENHANCEMENTS TEST                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  await testActionRulesVectorIntent();
  await testLearnFromSimilar();
  await testSemanticGrouping();

  console.log('\n' + '='.repeat(70));
  console.log('ALL TESTS COMPLETE');
  console.log('='.repeat(70));
}

main().catch(e => console.error('Test error:', e));
