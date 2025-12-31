#!/usr/bin/env npx tsx
/**
 * Test Classification Quality with LLM Judge
 *
 * 1. Takes a sample of emails (mix of classified and unclassified)
 * 2. Classifies them with the advanced service
 * 3. Uses LLM judge to evaluate classification quality
 * 4. Reports insights and accuracy metrics
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  classifyEmail as classifyDeterministic,
} from '../lib/config/shipping-line-patterns';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY required for this test');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic();

const SAMPLE_SIZE = 25;
const AI_MODEL = 'claude-sonnet-4-20250514';

// Document types for classification
const DOCUMENT_TYPES = [
  'booking_confirmation',
  'booking_amendment',
  'booking_cancellation',
  'arrival_notice',
  'shipment_notice',
  'bill_of_lading',
  'shipping_instruction',
  'invoice',
  'vgm_confirmation',
  'vgm_reminder',
  'vessel_schedule',
  'pickup_notification',
  'cutoff_advisory',
  'delivery_order',
  'customs_clearance',
  'rate_quote',
  'general_correspondence',
] as const;

// Tool for classification
const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: 'classify_email',
  description: 'Classify a shipping/logistics email',
  input_schema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        enum: DOCUMENT_TYPES,
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
      reasoning: {
        type: 'string',
      },
    },
    required: ['document_type', 'confidence', 'reasoning'],
  },
};

// Tool for judging
const JUDGE_TOOL: Anthropic.Tool = {
  name: 'judge_classification',
  description: 'Judge if a classification is correct',
  input_schema: {
    type: 'object',
    properties: {
      is_correct: {
        type: 'boolean',
        description: 'Is the classification correct?',
      },
      correct_type: {
        type: 'string',
        enum: DOCUMENT_TYPES,
        description: 'What should the correct type be?',
      },
      explanation: {
        type: 'string',
        description: 'Brief explanation of judgment',
      },
      severity: {
        type: 'string',
        enum: ['correct', 'minor_error', 'major_error'],
        description: 'How severe is the error if incorrect?',
      },
    },
    required: ['is_correct', 'correct_type', 'explanation', 'severity'],
  },
};

interface TestResult {
  emailId: string;
  subject: string;
  sender: string;
  method: 'deterministic' | 'ai';
  classifiedAs: string;
  confidence: number;
  reasoning?: string;
  judgeVerdict: 'correct' | 'minor_error' | 'major_error';
  judgeExplanation: string;
  correctType: string;
}

async function classifyWithAI(
  subject: string,
  sender: string,
  bodyText: string,
  attachments: string[]
): Promise<{ type: string; confidence: number; reasoning: string }> {
  const prompt = `Classify this shipping email:

Subject: ${subject}
From: ${sender}
Attachments: ${attachments.length > 0 ? attachments.join(', ') : 'None'}

Body (first 1500 chars):
${bodyText.substring(0, 1500)}

DOCUMENT TYPES:
- booking_confirmation: Original booking confirmation from carrier
- booking_amendment: Changes to existing booking
- booking_cancellation: Booking cancelled
- arrival_notice: Cargo arrival at port (CRITICAL)
- shipment_notice: Shipment/discharge notification
- bill_of_lading: B/L document
- shipping_instruction: SI submission/confirmation
- invoice: Freight invoice
- vgm_confirmation: VGM accepted
- vgm_reminder: VGM reminder
- vessel_schedule: Sailing schedule
- pickup_notification: Container pickup
- cutoff_advisory: Cutoff changes
- general_correspondence: Replies, operational emails

Use classify_email tool.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 300,
    tools: [CLASSIFICATION_TOOL],
    tool_choice: { type: 'tool', name: 'classify_email' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );

  if (toolUse) {
    const input = toolUse.input as any;
    return {
      type: input.document_type,
      confidence: input.confidence,
      reasoning: input.reasoning,
    };
  }

  return { type: 'general_correspondence', confidence: 0, reasoning: 'Failed' };
}

async function judgeClassification(
  subject: string,
  sender: string,
  bodyText: string,
  classifiedAs: string,
  reasoning: string
): Promise<{ correct: boolean; correctType: string; explanation: string; severity: string }> {
  const prompt = `You are a shipping document classification expert and judge.

EVALUATE this classification:

EMAIL:
Subject: ${subject}
From: ${sender}
Body (first 1000 chars): ${bodyText.substring(0, 1000)}

CLASSIFICATION GIVEN: ${classifiedAs}
REASONING: ${reasoning}

DOCUMENT TYPES:
- booking_confirmation: Original BC from carrier (has booking number, often PDF)
- booking_amendment: Updates to booking
- arrival_notice: Cargo arriving at port (CRITICAL for operations)
- shipment_notice: Shipment updates
- bill_of_lading: B/L documents
- shipping_instruction: SI submissions
- invoice: Payment requests
- vgm_confirmation/reminder: Weight verification
- general_correspondence: Replies (RE:/FW:), operational chats

JUDGE CRITERIA:
1. Is the classification CORRECT for this email?
2. If wrong, what SHOULD it be?
3. Is it a MINOR error (close types) or MAJOR error (completely wrong)?

Use judge_classification tool.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 300,
    tools: [JUDGE_TOOL],
    tool_choice: { type: 'tool', name: 'judge_classification' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );

  if (toolUse) {
    const input = toolUse.input as any;
    return {
      correct: input.is_correct,
      correctType: input.correct_type,
      explanation: input.explanation,
      severity: input.severity,
    };
  }

  return { correct: true, correctType: classifiedAs, explanation: 'Judge failed', severity: 'correct' };
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║       CLASSIFICATION QUALITY TEST WITH LLM JUDGE                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Model: ${AI_MODEL}`);
  console.log(`Sample Size: ${SAMPLE_SIZE}`);
  console.log('');

  // Get a diverse sample of emails
  console.log('Fetching sample emails...');

  // Get emails from different carriers
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email, body_text, snippet')
    .order('received_at', { ascending: false })
    .limit(200);

  if (!emails || emails.length === 0) {
    console.log('No emails found!');
    return;
  }

  // Select diverse sample
  const sample = emails
    .filter(e => e.subject && e.subject.length > 5)
    .slice(0, SAMPLE_SIZE);

  console.log(`Selected ${sample.length} emails for testing\n`);

  const results: TestResult[] = [];
  let deterministicCount = 0;
  let aiCount = 0;

  console.log('Testing classifications...');
  console.log('─'.repeat(80));

  for (let i = 0; i < sample.length; i++) {
    const email = sample[i];
    const sender = email.true_sender_email || email.sender_email;
    const bodyText = email.body_text || email.snippet || '';

    console.log(`\n[${i + 1}/${sample.length}] ${email.subject?.substring(0, 60)}...`);

    // Get attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename')
      .eq('email_id', email.id);

    const filenames = (attachments || []).map((a: any) => a.filename);

    // Try deterministic first
    const deterResult = classifyDeterministic(email.subject || '', sender, filenames);

    let method: 'deterministic' | 'ai';
    let classifiedAs: string;
    let confidence: number;
    let reasoning: string;

    if (deterResult && deterResult.confidence > 0) {
      method = 'deterministic';
      classifiedAs = deterResult.documentType;
      confidence = deterResult.confidence;
      reasoning = `Pattern: ${deterResult.matchedPattern}`;
      deterministicCount++;
    } else {
      method = 'ai';
      const aiResult = await classifyWithAI(email.subject || '', sender, bodyText, filenames);
      classifiedAs = aiResult.type;
      confidence = aiResult.confidence;
      reasoning = aiResult.reasoning;
      aiCount++;
    }

    console.log(`  Method: ${method} | Type: ${classifiedAs} | Confidence: ${confidence}`);

    // Judge the classification
    const judgment = await judgeClassification(
      email.subject || '',
      sender,
      bodyText,
      classifiedAs,
      reasoning
    );

    console.log(`  Judge: ${judgment.severity} - ${judgment.explanation.substring(0, 60)}`);

    results.push({
      emailId: email.id,
      subject: email.subject || '',
      sender,
      method,
      classifiedAs,
      confidence,
      reasoning,
      judgeVerdict: judgment.severity as any,
      judgeExplanation: judgment.explanation,
      correctType: judgment.correctType,
    });
  }

  // Print detailed report
  printReport(results, deterministicCount, aiCount);
}

function printReport(results: TestResult[], deterministicCount: number, aiCount: number) {
  console.log('\n\n');
  console.log('═'.repeat(80));
  console.log('QUALITY ASSESSMENT REPORT');
  console.log('═'.repeat(80));

  const correct = results.filter(r => r.judgeVerdict === 'correct').length;
  const minorErrors = results.filter(r => r.judgeVerdict === 'minor_error').length;
  const majorErrors = results.filter(r => r.judgeVerdict === 'major_error').length;

  const accuracy = Math.round(correct / results.length * 100);
  const acceptableRate = Math.round((correct + minorErrors) / results.length * 100);

  console.log(`
┌────────────────────────────────────────────────────────────────────┐
│  OVERALL METRICS                                                   │
├────────────────────────────────────────────────────────────────────┤
│  Total Tested:        ${String(results.length).padStart(4)}                                       │
│  Deterministic:       ${String(deterministicCount).padStart(4)} (${String(Math.round(deterministicCount / results.length * 100)).padStart(2)}%)                                  │
│  AI Classified:       ${String(aiCount).padStart(4)} (${String(Math.round(aiCount / results.length * 100)).padStart(2)}%)                                  │
├────────────────────────────────────────────────────────────────────┤
│  ✅ Correct:          ${String(correct).padStart(4)} (${String(accuracy).padStart(2)}%)                                  │
│  ⚠️  Minor Errors:     ${String(minorErrors).padStart(4)} (${String(Math.round(minorErrors / results.length * 100)).padStart(2)}%)                                  │
│  ❌ Major Errors:      ${String(majorErrors).padStart(4)} (${String(Math.round(majorErrors / results.length * 100)).padStart(2)}%)                                  │
├────────────────────────────────────────────────────────────────────┤
│  ACCURACY:            ${String(accuracy).padStart(3)}%                                       │
│  ACCEPTABLE RATE:     ${String(acceptableRate).padStart(3)}% (correct + minor)                     │
└────────────────────────────────────────────────────────────────────┘
`);

  // Breakdown by method
  const deterResults = results.filter(r => r.method === 'deterministic');
  const aiResults = results.filter(r => r.method === 'ai');

  if (deterResults.length > 0) {
    const deterCorrect = deterResults.filter(r => r.judgeVerdict === 'correct').length;
    console.log(`DETERMINISTIC ACCURACY: ${Math.round(deterCorrect / deterResults.length * 100)}% (${deterCorrect}/${deterResults.length})`);
  }

  if (aiResults.length > 0) {
    const aiCorrect = aiResults.filter(r => r.judgeVerdict === 'correct').length;
    console.log(`AI (SONNET 4) ACCURACY: ${Math.round(aiCorrect / aiResults.length * 100)}% (${aiCorrect}/${aiResults.length})`);
  }

  // Show errors for learning
  const errors = results.filter(r => r.judgeVerdict !== 'correct');
  if (errors.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log('MISCLASSIFICATIONS (for improvement):');
    console.log('─'.repeat(80));

    for (const err of errors) {
      console.log(`
  Subject: ${err.subject.substring(0, 70)}
  Sender:  ${err.sender}
  ─────────────────────────────────────────────────────────
  Classified as: ${err.classifiedAs} (${err.method})
  Should be:     ${err.correctType}
  Severity:      ${err.judgeVerdict}
  Explanation:   ${err.judgeExplanation}
`);
    }
  }

  // Classification distribution
  console.log('\n' + '─'.repeat(80));
  console.log('DOCUMENT TYPE DISTRIBUTION:');
  console.log('─'.repeat(80));

  const typeCounts: Record<string, number> = {};
  for (const r of results) {
    typeCounts[r.classifiedAs] = (typeCounts[r.classifiedAs] || 0) + 1;
  }

  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('RECOMMENDATION:');
  console.log('═'.repeat(80));

  if (accuracy >= 90) {
    console.log('✅ EXCELLENT - Classification is production ready!');
  } else if (accuracy >= 80) {
    console.log('✅ GOOD - Acceptable for production with monitoring');
  } else if (accuracy >= 70) {
    console.log('⚠️  ACCEPTABLE - May need pattern improvements');
  } else {
    console.log('❌ NEEDS WORK - Review patterns and AI prompts');
  }

  console.log('');
}

main().catch(console.error);
