/**
 * Compare Document Journey vs Email Journey
 *
 * Builds two parallel timelines for each shipment:
 * 1. Document Journey - based on document_type (what's attached)
 * 2. Email Journey - based on email_type (sender's intent)
 *
 * Uses LLM judge to find insights from the comparison.
 *
 * Usage:
 *   npx tsx scripts/compare-doc-vs-email-journey.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic();

// Document type to workflow state mapping
const DOC_TO_STATE: Record<string, string> = {
  booking_confirmation: 'booking_confirmed',
  booking_amendment: 'booking_amended',
  booking_cancellation: 'booking_cancelled',
  shipping_instruction: 'si_submitted',
  si_confirmation: 'si_confirmed',
  si_draft: 'si_draft_sent',
  vgm_confirmation: 'vgm_submitted',
  draft_hbl: 'bl_draft_received',
  hbl: 'bl_received',
  draft_mbl: 'bl_draft_received',
  mbl: 'bl_received',
  sob_confirmation: 'departed',
  arrival_notice: 'arrival_notice_received',
  delivery_order: 'delivery_order_received',
  gate_in_confirmation: 'container_gated_in',
  pod_confirmation: 'delivered',
  isf_filing: 'isf_filed',
  us_customs_7501: 'customs_cleared',
  us_customs_3461: 'customs_entry_filed',
};

// Email type to workflow action mapping
const EMAIL_TO_ACTION: Record<string, string> = {
  // Status updates
  status_update: 'status_communicated',
  shipment_notification: 'notification_received',
  milestone_update: 'milestone_communicated',

  // Requests/Actions
  approval_request: 'approval_requested',
  action_required: 'action_needed',
  urgent_action: 'urgent_action_needed',

  // Confirmations
  confirmation: 'confirmed',
  acknowledgement: 'acknowledged',

  // Document sharing
  document_sharing: 'document_shared',
  draft_review: 'draft_sent_for_review',

  // Issues
  exception_notice: 'exception_raised',
  escalation: 'escalated',
  amendment_request: 'amendment_requested',

  // General
  inquiry: 'inquiry_received',
  response: 'response_sent',
  general_correspondence: 'correspondence',
  unknown: 'unknown_intent',
};

interface JourneyEvent {
  timestamp: string;
  documentType: string;
  documentState: string | null;
  emailType: string;
  emailAction: string | null;
  sender: string;
  senderCategory: string;
  subject: string;
  sentiment: string;
  direction: string;
}

interface ShipmentJourney {
  bookingNumber: string;
  events: JourneyEvent[];
  documentTimeline: string[];
  emailTimeline: string[];
}

async function getShipmentJourneys(limit: number = 5): Promise<ShipmentJourney[]> {
  // Target specific shipments we analyzed before for comparison
  const targetBookings = ['34864426', '263629283', '263814897', '19207547', 'CAD0850107'];

  // Get these specific shipments first
  const { data: targetShipments } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .in('booking_number', targetBookings);

  // Then get more shipments if needed
  const { data: otherShipments } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .not('booking_number', 'is', null)
    .not('booking_number', 'in', `(${targetBookings.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(20);

  const shipments = [...(targetShipments || []), ...(otherShipments || [])];

  const journeys: ShipmentJourney[] = [];

  for (const ship of shipments || []) {
    // Get all documents with raw emails
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select(`
        id,
        document_type,
        email_id,
        raw_emails!shipment_documents_email_id_fkey(
          id,
          received_at,
          sender_email,
          subject,
          email_direction
        )
      `)
      .eq('shipment_id', ship.id)
      .not('email_id', 'is', null);

    if (!docs || docs.length < 3) continue;

    // Get classifications separately for each email
    const emailIds = docs.map(d => d.email_id).filter(Boolean);
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id, email_type, email_category, sender_category, sentiment, document_direction')
      .in('email_id', emailIds);

    // Create a map for quick lookup
    const classMap = new Map<string, any>();
    for (const c of classifications || []) {
      classMap.set(c.email_id, c);
    }

    const events: JourneyEvent[] = [];

    for (const doc of docs) {
      const email = (doc as any).raw_emails;
      const classification = classMap.get(doc.email_id);

      if (!email) continue;

      const emailType = classification?.email_type || 'not_classified';

      events.push({
        timestamp: email.received_at,
        documentType: doc.document_type,
        documentState: DOC_TO_STATE[doc.document_type] || null,
        emailType: emailType,
        emailAction: EMAIL_TO_ACTION[emailType] || null,
        sender: email.sender_email?.substring(0, 40) || '',
        senderCategory: classification?.sender_category || 'unknown',
        subject: email.subject?.substring(0, 50) || '',
        sentiment: classification?.sentiment || 'neutral',
        direction: classification?.document_direction || email.email_direction || 'unknown',
      });
    }

    // Sort by timestamp
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Build timelines
    const documentTimeline = events
      .filter(e => e.documentState)
      .map(e => `${new Date(e.timestamp).toISOString().substring(0, 16)} | ${e.documentState} (${e.documentType})`);

    const emailTimeline = events
      .filter(e => e.emailAction)
      .map(e => `${new Date(e.timestamp).toISOString().substring(0, 16)} | ${e.emailAction} (${e.emailType}) [${e.sentiment}]`);

    journeys.push({
      bookingNumber: ship.booking_number,
      events,
      documentTimeline,
      emailTimeline,
    });

    if (journeys.length >= limit) break;
  }

  return journeys;
}

async function analyzeWithLLM(journey: ShipmentJourney): Promise<{
  insights: string[];
  documentScore: number;
  emailScore: number;
  combinedScore: number;
  recommendation: string;
}> {
  const prompt = `You are a freight forwarding operations expert analyzing shipment journeys.

SHIPMENT: ${journey.bookingNumber}

## DOCUMENT JOURNEY (What documents were shared)
${journey.documentTimeline.join('\n') || 'No document states mapped'}

## EMAIL JOURNEY (What senders intended to communicate)
${journey.emailTimeline.join('\n') || 'No email types mapped'}

## ALL EVENTS (chronological)
${journey.events.map(e =>
  `${new Date(e.timestamp).toISOString().substring(0, 16)} | ` +
  `DOC: ${e.documentType.padEnd(25)} | ` +
  `EMAIL: ${e.emailType.padEnd(20)} | ` +
  `${e.direction.padEnd(8)} | ` +
  `${e.senderCategory.padEnd(15)} | ` +
  `${e.sentiment}`
).join('\n')}

Analyze these two parallel journeys and answer:

1. **COHERENCE**: Do document states and email intents align? (e.g., "booking_confirmation" document with "confirmation" email type = coherent)

2. **GAPS**: What's missing?
   - Document journey gaps (missing milestones)
   - Email journey gaps (missing confirmations/acknowledgements)

3. **ANOMALIES**: What doesn't make sense?
   - Document type doesn't match email intent
   - Sentiment doesn't match document type (e.g., "urgent" on a standard confirmation)
   - Sender category doesn't match document type (e.g., shipper sending MBL)

4. **INSIGHTS**: What can we learn by comparing these two views?
   - Does email type provide context document type misses?
   - Does sentiment reveal issues document type doesn't capture?

5. **SCORES** (0-10):
   - Document Journey Quality: How complete/logical is the document sequence?
   - Email Journey Quality: How coherent is the communication flow?
   - Combined Score: Overall shipment visibility quality

Respond in JSON format:
{
  "coherent_pairs": ["doc_type + email_type pairs that align well"],
  "mismatched_pairs": ["doc_type + email_type pairs that don't align"],
  "document_gaps": ["missing document milestones"],
  "email_gaps": ["missing email communications"],
  "anomalies": ["things that don't make sense"],
  "key_insights": ["actionable insights from comparing both views"],
  "document_score": 0-10,
  "email_score": 0-10,
  "combined_score": 0-10,
  "recommendation": "one sentence improvement suggestion"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Extract JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      insights: [
        ...(result.coherent_pairs || []).map((p: string) => `✓ Coherent: ${p}`),
        ...(result.mismatched_pairs || []).map((p: string) => `✗ Mismatch: ${p}`),
        ...(result.anomalies || []).map((a: string) => `⚠️ Anomaly: ${a}`),
        ...(result.key_insights || []).map((i: string) => `💡 Insight: ${i}`),
      ],
      documentScore: result.document_score || 0,
      emailScore: result.email_score || 0,
      combinedScore: result.combined_score || 0,
      recommendation: result.recommendation || '',
    };
  } catch (error) {
    console.error('LLM analysis failed:', error);
    return {
      insights: ['Analysis failed'],
      documentScore: 0,
      emailScore: 0,
      combinedScore: 0,
      recommendation: 'Manual review needed',
    };
  }
}

async function main() {
  console.log('DOCUMENT VS EMAIL JOURNEY COMPARISON');
  console.log('='.repeat(80));
  console.log('');

  console.log('Loading shipment journeys...');
  const journeys = await getShipmentJourneys(5);
  console.log(`Found ${journeys.length} shipments with sufficient data\n`);

  const results: Array<{
    booking: string;
    docScore: number;
    emailScore: number;
    combinedScore: number;
  }> = [];

  for (const journey of journeys) {
    console.log('─'.repeat(80));
    console.log(`📦 SHIPMENT: ${journey.bookingNumber}`);
    console.log(`   Events: ${journey.events.length}`);
    console.log('─'.repeat(80));

    // Show side-by-side comparison
    console.log('\n📄 DOCUMENT JOURNEY:');
    for (const line of journey.documentTimeline.slice(0, 10)) {
      console.log(`   ${line}`);
    }
    if (journey.documentTimeline.length > 10) {
      console.log(`   ... and ${journey.documentTimeline.length - 10} more`);
    }

    console.log('\n📧 EMAIL JOURNEY:');
    for (const line of journey.emailTimeline.slice(0, 10)) {
      console.log(`   ${line}`);
    }
    if (journey.emailTimeline.length > 10) {
      console.log(`   ... and ${journey.emailTimeline.length - 10} more`);
    }

    // LLM Analysis
    console.log('\n🤖 LLM ANALYSIS:');
    const analysis = await analyzeWithLLM(journey);

    console.log(`   Document Score: ${analysis.documentScore}/10`);
    console.log(`   Email Score: ${analysis.emailScore}/10`);
    console.log(`   Combined Score: ${analysis.combinedScore}/10`);
    console.log(`\n   Insights:`);
    for (const insight of analysis.insights.slice(0, 8)) {
      console.log(`   ${insight}`);
    }
    console.log(`\n   Recommendation: ${analysis.recommendation}`);

    results.push({
      booking: journey.bookingNumber,
      docScore: analysis.documentScore,
      emailScore: analysis.emailScore,
      combinedScore: analysis.combinedScore,
    });

    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const avgDocScore = results.reduce((sum, r) => sum + r.docScore, 0) / results.length;
  const avgEmailScore = results.reduce((sum, r) => sum + r.emailScore, 0) / results.length;
  const avgCombined = results.reduce((sum, r) => sum + r.combinedScore, 0) / results.length;

  console.log(`\nAverage Scores:`);
  console.log(`  Document Journey: ${avgDocScore.toFixed(1)}/10`);
  console.log(`  Email Journey: ${avgEmailScore.toFixed(1)}/10`);
  console.log(`  Combined: ${avgCombined.toFixed(1)}/10`);

  console.log(`\nPer Shipment:`);
  for (const r of results) {
    console.log(`  ${r.booking}: Doc=${r.docScore}/10, Email=${r.emailScore}/10, Combined=${r.combinedScore}/10`);
  }

  // Key insight
  if (avgEmailScore > avgDocScore) {
    console.log('\n💡 KEY INSIGHT: Email journey provides better visibility than document journey alone.');
    console.log('   Consider using email_type + sentiment for more accurate workflow state detection.');
  } else if (avgDocScore > avgEmailScore) {
    console.log('\n💡 KEY INSIGHT: Document journey is more reliable than email journey.');
    console.log('   Focus on improving document classification accuracy.');
  } else {
    console.log('\n💡 KEY INSIGHT: Document and email journeys are comparable.');
    console.log('   Combining both views may provide the most complete picture.');
  }
}

main().catch(console.error);
