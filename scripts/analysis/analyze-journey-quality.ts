/**
 * Analyze Journey Quality with LLM Judge
 *
 * Maps shipment journeys across multiple threads and uses an LLM
 * (freight forwarding expert persona) to validate logical correctness.
 *
 * Usage:
 *   npx tsx scripts/analyze-journey-quality.ts
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Logical order of shipping milestones
const MILESTONE_ORDER = [
  'booking_confirmed',
  'booking_amended',
  'si_draft_sent',
  'si_submitted',
  'vgm_submitted',
  'container_gated_in',
  'bl_received',
  'departed',
  'arrival_notice_received',
  'delivery_order_received',
  'delivered',
];

// Content Classification types mapping (matches workflow-state-service.ts)
// Using inbound direction as default since most carrier emails are inbound
const DOC_TO_STATE: Record<string, string> = {
  // Booking
  booking_confirmation: 'booking_confirmed',
  booking_amendment: 'booking_confirmed',

  // SI Flow
  si_draft: 'si_draft_sent',
  shipping_instruction: 'si_submitted',
  si_confirmation: 'si_submitted',

  // Pre-departure
  vgm_confirmation: 'vgm_submitted',
  gate_in_confirmation: 'container_gated_in',

  // Departure - ONLY sob_confirmation is departure!
  sob_confirmation: 'departed',

  // BL (content classification types)
  mbl: 'bl_received',
  hbl: 'bl_received',
  draft_mbl: 'bl_draft_received',
  draft_hbl: 'bl_draft_received',

  // Arrival
  arrival_notice: 'arrival_notice_received',
  // shipment_status does NOT map to arrival - it's informational only

  // Delivery
  delivery_order: 'delivery_order_received',
  proof_of_delivery: 'delivered',
  container_release: 'container_released',
  empty_return: 'empty_returned',
};

interface JourneyEvent {
  date: string;
  time: string;
  state: string;
  docType: string;
  subject: string;
  threadId: string;
  isResponse: boolean;
  emailId: string;
}

interface ShipmentJourney {
  bookingNumber: string;
  shipmentId: string;
  events: JourneyEvent[];
  uniqueThreads: number;
  totalDocs: number;
  issues: string[];
}

interface LLMJudgment {
  isValid: boolean;
  score: number; // 1-10
  issues: string[];
  suggestions: string[];
}

async function main() {
  console.log('JOURNEY QUALITY ANALYSIS WITH LLM JUDGE');
  console.log('='.repeat(70));
  console.log('');

  // Step 1: Get 10 shipments with most documents
  console.log('Step 1: Finding shipments with documents...');
  const shipments = await getShipmentsWithDocuments(10);
  console.log(`  Found ${shipments.length} shipments`);
  console.log('');

  // Step 2: Build journeys for each
  console.log('Step 2: Building journeys...');
  const journeys: ShipmentJourney[] = [];

  for (const ship of shipments) {
    const journey = await buildShipmentJourney(ship.id, ship.booking_number);
    journeys.push(journey);
    console.log(`  ${ship.booking_number}: ${journey.events.length} events, ${journey.uniqueThreads} threads`);
  }
  console.log('');

  // Step 3: Pre-analyze for obvious issues
  console.log('Step 3: Pre-analyzing for logical issues...');
  for (const journey of journeys) {
    analyzeJourneyLogic(journey);
  }
  console.log('');

  // Step 4: LLM Judge evaluation
  console.log('Step 4: LLM Judge evaluation...');
  const judgments: Map<string, LLMJudgment> = new Map();

  for (const journey of journeys) {
    if (journey.events.length === 0) {
      console.log(`  ${journey.bookingNumber}: No events to judge`);
      continue;
    }

    console.log(`  Judging ${journey.bookingNumber}...`);
    const judgment = await llmJudgeJourney(journey);
    judgments.set(journey.bookingNumber, judgment);
    console.log(`    Score: ${judgment.score}/10, Valid: ${judgment.isValid}`);
  }
  console.log('');

  // Step 5: Summary Report
  console.log('='.repeat(70));
  console.log('SUMMARY REPORT');
  console.log('='.repeat(70));
  console.log('');

  let totalScore = 0;
  let judgedCount = 0;
  const allIssues: Array<{ booking: string; issue: string }> = [];

  for (const journey of journeys) {
    console.log(`\n📦 ${journey.bookingNumber}`);
    console.log(`   Documents: ${journey.totalDocs} | Threads: ${journey.uniqueThreads} | Events: ${journey.events.length}`);

    // Show journey timeline
    if (journey.events.length > 0) {
      console.log('   Timeline:');
      for (const event of journey.events.slice(0, 8)) {
        const threadMarker = journey.uniqueThreads > 1 ? ` [T${event.threadId.substring(0, 6)}]` : '';
        console.log(`     ${event.date} ${event.time} | ${event.state}${threadMarker}`);
      }
      if (journey.events.length > 8) {
        console.log(`     ... and ${journey.events.length - 8} more events`);
      }
    }

    // Show pre-analysis issues
    if (journey.issues.length > 0) {
      console.log('   ⚠️ Pre-analysis issues:');
      for (const issue of journey.issues) {
        console.log(`     - ${issue}`);
        allIssues.push({ booking: journey.bookingNumber, issue });
      }
    }

    // Show LLM judgment
    const judgment = judgments.get(journey.bookingNumber);
    if (judgment) {
      totalScore += judgment.score;
      judgedCount++;
      console.log(`   🤖 LLM Score: ${judgment.score}/10`);
      if (judgment.issues.length > 0) {
        console.log('   LLM Issues:');
        for (const issue of judgment.issues) {
          console.log(`     - ${issue}`);
          allIssues.push({ booking: journey.bookingNumber, issue: `[LLM] ${issue}` });
        }
      }
      if (judgment.suggestions.length > 0) {
        console.log('   Suggestions:');
        for (const suggestion of judgment.suggestions) {
          console.log(`     💡 ${suggestion}`);
        }
      }
    }
  }

  // Overall summary
  console.log('\n' + '='.repeat(70));
  console.log('OVERALL METRICS');
  console.log('='.repeat(70));
  console.log(`Average LLM Score: ${judgedCount > 0 ? (totalScore / judgedCount).toFixed(1) : 'N/A'}/10`);
  console.log(`Total Issues Found: ${allIssues.length}`);
  console.log('');

  // Group issues by type
  const issueTypes: Record<string, number> = {};
  for (const { issue } of allIssues) {
    const type = categorizeIssue(issue);
    issueTypes[type] = (issueTypes[type] || 0) + 1;
  }

  console.log('Issues by Type:');
  for (const [type, count] of Object.entries(issueTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Return issues for potential fixing
  return allIssues;
}

async function getShipmentsWithDocuments(limit: number): Promise<Array<{ id: string; booking_number: string }>> {
  // Get shipments with document counts
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, shipments!shipment_documents_shipment_id_fkey(id, booking_number)')
    .not('shipment_id', 'is', null);

  // Count by shipment
  const counts = new Map<string, { id: string; booking: string; count: number }>();
  for (const d of docs || []) {
    const ship = (d as any).shipments;
    if (ship?.booking_number) {
      const existing = counts.get(ship.id) || { id: ship.id, booking: ship.booking_number, count: 0 };
      existing.count++;
      counts.set(ship.id, existing);
    }
  }

  // Sort by count and take top N
  const sorted = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return sorted.map(s => ({ id: s.id, booking_number: s.booking }));
}

async function buildShipmentJourney(shipmentId: string, bookingNumber: string): Promise<ShipmentJourney> {
  // Get all documents with email details
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('document_type, email_id, raw_emails!shipment_documents_email_id_fkey(id, thread_id, received_at, subject, is_response)')
    .eq('shipment_id', shipmentId);

  const events: JourneyEvent[] = [];
  const threadIds = new Set<string>();

  for (const d of docs || []) {
    const email = (d as any).raw_emails;
    if (!email?.received_at) continue;

    const state = DOC_TO_STATE[d.document_type];
    if (!state) continue;

    const dt = new Date(email.received_at);
    threadIds.add(email.thread_id || 'standalone');

    events.push({
      date: dt.toISOString().split('T')[0],
      time: dt.toTimeString().substring(0, 5),
      state,
      docType: d.document_type,
      subject: email.subject || '',
      threadId: email.thread_id || 'standalone',
      isResponse: email.is_response || false,
      emailId: email.id,
    });
  }

  // Sort by date/time
  events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // Deduplicate - keep first occurrence of each state
  const seenStates = new Set<string>();
  const uniqueEvents: JourneyEvent[] = [];
  for (const event of events) {
    if (!seenStates.has(event.state)) {
      uniqueEvents.push(event);
      seenStates.add(event.state);
    }
  }

  return {
    bookingNumber,
    shipmentId,
    events: uniqueEvents,
    uniqueThreads: threadIds.size,
    totalDocs: docs?.length || 0,
    issues: [],
  };
}

function analyzeJourneyLogic(journey: ShipmentJourney): void {
  const events = journey.events;
  if (events.length === 0) return;

  // Check 1: Does journey start with booking?
  if (events.length > 0 && events[0].state !== 'booking_confirmed' && events[0].state !== 'booking_amended') {
    journey.issues.push(`Journey doesn't start with booking - starts with ${events[0].state}`);
  }

  // Check 2: Out of order milestones
  for (let i = 1; i < events.length; i++) {
    const prevIdx = MILESTONE_ORDER.indexOf(events[i - 1].state);
    const currIdx = MILESTONE_ORDER.indexOf(events[i].state);

    // Skip if state not in our order list
    if (prevIdx === -1 || currIdx === -1) continue;

    // Check for major out-of-order (skipping 2+ phases backwards)
    if (currIdx < prevIdx - 1) {
      // Allow some backwards (amendments can come after SI)
      if (!(events[i].state === 'booking_amended' && prevIdx <= 5)) {
        journey.issues.push(`Out of order: ${events[i - 1].state} → ${events[i].state}`);
      }
    }
  }

  // Check 3: Arrival before departure
  const departedIdx = events.findIndex(e => e.state === 'departed');
  const arrivalIdx = events.findIndex(e => e.state === 'arrival_notice_received');
  if (departedIdx !== -1 && arrivalIdx !== -1 && arrivalIdx < departedIdx) {
    journey.issues.push('Arrival notice received BEFORE departure - likely misclassification');
  }

  // Check 4: Delivery before arrival
  const deliveryIdx = events.findIndex(e => e.state === 'delivery_order_received' || e.state === 'delivered');
  if (arrivalIdx !== -1 && deliveryIdx !== -1 && deliveryIdx < arrivalIdx) {
    journey.issues.push('Delivery before arrival notice - likely misclassification');
  }

  // Check 5: Multiple threads - check if cross-linking might have occurred
  if (journey.uniqueThreads > 3) {
    journey.issues.push(`High thread count (${journey.uniqueThreads}) - verify no cross-linking`);
  }
}

async function llmJudgeJourney(journey: ShipmentJourney): Promise<LLMJudgment> {
  const journeyDescription = journey.events
    .map(e => `${e.date} ${e.time}: ${e.state} (${e.docType}) - "${e.subject.substring(0, 50)}"`)
    .join('\n');

  const prompt = `You are a freight forwarding expert reviewing a shipment's document journey for logical correctness.

SHIPMENT: ${journey.bookingNumber}
DOCUMENTS: ${journey.totalDocs}
THREADS: ${journey.uniqueThreads}

JOURNEY TIMELINE:
${journeyDescription}

PRE-IDENTIFIED ISSUES:
${journey.issues.length > 0 ? journey.issues.join('\n') : 'None'}

Please evaluate this journey and respond in JSON format:
{
  "isValid": true/false,
  "score": 1-10,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1"]
}

EVALUATION CRITERIA:
1. Logical sequence: booking → SI → VGM → gate-in → BL → departure → arrival → delivery
2. Timing: Events should be in chronological order matching the shipping process
3. Completeness: Key milestones present (booking, departure, arrival for completed shipments)
4. Cross-linking: Subject lines should reference the same booking number
5. Classifications: Document types should match their subjects

Be strict but fair. Score 8+ means good quality, 5-7 has minor issues, below 5 has major problems.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      // Extract JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          isValid: result.isValid ?? false,
          score: result.score ?? 5,
          issues: result.issues ?? [],
          suggestions: result.suggestions ?? [],
        };
      }
    }
  } catch (error) {
    console.error('    LLM error:', error instanceof Error ? error.message : 'Unknown');
  }

  return {
    isValid: false,
    score: 0,
    issues: ['Failed to get LLM judgment'],
    suggestions: [],
  };
}

function categorizeIssue(issue: string): string {
  const lower = issue.toLowerCase();
  if (lower.includes('order') || lower.includes('sequence')) return 'Out of Order';
  if (lower.includes('booking') && lower.includes('start')) return 'Missing Booking Start';
  if (lower.includes('arrival') && lower.includes('departure')) return 'Arrival Before Departure';
  if (lower.includes('cross-link') || lower.includes('thread')) return 'Thread/Cross-linking';
  if (lower.includes('misclass')) return 'Misclassification';
  if (lower.includes('missing')) return 'Missing Milestone';
  return 'Other';
}

main().catch(console.error);
