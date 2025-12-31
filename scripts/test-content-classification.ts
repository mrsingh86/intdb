/**
 * Content-Based Classification Test
 *
 * Classifies emails by analyzing PDF attachment CONTENT (not just subject/sender)
 * Uses LLM judge to validate accuracy
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

const anthropic = new Anthropic();

// Document type patterns based on PDF CONTENT
// Uses NEGATIVE lookahead to avoid false positives from boilerplate text
const CONTENT_PATTERNS: { type: string; patterns: RegExp[]; priority: number }[] = [
  // Invoice - HIGHEST priority
  // Hapag-Lloyd invoices have "I N V O I C E  NO.:" with spaced letters
  {
    type: 'invoice',
    patterns: [
      /I\s+N\s+V\s+O\s+I\s+C\s+E\s+NO/i,  // Hapag-Lloyd spaced header with NO
      /INVOICE\s+NO\.?\s*:\s*\d+/i,        // "INVOICE NO.: 12345"
      /^FREIGHT INVOICE/im,
      /^COMMERCIAL INVOICE/im,
      /^TAX INVOICE/im,
    ],
    priority: 100,
  },
  // Arrival Notice - HIGH priority (distinct from B/L)
  {
    type: 'arrival_notice',
    patterns: [
      /^ARRIVAL NOTICE/im,
      /^CARGO ARRIVAL/im,
      /^NOTICE OF ARRIVAL/im,
      /ARRIVAL\s+NOTICE\s+FOR/i,
    ],
    priority: 98,
  },
  // Customs Document - HIGH priority
  {
    type: 'customs_document',
    patterns: [
      /ENTRY SUMMARY/i,
      /CUSTOMS AND BORDER PROTECTION/i,
      /CBP FORM/i,
      /DUTY ENTRY/i,
      /CUSTOMS DECLARATION/i,
    ],
    priority: 97,
  },
  // Booking Confirmation - HIGH priority
  {
    type: 'booking_confirmation',
    patterns: [
      /^BOOKING CONFIRMATION/im,
      /BOOKING\s+CONFIRMATION\s+/i,
      /Booking Reference.*\d{8,}/i,
    ],
    priority: 96,
  },
  // Bill of Lading - LOWER priority
  // Avoid matching boilerplate "Bill of Lading" in terms text
  {
    type: 'bill_of_lading',
    patterns: [
      /^BILL OF LADING\s*$/im,     // Must be standalone heading
      /^MASTER BILL OF LADING/im,
      /^SEA\s*WAYBILL\s*$/im,
      /B\/L\s*(?:No|Number|#)\s*:\s*[A-Z]{4}\d+/i,  // Specific B/L number format
    ],
    priority: 90,
  },
  // Shipping Instruction
  {
    type: 'shipping_instruction',
    patterns: [
      /SHIPPING INSTRUCTION/i,
      /SI\s+SUBMISSION/i,
      /DRAFT SI/i,
    ],
    priority: 80,
  },
  // VGM
  {
    type: 'vgm_confirmation',
    patterns: [
      /VGM\s+(?:CONFIRMATION|SUBMISSION|DECLARATION)/i,
      /VERIFIED GROSS MASS/i,
    ],
    priority: 75,
  },
  // Delivery Order
  {
    type: 'delivery_order',
    patterns: [
      /DELIVERY ORDER/i,
      /D\/O\s*(?:No|Number|#)/i,
      /RELEASE ORDER/i,
    ],
    priority: 70,
  },
];

interface TestCase {
  emailId: string;
  subject: string;
  sender: string;
  carrier: string;
  filename: string;
  contentSample: string;
  contentClassification: string | null;
  matchedPattern: string | null;
  currentDbClassification: string;
}

interface JudgeResult {
  isCorrect: boolean;
  expectedType: string;
  confidence: number;
  reasoning: string;
}

function classifyByContent(content: string): { type: string; pattern: string } | null {
  if (!content || content.length < 50) return null;

  // Sort by priority descending
  const sorted = [...CONTENT_PATTERNS].sort((a, b) => b.priority - a.priority);

  for (const config of sorted) {
    for (const pattern of config.patterns) {
      if (pattern.test(content)) {
        return { type: config.type, pattern: pattern.source };
      }
    }
  }

  return null;
}

function detectCarrier(sender: string, content: string): string {
  const s = sender.toLowerCase();
  const c = content.toLowerCase();

  if (s.includes('maersk') || c.includes('maersk')) return 'maersk';
  if (s.includes('hlag') || s.includes('hapag') || c.includes('hapag-lloyd')) return 'hapag';
  if (s.includes('cma-cgm') || c.includes('cma cgm')) return 'cma-cgm';
  if (s.includes('coscon') || c.includes('cosco')) return 'cosco';
  if (s.includes('msc.com') || c.includes('msc mediterranean')) return 'msc';
  if (s.includes('evergreen') || c.includes('evergreen')) return 'evergreen';
  if (s.includes('one-line') || c.includes('ocean network express')) return 'one';
  return 'unknown';
}

async function getTestCases(): Promise<TestCase[]> {
  console.log('Fetching emails with PDF attachments...\n');

  // Get attachments with extracted text
  const { data: attachments, error } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, extracted_text')
    .not('extracted_text', 'is', null)
    .limit(500);

  if (error) {
    console.log('Query error:', error);
    return [];
  }

  if (!attachments || attachments.length === 0) {
    console.log('No attachments found');
    return [];
  }

  console.log(`Found ${attachments.length} attachments with text`);

  // Get email details - batch to avoid header overflow
  const emailIds = [...new Set(attachments.map(a => a.email_id))];
  console.log(`Unique email IDs: ${emailIds.length}`);

  const emails: any[] = [];
  const batchSize = 50;
  for (let i = 0; i < emailIds.length; i += batchSize) {
    const batch = emailIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, true_sender_email')
      .in('id', batch);

    if (error) {
      console.log('Email query error:', error);
      continue;
    }
    if (data) emails.push(...data);
  }

  if (emails.length === 0) {
    console.log('No emails found');
    return [];
  }
  console.log(`Emails found: ${emails.length}`);

  // Get current classifications - batch to avoid header overflow
  const classifications: any[] = [];
  for (let i = 0; i < emailIds.length; i += batchSize) {
    const batch = emailIds.slice(i, i + batchSize);
    const { data } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', batch);
    if (data) classifications.push(...data);
  }

  const classMap = new Map(classifications.map(c => [c.email_id, c.document_type]));
  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Build test cases - one per attachment
  const testCases: TestCase[] = [];
  const seenTypes = new Set<string>();
  let skipped = { noEmail: 0, tooMany: 0 };

  for (const att of attachments) {
    const email = emailMap.get(att.email_id);
    if (!email) {
      skipped.noEmail++;
      continue;
    }

    const content = att.extracted_text || '';
    const contentResult = classifyByContent(content);
    const carrier = detectCarrier(
      email.true_sender_email || email.sender_email || '',
      content
    );

    // Get diverse samples - limit per type
    const docType = contentResult?.type || 'unknown';
    const key = `${carrier}-${docType}`;
    const existingCount = testCases.filter(t => t.carrier === carrier && t.contentClassification === docType).length;
    if (existingCount >= 3) {
      skipped.tooMany++;
      continue;
    }
    seenTypes.add(key);

    if (testCases.length >= 30) {
      console.log(`\nSkipped: ${skipped.noEmail} no email, ${skipped.tooMany} too many samples`);
      break;
    }

    testCases.push({
      emailId: att.email_id,
      subject: email.subject || '',
      sender: email.true_sender_email || email.sender_email || '',
      carrier,
      filename: att.filename || '',
      contentSample: content.substring(0, 1500),
      contentClassification: contentResult?.type || null,
      matchedPattern: contentResult?.pattern || null,
      currentDbClassification: classMap.get(att.email_id) || 'unknown',
    });
  }

  return testCases;
}

async function judgeClassification(testCase: TestCase): Promise<JudgeResult> {
  const classifiedAs = testCase.contentClassification || 'unknown';

  const prompt = `You are evaluating a shipping document classification system that analyzes PDF content.

EMAIL:
- Subject: ${testCase.subject}
- Sender: ${testCase.sender}
- Carrier: ${testCase.carrier}
- Filename: ${testCase.filename}

PDF CONTENT (first 1000 chars):
${testCase.contentSample.substring(0, 1000)}

CLASSIFICATION:
- Content-based classification: ${classifiedAs}
- Matched pattern: ${testCase.matchedPattern || 'none'}
- Current DB classification: ${testCase.currentDbClassification}

VALID DOCUMENT TYPES:
- booking_confirmation: Carrier booking confirmation with booking number, vessel, ports, dates
- bill_of_lading: B/L document (draft, copy, original, sea waybill)
- arrival_notice: Cargo arrival notification
- invoice: Freight/commercial invoice with charges
- shipping_instruction: SI document
- vgm_confirmation: Verified Gross Mass confirmation
- delivery_order: D/O for cargo release
- unknown: Cannot determine from content

Is "${classifiedAs}" CORRECT based on the PDF content?

Return JSON:
{
  "isCorrect": true/false,
  "expectedType": "correct_type",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (error: any) {
    console.error('Judge error:', error.message);
  }

  return { isCorrect: false, expectedType: 'unknown', confidence: 0, reasoning: 'Judge failed' };
}

async function runTest() {
  console.log('='.repeat(80));
  console.log('CONTENT-BASED CLASSIFICATION TEST');
  console.log('Classifies by PDF content patterns, validated by LLM judge');
  console.log('='.repeat(80));

  const testCases = await getTestCases();
  console.log(`\nTesting ${testCases.length} documents...\n`);

  if (testCases.length === 0) {
    console.log('No test cases found. Check raw_attachments table.');
    return;
  }

  const results: Record<string, { correct: number; total: number; cases: any[] }> = {};
  const typeAccuracy: Record<string, { correct: number; total: number }> = {};

  for (const testCase of testCases) {
    const carrier = testCase.carrier;
    const docType = testCase.contentClassification || 'unknown';

    if (!results[carrier]) results[carrier] = { correct: 0, total: 0, cases: [] };
    if (!typeAccuracy[docType]) typeAccuracy[docType] = { correct: 0, total: 0 };

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Carrier: ${carrier.toUpperCase()} | File: ${testCase.filename}`);
    console.log(`Subject: ${testCase.subject.substring(0, 50)}...`);
    console.log(`Content Classification: ${docType}`);
    console.log(`Pattern: ${testCase.matchedPattern || 'none'}`);
    console.log(`DB Classification: ${testCase.currentDbClassification}`);

    const judgment = await judgeClassification(testCase);
    console.log(`\nJudge: ${judgment.isCorrect ? '✅' : '❌'} (${judgment.confidence}% confidence)`);
    if (!judgment.isCorrect) {
      console.log(`Expected: ${judgment.expectedType}`);
    }
    console.log(`Reason: ${judgment.reasoning}`);

    results[carrier].total++;
    typeAccuracy[docType].total++;
    if (judgment.isCorrect) {
      results[carrier].correct++;
      typeAccuracy[docType].correct++;
    }

    results[carrier].cases.push({
      filename: testCase.filename.substring(0, 25),
      classified: docType,
      correct: judgment.isCorrect,
      expected: judgment.expectedType,
    });
  }

  // Summary by carrier
  console.log('\n' + '='.repeat(80));
  console.log('ACCURACY BY CARRIER');
  console.log('='.repeat(80));

  let totalCorrect = 0, totalCases = 0;
  for (const [carrier, stats] of Object.entries(results)) {
    const acc = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    console.log(`\n${carrier.toUpperCase()}: ${stats.correct}/${stats.total} (${acc}%)`);
    totalCorrect += stats.correct;
    totalCases += stats.total;

    const failed = stats.cases.filter(c => !c.correct);
    if (failed.length > 0) {
      console.log('  Errors:');
      for (const f of failed) {
        console.log(`    ${f.filename} → ${f.classified} (should be: ${f.expected})`);
      }
    }
  }

  // Summary by document type
  console.log('\n' + '='.repeat(80));
  console.log('ACCURACY BY DOCUMENT TYPE');
  console.log('='.repeat(80));

  for (const [docType, stats] of Object.entries(typeAccuracy)) {
    const acc = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    console.log(`${docType}: ${stats.correct}/${stats.total} (${acc}%)`);
  }

  // Overall
  const overallAcc = totalCases > 0 ? Math.round((totalCorrect / totalCases) * 100) : 0;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`OVERALL: ${totalCorrect}/${totalCases} (${overallAcc}%)`);
  console.log('='.repeat(80));

  if (overallAcc >= 90) console.log('\n✅ Excellent - ready for production');
  else if (overallAcc >= 80) console.log('\n⚠️ Good - review edge cases');
  else if (overallAcc >= 70) console.log('\n⚠️ Fair - needs improvement');
  else console.log('\n❌ Poor - significant fixes needed');
}

runTest().catch(console.error);
