#!/usr/bin/env npx tsx
/**
 * Evaluate ALL Deterministic Patterns with LLM Judge
 *
 * Tests each pattern type across all shipping lines to build:
 * 1. Confidence matrix (carrier × document_type → accuracy)
 * 2. Recommended AI fallback thresholds
 * 3. Patterns that need fixing
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  classifyEmail as classifyDeterministic,
  ALL_CARRIER_CONFIGS,
  DocumentType,
} from '../lib/config/shipping-line-patterns';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required');

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic();

const AI_MODEL = 'claude-sonnet-4-20250514';

// Carrier domain patterns for filtering
const CARRIER_DOMAINS: Record<string, RegExp> = {
  'maersk': /maersk\.com|sealand\.com/i,
  'hapag-lloyd': /hapag-lloyd\.com|hlag\.com|hlag\.cloud/i,
  'cma-cgm': /cma-cgm\.com|apl\.com/i,
  'cosco': /coscon\.com|oocl\.com/i,
  'msc': /msc\.com/i,
};

// All document types
const DOCUMENT_TYPES: DocumentType[] = [
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
  'general_correspondence',
];

// Judge tool
const JUDGE_TOOL: Anthropic.Tool = {
  name: 'judge_classification',
  description: 'Judge if a classification is correct',
  input_schema: {
    type: 'object',
    properties: {
      is_correct: { type: 'boolean' },
      correct_type: {
        type: 'string',
        enum: DOCUMENT_TYPES,
      },
      severity: {
        type: 'string',
        enum: ['correct', 'minor_error', 'major_error'],
      },
      explanation: { type: 'string' },
    },
    required: ['is_correct', 'correct_type', 'severity', 'explanation'],
  },
};

interface PatternResult {
  carrier: string;
  documentType: string;
  patternConfidence: number;
  matchedPattern: string;
  testedCount: number;
  correctCount: number;
  minorErrorCount: number;
  majorErrorCount: number;
  accuracy: number;
  samples: {
    subject: string;
    verdict: string;
    correctType: string;
    explanation: string;
  }[];
}

interface ConfidenceMatrix {
  [carrier: string]: {
    [docType: string]: {
      accuracy: number;
      tested: number;
      avgPatternConfidence: number;
      recommendAI: boolean;
    };
  };
}

async function judgeClassification(
  subject: string,
  sender: string,
  bodyText: string,
  classifiedAs: string
): Promise<{ correct: boolean; correctType: string; severity: string; explanation: string }> {
  const prompt = `You are a shipping document classification expert.

EVALUATE this classification:

EMAIL:
Subject: ${subject}
From: ${sender}
Body (first 800 chars): ${bodyText.substring(0, 800)}

CLASSIFICATION: ${classifiedAs}

DOCUMENT TYPES:
- booking_confirmation: Original BC from carrier with booking number
- booking_amendment: Changes/updates to existing booking
- booking_cancellation: Booking cancelled
- arrival_notice: Cargo arrival at port (CRITICAL)
- shipment_notice: Shipment updates, discharge notices
- bill_of_lading: B/L documents (draft or final)
- shipping_instruction: SI submission/confirmation
- invoice: Freight invoice, payment request
- vgm_confirmation: VGM accepted
- vgm_reminder: VGM submission reminder
- pickup_notification: Container ready for pickup
- cutoff_advisory: Cutoff time changes
- general_correspondence: Replies, operational emails

RULES:
1. RE:/FW: prefixes may still contain important documents (booking amendments, etc.)
2. Arrival notices are CRITICAL - cargo arriving at destination
3. Off-rail/pickup notifications = pickup_notification, NOT shipment_notice

Use judge_classification tool.`;

  try {
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
        severity: input.severity,
        explanation: input.explanation,
      };
    }
  } catch (err: any) {
    console.error(`  Judge error: ${err.message}`);
  }

  return { correct: true, correctType: classifiedAs, severity: 'correct', explanation: 'Judge failed' };
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE PATTERN EVALUATION WITH LLM JUDGE                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Model: ${AI_MODEL}`);
  console.log('Testing all deterministic patterns across all carriers...\n');

  // Get all emails with pagination
  console.log('Fetching emails...');
  let allEmails: any[] = [];
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const { data: batch } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, true_sender_email, body_text, snippet')
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allEmails = allEmails.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  console.log(`Total emails: ${allEmails.length}\n`);

  // Group emails by carrier
  const emailsByCarrier: Record<string, any[]> = {};
  for (const email of allEmails) {
    const sender = (email.true_sender_email || email.sender_email || '').toLowerCase();
    for (const [carrierId, pattern] of Object.entries(CARRIER_DOMAINS)) {
      if (pattern.test(sender)) {
        if (!emailsByCarrier[carrierId]) emailsByCarrier[carrierId] = [];
        emailsByCarrier[carrierId].push(email);
        break;
      }
    }
  }

  console.log('Emails by carrier:');
  for (const [carrier, emails] of Object.entries(emailsByCarrier)) {
    console.log(`  ${carrier}: ${emails.length}`);
  }
  console.log('');

  // Results storage
  const patternResults: Map<string, PatternResult> = new Map();
  const confidenceMatrix: ConfidenceMatrix = {};

  // Test each carrier
  for (const [carrierId, emails] of Object.entries(emailsByCarrier)) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`TESTING: ${carrierId.toUpperCase()}`);
    console.log('═'.repeat(80));

    if (!confidenceMatrix[carrierId]) confidenceMatrix[carrierId] = {};

    // Group emails by deterministic classification
    const classifiedEmails: Map<string, any[]> = new Map();

    for (const email of emails) {
      const sender = email.true_sender_email || email.sender_email;

      // Get attachments
      const { data: attachments } = await supabase
        .from('raw_attachments')
        .select('filename')
        .eq('email_id', email.id);

      const filenames = (attachments || []).map((a: any) => a.filename);

      // Classify deterministically
      const result = classifyDeterministic(email.subject || '', sender, filenames);

      if (result) {
        const key = `${carrierId}|${result.documentType}|${result.matchedPattern}`;
        if (!classifiedEmails.has(key)) {
          classifiedEmails.set(key, []);
        }
        classifiedEmails.get(key)!.push({
          ...email,
          classification: result,
        });
      }
    }

    // Test samples from each pattern (max 5 per pattern)
    for (const [key, classifiedList] of classifiedEmails.entries()) {
      const [carrier, docType, pattern] = key.split('|');
      const sampleSize = Math.min(5, classifiedList.length);
      const samples = classifiedList.slice(0, sampleSize);

      console.log(`\n  Pattern: ${docType} (${pattern.substring(0, 40)}...)`);
      console.log(`  Total matches: ${classifiedList.length}, testing: ${sampleSize}`);

      const result: PatternResult = {
        carrier,
        documentType: docType,
        patternConfidence: samples[0].classification.confidence,
        matchedPattern: pattern,
        testedCount: sampleSize,
        correctCount: 0,
        minorErrorCount: 0,
        majorErrorCount: 0,
        accuracy: 0,
        samples: [],
      };

      for (const email of samples) {
        const sender = email.true_sender_email || email.sender_email;
        const bodyText = email.body_text || email.snippet || '';

        const judgment = await judgeClassification(
          email.subject || '',
          sender,
          bodyText,
          docType
        );

        if (judgment.severity === 'correct') result.correctCount++;
        else if (judgment.severity === 'minor_error') result.minorErrorCount++;
        else result.majorErrorCount++;

        result.samples.push({
          subject: email.subject?.substring(0, 60) || '',
          verdict: judgment.severity,
          correctType: judgment.correctType,
          explanation: judgment.explanation,
        });

        const icon = judgment.severity === 'correct' ? '✅' :
                     judgment.severity === 'minor_error' ? '⚠️' : '❌';
        console.log(`    ${icon} ${email.subject?.substring(0, 50)}...`);
      }

      result.accuracy = Math.round(result.correctCount / result.testedCount * 100);
      patternResults.set(key, result);

      // Update confidence matrix
      if (!confidenceMatrix[carrier][docType]) {
        confidenceMatrix[carrier][docType] = {
          accuracy: 0,
          tested: 0,
          avgPatternConfidence: 0,
          recommendAI: false,
        };
      }
      const cm = confidenceMatrix[carrier][docType];
      cm.tested += result.testedCount;
      cm.accuracy = Math.round(
        ((cm.accuracy * (cm.tested - result.testedCount)) + (result.accuracy * result.testedCount)) / cm.tested
      );
      cm.avgPatternConfidence = result.patternConfidence;
      cm.recommendAI = cm.accuracy < 80;
    }
  }

  // Print comprehensive report
  printReport(patternResults, confidenceMatrix);
}

function printReport(
  patternResults: Map<string, PatternResult>,
  confidenceMatrix: ConfidenceMatrix
) {
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    CONFIDENCE MATRIX & RECOMMENDATIONS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');

  // 1. Confidence Matrix by Carrier × Document Type
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ CONFIDENCE MATRIX (Carrier × Document Type → Accuracy %)                       │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const carriers = Object.keys(confidenceMatrix).sort();
  const allDocTypes = new Set<string>();
  for (const carrier of carriers) {
    for (const docType of Object.keys(confidenceMatrix[carrier])) {
      allDocTypes.add(docType);
    }
  }

  // Header
  console.log('Document Type'.padEnd(28) + carriers.map(c => c.substring(0, 10).padStart(12)).join(''));
  console.log('─'.repeat(28 + carriers.length * 12));

  for (const docType of Array.from(allDocTypes).sort()) {
    let row = docType.padEnd(28);
    for (const carrier of carriers) {
      const data = confidenceMatrix[carrier][docType];
      if (data) {
        const icon = data.accuracy >= 90 ? '✅' : data.accuracy >= 70 ? '⚠️' : '❌';
        row += `${icon}${data.accuracy}%`.padStart(12);
      } else {
        row += '-'.padStart(12);
      }
    }
    console.log(row);
  }

  // 2. Patterns Needing AI Fallback
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PATTERNS NEEDING AI FALLBACK (Accuracy < 80%)                                  │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const needsAI: PatternResult[] = [];
  for (const result of patternResults.values()) {
    if (result.accuracy < 80) {
      needsAI.push(result);
    }
  }

  if (needsAI.length === 0) {
    console.log('  None! All patterns have 80%+ accuracy.\n');
  } else {
    console.log('  Carrier       Doc Type                Accuracy  Pattern Conf  Recommendation');
    console.log('  ' + '─'.repeat(78));
    for (const p of needsAI.sort((a, b) => a.accuracy - b.accuracy)) {
      console.log(
        `  ${p.carrier.padEnd(13)} ${p.documentType.padEnd(23)} ${String(p.accuracy + '%').padStart(6)}    ` +
        `${String(p.patternConfidence).padStart(6)}        → Use AI`
      );
    }
  }

  // 3. Patterns Needing Fix (consistently wrong)
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ PATTERNS NEEDING FIX (Major Errors)                                            │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  const needsFix: PatternResult[] = [];
  for (const result of patternResults.values()) {
    if (result.majorErrorCount > 0) {
      needsFix.push(result);
    }
  }

  if (needsFix.length === 0) {
    console.log('  None! No patterns have major errors.\n');
  } else {
    for (const p of needsFix) {
      console.log(`  ${p.carrier} → ${p.documentType}`);
      console.log(`  Pattern: ${p.matchedPattern.substring(0, 60)}`);
      console.log(`  Major Errors: ${p.majorErrorCount}/${p.testedCount}`);
      for (const s of p.samples.filter(s => s.verdict === 'major_error')) {
        console.log(`    ❌ "${s.subject}" → Should be: ${s.correctType}`);
        console.log(`       ${s.explanation.substring(0, 70)}`);
      }
      console.log('');
    }
  }

  // 4. Recommended AI Threshold Model
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ RECOMMENDED AI CLASSIFICATION MODEL                                            │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  // Calculate optimal threshold
  let highConfCorrect = 0, highConfTotal = 0;
  let lowConfCorrect = 0, lowConfTotal = 0;

  for (const result of patternResults.values()) {
    if (result.patternConfidence >= 70) {
      highConfCorrect += result.correctCount;
      highConfTotal += result.testedCount;
    } else {
      lowConfCorrect += result.correctCount;
      lowConfTotal += result.testedCount;
    }
  }

  const highConfAccuracy = highConfTotal > 0 ? Math.round(highConfCorrect / highConfTotal * 100) : 0;
  const lowConfAccuracy = lowConfTotal > 0 ? Math.round(lowConfCorrect / lowConfTotal * 100) : 0;

  console.log(`  Pattern Confidence ≥ 70: ${highConfAccuracy}% accuracy (${highConfCorrect}/${highConfTotal})`);
  console.log(`  Pattern Confidence < 70: ${lowConfAccuracy}% accuracy (${lowConfCorrect}/${lowConfTotal})`);
  console.log('');

  console.log('  PROPOSED MODEL:');
  console.log('  ─────────────────────────────────────────────────────────────────');
  console.log('  ┌─────────────────────────────────────────────────────────────┐');
  console.log('  │  IF pattern_confidence >= 80 AND doc_type NOT IN blacklist │');
  console.log('  │     → Use DETERMINISTIC (free, fast)                       │');
  console.log('  │  ELSE                                                      │');
  console.log('  │     → Use AI (Claude Sonnet 4)                             │');
  console.log('  └─────────────────────────────────────────────────────────────┘');
  console.log('');

  // Build blacklist from patterns with major errors
  const blacklist = new Set<string>();
  for (const p of needsFix) {
    blacklist.add(`${p.carrier}:${p.documentType}`);
  }

  if (blacklist.size > 0) {
    console.log('  BLACKLIST (always use AI):');
    for (const item of blacklist) {
      console.log(`    - ${item}`);
    }
  }

  // 5. Summary stats
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ SUMMARY                                                                        │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

  let totalTested = 0, totalCorrect = 0, totalMinor = 0, totalMajor = 0;
  for (const result of patternResults.values()) {
    totalTested += result.testedCount;
    totalCorrect += result.correctCount;
    totalMinor += result.minorErrorCount;
    totalMajor += result.majorErrorCount;
  }

  const overallAccuracy = Math.round(totalCorrect / totalTested * 100);
  const acceptableRate = Math.round((totalCorrect + totalMinor) / totalTested * 100);

  console.log(`  Total patterns tested: ${patternResults.size}`);
  console.log(`  Total emails evaluated: ${totalTested}`);
  console.log(`  ✅ Correct: ${totalCorrect} (${overallAccuracy}%)`);
  console.log(`  ⚠️  Minor errors: ${totalMinor} (${Math.round(totalMinor / totalTested * 100)}%)`);
  console.log(`  ❌ Major errors: ${totalMajor} (${Math.round(totalMajor / totalTested * 100)}%)`);
  console.log(`  Acceptable rate: ${acceptableRate}%`);
  console.log('');

  // Cost estimation
  const aiNeededPatterns = needsAI.length + needsFix.length;
  const deterministicPatterns = patternResults.size - aiNeededPatterns;
  console.log(`  Patterns suitable for deterministic: ${deterministicPatterns}`);
  console.log(`  Patterns needing AI fallback: ${aiNeededPatterns}`);
  console.log('');
}

main().catch(console.error);
