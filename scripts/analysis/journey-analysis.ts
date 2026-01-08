/**
 * Comprehensive Journey Analysis Script
 *
 * Analyzes shipment workflow journeys for:
 * 1. Time registration issues in raw_emails.received_at
 * 2. Thread navigation issues (RE:/FW: handling)
 * 3. Journey logic issues (backward state jumps)
 * 4. Specific problematic shipments
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
);

// State order for detecting backward jumps
const STATE_ORDER: Record<string, number> = {
  'draft': 0,
  'booking_confirmed': 1,
  'booking_amended': 2,
  'si_submitted': 3,
  'si_draft_sent': 4,
  'vgm_submitted': 5,
  'container_gated_in': 6,
  'bl_received': 7,
  'departed': 8,
  'in_transit': 9,
  'arrival_notice_received': 10,
  'delivery_order_received': 11,
  'delivered': 12
};

// Document type to state mapping
const DOC_TO_STATE: Record<string, { state: string; phase: string }> = {
  booking_confirmation: { state: 'booking_confirmed', phase: 'booking' },
  booking_amendment: { state: 'booking_amended', phase: 'booking' },
  shipping_instruction: { state: 'si_submitted', phase: 'pre_departure' },
  si_draft: { state: 'si_draft_sent', phase: 'pre_departure' },
  vgm_confirmation: { state: 'vgm_submitted', phase: 'pre_departure' },
  gate_in_confirmation: { state: 'container_gated_in', phase: 'pre_departure' },
  bill_of_lading: { state: 'bl_received', phase: 'pre_departure' },
  sob_confirmation: { state: 'departed', phase: 'in_transit' },
  shipment_notice: { state: 'departed', phase: 'in_transit' },
  arrival_notice: { state: 'arrival_notice_received', phase: 'arrival' },
  delivery_order: { state: 'delivery_order_received', phase: 'arrival' },
  proof_of_delivery: { state: 'delivered', phase: 'delivery' },
};

interface AnalysisResult {
  issue: string;
  severity: 'high' | 'medium' | 'low';
  count: number;
  examples: any[];
  recommendation: string;
}

const results: AnalysisResult[] = [];

async function analyzeTimeRegistration() {
  console.log('\n' + '='.repeat(80));
  console.log('1. TIME REGISTRATION ANALYSIS');
  console.log('='.repeat(80));

  // Check for emails with identical timestamps
  const { data: duplicateTimes } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT received_at, COUNT(*) as cnt
      FROM raw_emails
      GROUP BY received_at
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 10
    `
  });

  // Alternative query using Supabase client
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, received_at, subject, sender_email')
    .order('received_at', { ascending: false })
    .limit(1000);

  // Find duplicates manually
  const timeMap: Record<string, any[]> = {};
  for (const email of allEmails || []) {
    const ts = email.received_at;
    if (!timeMap[ts]) timeMap[ts] = [];
    timeMap[ts].push(email);
  }

  const duplicates = Object.entries(timeMap).filter(([_, emails]) => emails.length > 1);

  console.log('\n1.1 Emails with identical timestamps:');
  if (duplicates.length > 0) {
    console.log(`   Found ${duplicates.length} timestamp groups with duplicates`);
    for (const [ts, emails] of duplicates.slice(0, 5)) {
      console.log(`\n   Timestamp: ${ts}`);
      for (const e of emails) {
        console.log(`     - ${e.subject?.substring(0, 50)}...`);
      }
    }
    results.push({
      issue: 'Multiple emails with identical timestamps',
      severity: 'medium',
      count: duplicates.length,
      examples: duplicates.slice(0, 3).map(([ts, emails]) => ({ timestamp: ts, emails: emails.map(e => e.subject) })),
      recommendation: 'Check if Gmail API internal_date is being used correctly or if there is batching logic that assigns same timestamp'
    });
  } else {
    console.log('   No duplicate timestamps found');
  }

  // Check for suspicious patterns (many emails in same minute)
  console.log('\n1.2 Emails clustering in same minute:');
  const minuteMap: Record<string, number> = {};
  for (const email of allEmails || []) {
    const minute = email.received_at?.substring(0, 16); // YYYY-MM-DDTHH:MM
    if (minute) {
      minuteMap[minute] = (minuteMap[minute] || 0) + 1;
    }
  }

  const busyMinutes = Object.entries(minuteMap)
    .filter(([_, cnt]) => cnt > 5)
    .sort((a, b) => b[1] - a[1]);

  if (busyMinutes.length > 0) {
    console.log(`   Found ${busyMinutes.length} minutes with >5 emails:`);
    for (const [minute, count] of busyMinutes.slice(0, 5)) {
      console.log(`   - ${minute}: ${count} emails`);
    }
    results.push({
      issue: 'Many emails received in same minute (potential batch processing)',
      severity: 'low',
      count: busyMinutes.length,
      examples: busyMinutes.slice(0, 3),
      recommendation: 'Verify Gmail API internal_date parsing - ensure millisecond precision is preserved'
    });
  }

  // Check timezone handling
  console.log('\n1.3 Timezone analysis:');
  const timezones = new Set<string>();
  for (const email of allEmails || []) {
    if (email.received_at) {
      const match = email.received_at.match(/[+-]\d{2}:\d{2}$|Z$/);
      if (match) timezones.add(match[0]);
      else timezones.add('no-tz');
    }
  }
  console.log(`   Timezone suffixes found: ${Array.from(timezones).join(', ')}`);
}

async function analyzeThreadNavigation() {
  console.log('\n' + '='.repeat(80));
  console.log('2. THREAD NAVIGATION ANALYSIS');
  console.log('='.repeat(80));

  // Check for RE:/FW: patterns in subjects
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, thread_id, is_response, in_reply_to_message_id, sender_email, true_sender_email')
    .limit(2000);

  // Count RE:/FW: patterns
  const reEmails = (emails || []).filter(e => /^(RE|FW|Fwd):/i.test(e.subject || ''));
  const totalEmails = emails?.length || 0;

  console.log('\n2.1 RE:/FW: Email patterns:');
  console.log(`   Total emails analyzed: ${totalEmails}`);
  console.log(`   RE:/FW: emails: ${reEmails.length} (${((reEmails.length / totalEmails) * 100).toFixed(1)}%)`);

  // Check if is_response flag is set correctly
  const reWithoutFlag = reEmails.filter(e => !e.is_response);
  console.log(`   RE:/FW: emails WITHOUT is_response=true: ${reWithoutFlag.length}`);

  if (reWithoutFlag.length > 0) {
    results.push({
      issue: 'RE:/FW: emails not marked as is_response',
      severity: 'high',
      count: reWithoutFlag.length,
      examples: reWithoutFlag.slice(0, 3).map(e => ({ subject: e.subject, is_response: e.is_response })),
      recommendation: 'Update email ingestion to detect RE:/FW: patterns and set is_response=true'
    });
  }

  // Check thread grouping
  console.log('\n2.2 Thread analysis:');
  const threadsWithEmails = new Map<string, any[]>();
  for (const email of emails || []) {
    if (email.thread_id) {
      if (!threadsWithEmails.has(email.thread_id)) {
        threadsWithEmails.set(email.thread_id, []);
      }
      threadsWithEmails.get(email.thread_id)!.push(email);
    }
  }

  const multiEmailThreads = Array.from(threadsWithEmails.entries())
    .filter(([_, emails]) => emails.length > 1);

  console.log(`   Threads with multiple emails: ${multiEmailThreads.length}`);

  // Check for duplicate document links from same thread
  console.log('\n2.3 Checking for duplicate document links from same thread:');

  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('id, email_id, shipment_id, document_type');

  const emailIds = new Set((shipmentDocs || []).map(d => d.email_id));

  const { data: linkedEmails } = await supabase
    .from('raw_emails')
    .select('id, thread_id, subject')
    .in('id', Array.from(emailIds));

  // Group by thread and shipment
  const threadShipmentMap = new Map<string, Map<string, any[]>>();
  for (const doc of shipmentDocs || []) {
    const email = linkedEmails?.find(e => e.id === doc.email_id);
    if (email?.thread_id && doc.shipment_id) {
      const key = email.thread_id;
      if (!threadShipmentMap.has(key)) {
        threadShipmentMap.set(key, new Map());
      }
      const shipmentMap = threadShipmentMap.get(key)!;
      if (!shipmentMap.has(doc.shipment_id)) {
        shipmentMap.set(doc.shipment_id, []);
      }
      shipmentMap.get(doc.shipment_id)!.push({ ...doc, subject: email.subject });
    }
  }

  // Find threads with same document type linked multiple times
  let duplicateDocLinks = 0;
  const duplicateExamples: any[] = [];

  for (const [threadId, shipmentMap] of threadShipmentMap) {
    for (const [shipmentId, docs] of shipmentMap) {
      const docTypeCounts = new Map<string, number>();
      for (const doc of docs) {
        docTypeCounts.set(doc.document_type, (docTypeCounts.get(doc.document_type) || 0) + 1);
      }

      for (const [docType, count] of docTypeCounts) {
        if (count > 1) {
          duplicateDocLinks++;
          if (duplicateExamples.length < 3) {
            duplicateExamples.push({
              threadId,
              shipmentId: shipmentId.substring(0, 8),
              documentType: docType,
              count,
              subjects: docs.filter(d => d.document_type === docType).map(d => d.subject?.substring(0, 40))
            });
          }
        }
      }
    }
  }

  console.log(`   Duplicate document type links from same thread: ${duplicateDocLinks}`);
  if (duplicateDocLinks > 0) {
    results.push({
      issue: 'Same document type linked multiple times from same email thread',
      severity: 'high',
      count: duplicateDocLinks,
      examples: duplicateExamples,
      recommendation: 'Deduplicate documents within threads - only link unique document types per thread'
    });
  }

  // Check true_sender_email usage
  console.log('\n2.4 True sender vs sender email analysis:');
  const withTrueSender = (emails || []).filter(e => e.true_sender_email && e.true_sender_email !== e.sender_email);
  console.log(`   Emails with different true_sender: ${withTrueSender.length}`);

  if (withTrueSender.length > 0) {
    console.log('   Examples:');
    for (const e of withTrueSender.slice(0, 3)) {
      console.log(`     - sender: ${e.sender_email}, true_sender: ${e.true_sender_email}`);
    }
  }
}

async function analyzeJourneyLogic() {
  console.log('\n' + '='.repeat(80));
  console.log('3. JOURNEY LOGIC ANALYSIS');
  console.log('='.repeat(80));

  // Get all shipments with their documents
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase, status');

  console.log(`\n3.1 Analyzing ${shipments?.length || 0} shipments for backward state jumps...`);

  const backwardJumps: any[] = [];

  for (const shipment of shipments || []) {
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type, email_id')
      .eq('shipment_id', shipment.id);

    if (!docs || docs.length < 2) continue;

    // Get email timestamps
    const emailIds = docs.map(d => d.email_id);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, received_at')
      .in('id', emailIds);

    // Build timeline
    const timeline: { date: Date; docType: string; state: string }[] = [];
    for (const doc of docs) {
      const email = emails?.find(e => e.id === doc.email_id);
      const mapping = DOC_TO_STATE[doc.document_type];
      if (email?.received_at && mapping) {
        timeline.push({
          date: new Date(email.received_at),
          docType: doc.document_type,
          state: mapping.state
        });
      }
    }

    // Sort by date
    timeline.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Check for backward jumps
    let maxStateOrder = -1;
    for (const item of timeline) {
      const stateOrder = STATE_ORDER[item.state] ?? -1;
      if (stateOrder < maxStateOrder) {
        backwardJumps.push({
          bookingNumber: shipment.booking_number,
          shipmentId: shipment.id.substring(0, 8),
          timeline: timeline.map(t => ({
            date: t.date.toISOString().split('T')[0],
            docType: t.docType,
            state: t.state
          }))
        });
        break;
      }
      if (stateOrder > maxStateOrder) {
        maxStateOrder = stateOrder;
      }
    }
  }

  console.log(`   Shipments with backward state jumps: ${backwardJumps.length}`);

  if (backwardJumps.length > 0) {
    console.log('\n   Examples of backward jumps:');
    for (const jump of backwardJumps.slice(0, 5)) {
      console.log(`\n   Booking: ${jump.bookingNumber}`);
      for (const item of jump.timeline) {
        console.log(`     ${item.date} | ${item.docType.padEnd(25)} | ${item.state}`);
      }
    }

    results.push({
      issue: 'Shipments with backward state jumps in timeline',
      severity: 'high',
      count: backwardJumps.length,
      examples: backwardJumps.slice(0, 3),
      recommendation: 'Investigate whether documents are being linked to wrong shipments or timestamps are incorrect'
    });
  }

  // Check for misclassified document types
  console.log('\n3.2 Document type distribution analysis:');
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('document_type');

  const docCounts: Record<string, number> = {};
  for (const d of allDocs || []) {
    docCounts[d.document_type] = (docCounts[d.document_type] || 0) + 1;
  }

  console.log('   Document types linked:');
  for (const [type, count] of Object.entries(docCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${type.padEnd(30)}: ${count}`);
  }
}

async function analyzeSpecificShipments() {
  console.log('\n' + '='.repeat(80));
  console.log('4. SPECIFIC SHIPMENT ANALYSIS');
  console.log('='.repeat(80));

  const problematicIds = ['263629283', '19207547', 'CAD0850107'];

  for (const searchId of problematicIds) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Analyzing shipment: ${searchId}`);
    console.log('─'.repeat(60));

    // Try to find by booking number
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .or(`booking_number.ilike.%${searchId}%,bl_number.ilike.%${searchId}%`)
      .single();

    if (!shipment) {
      console.log(`   NOT FOUND - Shipment ${searchId} does not exist in database`);
      continue;
    }

    console.log(`   Found: ${shipment.booking_number}`);
    console.log(`   Current workflow_state: ${shipment.workflow_state}`);
    console.log(`   Current status: ${shipment.status}`);

    // Get documents with timeline
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type, email_id, created_at')
      .eq('shipment_id', shipment.id);

    if (!docs || docs.length === 0) {
      console.log('   No documents linked');
      continue;
    }

    const emailIds = docs.map(d => d.email_id);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, received_at, subject, sender_email, true_sender_email')
      .in('id', emailIds);

    console.log('\n   Document timeline:');
    const timeline: any[] = [];
    for (const doc of docs) {
      const email = emails?.find(e => e.id === doc.email_id);
      timeline.push({
        date: email?.received_at,
        docType: doc.document_type,
        subject: email?.subject?.substring(0, 50),
        sender: email?.true_sender_email || email?.sender_email
      });
    }

    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (const item of timeline) {
      const date = item.date ? new Date(item.date).toISOString().split('T')[0] : 'N/A';
      console.log(`     ${date} | ${item.docType.padEnd(25)} | ${item.subject}...`);
    }

    // Check for issues
    const states = timeline.map(t => DOC_TO_STATE[t.docType]?.state).filter(Boolean);
    let maxOrder = -1;
    let hasBackwardJump = false;

    for (const state of states) {
      const order = STATE_ORDER[state] ?? -1;
      if (order < maxOrder) {
        hasBackwardJump = true;
        console.log(`\n   ISSUE DETECTED: State "${state}" appears AFTER a later state`);
      }
      if (order > maxOrder) maxOrder = order;
    }

    if (!hasBackwardJump) {
      console.log('\n   No backward state jumps detected in this shipment');
    }
  }
}

async function generateSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY & RECOMMENDATIONS');
  console.log('='.repeat(80));

  if (results.length === 0) {
    console.log('\nNo significant issues found!');
    return;
  }

  const highSeverity = results.filter(r => r.severity === 'high');
  const mediumSeverity = results.filter(r => r.severity === 'medium');
  const lowSeverity = results.filter(r => r.severity === 'low');

  console.log(`\nTotal issues found: ${results.length}`);
  console.log(`  High severity: ${highSeverity.length}`);
  console.log(`  Medium severity: ${mediumSeverity.length}`);
  console.log(`  Low severity: ${lowSeverity.length}`);

  console.log('\n' + '-'.repeat(80));
  console.log('HIGH SEVERITY ISSUES:');
  console.log('-'.repeat(80));

  for (const issue of highSeverity) {
    console.log(`\n[HIGH] ${issue.issue}`);
    console.log(`       Count: ${issue.count}`);
    console.log(`       Recommendation: ${issue.recommendation}`);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('MEDIUM SEVERITY ISSUES:');
  console.log('-'.repeat(80));

  for (const issue of mediumSeverity) {
    console.log(`\n[MEDIUM] ${issue.issue}`);
    console.log(`         Count: ${issue.count}`);
    console.log(`         Recommendation: ${issue.recommendation}`);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('ROOT CAUSE ANALYSIS:');
  console.log('-'.repeat(80));

  console.log(`
Based on the analysis, the main issues causing incorrect journey display are:

1. THREAD HANDLING:
   - RE:/FW: emails may be treated as new documents rather than updates
   - Same document type linked multiple times from same email thread
   - FIX: Deduplicate by thread_id + document_type + shipment_id

2. TIMESTAMP ISSUES:
   - Emails may have incorrect received_at if batch processed
   - Check Gmail API internal_date vs internalDate (milliseconds)
   - FIX: Ensure proper timezone handling and millisecond precision

3. STATE LOGIC:
   - Documents being linked after they were already processed
   - Journey shows events out of logical order
   - FIX: Use document_date (if available) or email received_at for ordering

4. DOCUMENT LINKING:
   - Multiple emails about same booking being linked incorrectly
   - Amendments/updates creating duplicate document links
   - FIX: Use revision tracking to only show latest version
`);
}

async function main() {
  console.log('='.repeat(80));
  console.log('SHIPMENT JOURNEY ANALYSIS');
  console.log('='.repeat(80));
  console.log('Analyzing database for workflow journey issues...\n');

  try {
    await analyzeTimeRegistration();
    await analyzeThreadNavigation();
    await analyzeJourneyLogic();
    await analyzeSpecificShipments();
    await generateSummary();
  } catch (error) {
    console.error('Error during analysis:', error);
  }
}

main().catch(console.error);
