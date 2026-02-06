/**
 * Deep Dive Demo: Semantic Enhancements
 * Shows detailed examples of how vector intent detection and semantic grouping work
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
// DEMO 1: Vector Intent Detection - Deep Dive
// ============================================================================

async function demoVectorIntentDetection() {
  console.log('\n' + '═'.repeat(80));
  console.log('DEMO 1: VECTOR INTENT DETECTION - Deep Dive');
  console.log('═'.repeat(80));
  console.log('\nHow it works:');
  console.log('1. Pre-embed 5 "action required" anchor texts and 5 "no action" anchor texts');
  console.log('2. For each new email, generate embedding and compare against anchors');
  console.log('3. Use cosine similarity to determine intent (threshold: 75%)');
  console.log('4. Require 5% margin between action/no-action for confidence\n');

  const actionRulesService = new ActionRulesService(supabase);
  const embeddingService = createEmbeddingService(supabase);
  actionRulesService.setEmbeddingService(embeddingService);

  // Test emails with varying intent signals
  const testEmails = [
    {
      name: 'Clear Action Request',
      subject: 'Urgent: SI Amendment Required',
      body: `Dear Team,

We have reviewed the shipping instructions and found discrepancies in the consignee details.
Please update the following fields urgently:
- Consignee name spelling
- Contact phone number
- Delivery address

This requires your immediate attention as the SI cutoff is tomorrow.

Best regards,
Carrier Operations`,
    },
    {
      name: 'Subtle Action Request',
      subject: 'RE: Booking 12345 Status',
      body: `Hi,

Just following up on our earlier discussion about the cargo weights.
Would appreciate your input on the VGM submission timeline.
Let me know your thoughts when you get a chance.

Thanks`,
    },
    {
      name: 'Pure Notification',
      subject: 'Booking Confirmation - BKG123456',
      body: `This is an automated confirmation.

Your booking has been confirmed successfully.
Booking Number: BKG123456
Vessel: APL MERLION
ETD: February 15, 2026

This email is for your records only. No response needed.

Thank you for choosing our services.`,
    },
    {
      name: 'Completion Notification',
      subject: 'RE: VGM Submission',
      body: `Dear Sir/Madam,

We have received your VGM submission. All weights have been verified and accepted.
The verification process is now complete.

Thank you for your prompt submission.

Best regards,
VGM Team`,
    },
    {
      name: 'Ambiguous Email',
      subject: 'Update on Shipment',
      body: `Hello,

The vessel has arrived at port as scheduled.
Customs clearance is in progress.
We will keep you posted on the release status.

Regards,
Operations`,
    },
  ];

  console.log('─'.repeat(80));

  for (const email of testEmails) {
    console.log(`\n📧 Test Case: "${email.name}"`);
    console.log(`   Subject: ${email.subject}`);
    console.log(`   Body Preview: ${email.body.substring(0, 100).replace(/\n/g, ' ')}...`);

    const result = await actionRulesService.determineAction(
      'general_communication', // Use generic type to test fallback to vector
      email.subject,
      email.body
    );

    const status = result.hasAction ? '⚡ ACTION REQUIRED' : '✅ NO ACTION';
    console.log(`\n   Result: ${status}`);
    console.log(`   Source: ${result.source}`);
    console.log(`   Confidence: ${result.confidence}%`);
    console.log(`   Reason: ${result.reason}`);
    if (result.flipKeyword) {
      console.log(`   Trigger: ${result.flipKeyword}`);
    }
    console.log('─'.repeat(80));
  }
}

// ============================================================================
// DEMO 2: Learning from Similar Emails - Deep Dive
// ============================================================================

async function demoLearnFromSimilar() {
  console.log('\n' + '═'.repeat(80));
  console.log('DEMO 2: LEARNING FROM SIMILAR EMAILS - Deep Dive');
  console.log('═'.repeat(80));
  console.log('\nHow it works:');
  console.log('1. Search for semantically similar past emails (similarity > 80%)');
  console.log('2. Look up what actions were taken on those emails');
  console.log('3. Weight votes by similarity score');
  console.log('4. Return recommendation if consistency > 40%\n');

  const embeddingService = createEmbeddingService(supabase);

  // Find some real emails to use as test cases
  const { data: sampleEmails } = await supabase
    .from('chronicle')
    .select('id, subject, summary, document_type, has_action, action_completed_at')
    .not('embedding', 'is', null)
    .limit(5);

  if (!sampleEmails || sampleEmails.length === 0) {
    console.log('No emails with embeddings found for demo');
    return;
  }

  console.log('Using real emails from database to find similar ones:\n');
  console.log('─'.repeat(80));

  for (const email of sampleEmails.slice(0, 3)) {
    console.log(`\n📧 Source Email: ${email.document_type}`);
    console.log(`   Subject: ${email.subject?.substring(0, 60)}...`);
    console.log(`   Has Action: ${email.has_action ? 'Yes' : 'No'}`);

    // Find similar emails
    const searchText = `${email.subject} ${email.summary}`.substring(0, 300);
    const similar = await embeddingService.searchGlobal(searchText, {
      limit: 5,
      minSimilarity: 0.75,
    });

    console.log(`\n   Found ${similar.length} similar emails:`);

    for (const sim of similar) {
      if (sim.id === email.id) continue; // Skip self

      // Get action data
      const { data: simData } = await supabase
        .from('chronicle')
        .select('has_action, action_completed_at, document_type')
        .eq('id', sim.id)
        .single();

      const simPct = Math.round(sim.similarity * 100);
      const actionStatus = simData?.has_action
        ? (simData?.action_completed_at ? '✅ Had action (completed)' : '⚡ Had action (pending)')
        : '📋 No action';

      console.log(`     ${simPct}% | [${simData?.document_type || 'unknown'}] ${sim.subject?.substring(0, 40)}... → ${actionStatus}`);
    }
    console.log('─'.repeat(80));
  }
}

// ============================================================================
// DEMO 3: Semantic Grouping - Deep Dive
// ============================================================================

async function demoSemanticGrouping() {
  console.log('\n' + '═'.repeat(80));
  console.log('DEMO 3: SEMANTIC GROUPING - Deep Dive');
  console.log('═'.repeat(80));
  console.log('\nHow it works:');
  console.log('1. Classify each message by topic using keyword patterns');
  console.log('2. Group messages that share the same topic');
  console.log('3. Identify ongoing issues (has unresolved action/issue)');
  console.log('4. Search for relevant historical context beyond 7 days\n');

  const groupingService = createSemanticGroupingService(supabase);

  // Find a shipment with many communications
  const { data: shipments } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .not('shipment_id', 'is', null)
    .limit(100);

  // Count per shipment
  const counts = new Map<string, number>();
  for (const s of shipments || []) {
    counts.set(s.shipment_id, (counts.get(s.shipment_id) || 0) + 1);
  }

  // Find shipment with most communications
  let bestShipmentId = '';
  let maxCount = 0;
  for (const [id, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      bestShipmentId = id;
    }
  }

  if (!bestShipmentId) {
    console.log('No shipment with communications found');
    return;
  }

  // Get shipment details
  const { data: shipment } = await supabase
    .from('shipments')
    .select('booking_number, shipper_name, consignee_name, stage')
    .eq('id', bestShipmentId)
    .single();

  console.log(`Selected Shipment: ${shipment?.booking_number || bestShipmentId}`);
  console.log(`   Shipper: ${shipment?.shipper_name || 'N/A'}`);
  console.log(`   Consignee: ${shipment?.consignee_name || 'N/A'}`);
  console.log(`   Stage: ${shipment?.stage || 'N/A'}`);
  console.log(`   Total Communications: ${maxCount}`);
  console.log('─'.repeat(80));

  // Get communications
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, occurred_at, direction, from_party, document_type, summary, has_issue, issue_type, has_action, action_description, thread_id')
    .eq('shipment_id', bestShipmentId)
    .order('occurred_at', { ascending: false })
    .limit(30);

  if (!chronicles || chronicles.length === 0) {
    console.log('No communications found');
    return;
  }

  // Convert to CommunicationItem format
  const communications: CommunicationItem[] = chronicles.map(c => ({
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
  const result = await groupingService.groupCommunications(bestShipmentId, communications);

  console.log(`\n📊 Grouping Results:`);
  console.log(`   Groups Created: ${result.groups.length}`);
  console.log(`   Historical Context: ${result.historicalContext.length} items`);
  console.log(`   Ungrouped: ${result.ungroupedCount}`);

  // Show each group in detail
  console.log('\n' + '─'.repeat(80));
  console.log('DETAILED GROUP BREAKDOWN:');
  console.log('─'.repeat(80));

  for (const group of result.groups) {
    const statusIcon = group.isOngoing ? '🔴 ONGOING' : '✅ RESOLVED';
    const typeIcon = {
      'issue': '⚠️',
      'documentation': '📄',
      'status': '📍',
      'financial': '💰',
      'general': '💬',
    }[group.topicType] || '💬';

    console.log(`\n${typeIcon} ${group.topic} [${statusIcon}]`);
    console.log(`   Type: ${group.topicType}`);
    console.log(`   Messages: ${group.communications.length}`);
    console.log(`   Date Range: ${new Date(group.oldestDate).toLocaleDateString()} → ${new Date(group.newestDate).toLocaleDateString()}`);
    console.log(`   Summary: ${group.summary}`);

    console.log('\n   Messages in this group:');
    for (const msg of group.communications.slice(0, 5)) {
      const date = new Date(msg.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dir = msg.direction === 'inbound' ? '←' : '→';
      const flags = [];
      if (msg.hasIssue) flags.push(`🚨${msg.issueType}`);
      if (msg.hasAction) flags.push('⚡ACTION');
      const flagStr = flags.length > 0 ? ' ' + flags.join(' ') : '';

      console.log(`     ${date} ${dir} ${msg.fromParty}: ${msg.summary?.substring(0, 50) || 'No summary'}...${flagStr}`);
    }
    if (group.communications.length > 5) {
      console.log(`     ... and ${group.communications.length - 5} more messages`);
    }
  }

  // Show historical context
  if (result.historicalContext.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log('HISTORICAL CONTEXT (Older Relevant Messages):');
    console.log('─'.repeat(80));

    for (const ctx of result.historicalContext) {
      const date = new Date(ctx.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      console.log(`\n📜 ${date} [${ctx.documentType}]`);
      console.log(`   ${ctx.summary}`);
      console.log(`   Relevance: ${Math.round(ctx.similarity * 100)}% similar to "${ctx.relevantTo}"`);
    }
  }

  // Show the prompt section that would be sent to AI
  console.log('\n' + '─'.repeat(80));
  console.log('PROMPT SECTION FOR AI:');
  console.log('─'.repeat(80));
  console.log(groupingService.buildPromptSection(result));
}

// ============================================================================
// DEMO 4: Real Email Classification Examples
// ============================================================================

async function demoRealEmailClassification() {
  console.log('\n' + '═'.repeat(80));
  console.log('DEMO 4: REAL EMAIL CLASSIFICATION - Deep Dive');
  console.log('═'.repeat(80));
  console.log('\nShowing how different real emails are classified:\n');

  const actionRulesService = new ActionRulesService(supabase);
  const embeddingService = createEmbeddingService(supabase);
  actionRulesService.setEmbeddingService(embeddingService);

  // Get real emails with various document types
  const documentTypes = ['booking_confirmation', 'arrival_notice', 'exception_notice', 'invoice', 'draft_bl'];

  for (const docType of documentTypes) {
    const { data: emails } = await supabase
      .from('chronicle')
      .select('subject, summary, document_type, has_action, from_party')
      .eq('document_type', docType)
      .limit(2);

    if (!emails || emails.length === 0) continue;

    console.log(`\n📂 Document Type: ${docType.toUpperCase()}`);
    console.log('─'.repeat(60));

    for (const email of emails) {
      const result = await actionRulesService.determineAction(
        email.document_type || 'unknown',
        email.subject || '',
        email.summary || '',
        undefined,
        undefined,
        email.from_party || undefined
      );

      const dbAction = email.has_action ? '⚡ Has Action (DB)' : '✅ No Action (DB)';
      const calcAction = result.hasAction ? '⚡ ACTION' : '✅ NO ACTION';

      console.log(`\n   Subject: ${email.subject?.substring(0, 50)}...`);
      console.log(`   From: ${email.from_party || 'unknown'}`);
      console.log(`   Database: ${dbAction}`);
      console.log(`   Calculated: ${calcAction} (${result.source}, ${result.confidence}%)`);
      console.log(`   Reason: ${result.reason.substring(0, 70)}`);
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              SEMANTIC ENHANCEMENTS - DEEP DIVE DEMO                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  await demoVectorIntentDetection();
  await demoLearnFromSimilar();
  await demoSemanticGrouping();
  await demoRealEmailClassification();

  console.log('\n' + '═'.repeat(80));
  console.log('ALL DEMOS COMPLETE');
  console.log('═'.repeat(80));
}

main().catch(e => console.error('Demo error:', e));
