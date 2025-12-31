/**
 * Test Attachment-Based Classification
 *
 * Uses raw_attachments table for proper PDF content validation
 * Validates deterministic classification with attachment content patterns
 * Uses LLM judge to evaluate accuracy across shipping lines
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  classifyEmail as classifyDeterministic,
} from '../lib/config/shipping-line-patterns';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic();

interface TestCase {
  emailId: string;
  subject: string;
  sender: string;
  carrier: string;
  attachmentFilenames: string[];
  attachmentContent: string;
  hasBookingHeading: boolean;
  currentClassification: string;
  deterministicResult: {
    documentType: string;
    confidence: number;
    matchedPattern: string;
  } | null;
}

interface JudgeResult {
  isCorrect: boolean;
  expectedType: string;
  reasoning: string;
}

async function getTestCases(): Promise<TestCase[]> {
  console.log('Fetching sample emails with attachments from each carrier...\n');

  // Get emails with their attachments from raw_attachments table
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select(`
      email_id,
      filename,
      extracted_text
    `)
    .not('extracted_text', 'is', null)
    .limit(1000);

  if (!attachments) return [];

  // Group attachments by email
  const attachmentsByEmail = new Map<string, { filenames: string[]; content: string }>();
  for (const att of attachments) {
    if (!attachmentsByEmail.has(att.email_id)) {
      attachmentsByEmail.set(att.email_id, { filenames: [], content: '' });
    }
    const entry = attachmentsByEmail.get(att.email_id)!;
    entry.filenames.push(att.filename || '');
    entry.content += (att.extracted_text || '') + '\n';
  }

  // Get email details
  const emailIds = Array.from(attachmentsByEmail.keys());
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .in('id', emailIds);

  if (!emails) return [];

  // Get classifications
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', emailIds);

  const classMap = new Map(classifications?.map(c => [c.email_id, c.document_type]) || []);

  // Group by carrier and get samples
  const carrierSamples: Record<string, TestCase[]> = {};

  for (const email of emails) {
    const sender = (email.true_sender_email || email.sender_email || '').toLowerCase();
    let carrier = 'unknown';

    if (sender.includes('maersk') || sender.includes('e.maersk')) carrier = 'maersk';
    else if (sender.includes('hlag') || sender.includes('hapag')) carrier = 'hapag';
    else if (sender.includes('cma-cgm')) carrier = 'cma-cgm';
    else if (sender.includes('coscon')) carrier = 'cosco';
    else if (sender.includes('msc.com')) carrier = 'msc';
    else continue;

    if (!carrierSamples[carrier]) carrierSamples[carrier] = [];
    if (carrierSamples[carrier].length >= 6) continue;

    const attData = attachmentsByEmail.get(email.id);
    if (!attData) continue;

    const hasBookingHeading = /BOOKING CONFIRMATION/i.test(attData.content);
    const currentClass = classMap.get(email.id) || 'unknown';

    // Run deterministic classification
    const deterministicResult = classifyDeterministic(
      email.subject || '',
      email.true_sender_email || email.sender_email || '',
      attData.filenames,
      attData.content.substring(0, 10000)
    );

    carrierSamples[carrier].push({
      emailId: email.id,
      subject: email.subject || '',
      sender: email.true_sender_email || email.sender_email || '',
      carrier,
      attachmentFilenames: attData.filenames,
      attachmentContent: attData.content.substring(0, 1500),
      hasBookingHeading,
      currentClassification: currentClass,
      deterministicResult: deterministicResult ? {
        documentType: deterministicResult.documentType,
        confidence: deterministicResult.confidence,
        matchedPattern: deterministicResult.matchedPattern || '',
      } : null,
    });
  }

  return Object.values(carrierSamples).flat();
}

async function judgeClassification(testCase: TestCase): Promise<JudgeResult> {
  const classifiedAs = testCase.deterministicResult?.documentType || 'NO_MATCH';

  const prompt = `You are evaluating a shipping document classification system.

EMAIL DETAILS:
- Subject: ${testCase.subject}
- Sender: ${testCase.sender}
- Carrier: ${testCase.carrier}
- Attachment files: ${testCase.attachmentFilenames.join(', ')}
- Has "BOOKING CONFIRMATION" heading in PDF: ${testCase.hasBookingHeading}

PDF CONTENT SAMPLE:
${testCase.attachmentContent.substring(0, 800)}

CLASSIFICATION RESULT:
- System classified as: ${classifiedAs}
- Previous classification: ${testCase.currentClassification}
- Pattern matched: ${testCase.deterministicResult?.matchedPattern || 'none'}

DOCUMENT TYPES:
- booking_confirmation: Original booking confirmed (MUST have "BOOKING CONFIRMATION" heading in PDF for most carriers)
- booking_amendment: Update/change to existing booking (often has "UPDATE" in filename or subject)
- arrival_notice: Cargo arrival notification
- bill_of_lading: B/L document (draft, copy, original)
- shipping_instruction: SI submission/confirmation
- invoice: Freight/commercial invoice (often has "INV" in filename)
- shipment_notice: FMC filing, shipment notice
- general_correspondence: General emails, support cases
- cutoff_advisory: Cut-off time changes

KEY RULES:
1. booking_confirmation SHOULD have "BOOKING CONFIRMATION" heading in PDF
2. Invoices often have "INV" or "Invoice" in filename
3. B/L has "B/L", "Bill of Lading" in subject/filename
4. RE:/FW: emails are usually general_correspondence unless clearly a document type

Is "${classifiedAs}" the CORRECT classification?

Return JSON only:
{
  "isCorrect": true/false,
  "expectedType": "correct_type_if_wrong",
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

  return { isCorrect: false, expectedType: 'unknown', reasoning: 'Judge failed' };
}

async function runTest() {
  console.log('='.repeat(80));
  console.log('TESTING ATTACHMENT-BASED CLASSIFICATION (using raw_attachments)');
  console.log('='.repeat(80));

  const testCases = await getTestCases();
  console.log(`Found ${testCases.length} test cases across carriers.\n`);

  const results: Record<string, { correct: number; total: number; cases: any[] }> = {};

  for (const testCase of testCases) {
    if (!results[testCase.carrier]) {
      results[testCase.carrier] = { correct: 0, total: 0, cases: [] };
    }

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Carrier: ${testCase.carrier.toUpperCase()}`);
    console.log(`Subject: ${testCase.subject.substring(0, 60)}...`);
    console.log(`Files: ${testCase.attachmentFilenames.join(', ')}`);
    console.log(`Current: ${testCase.currentClassification}`);
    console.log(`Deterministic: ${testCase.deterministicResult?.documentType || 'NO_MATCH'}`);
    console.log(`Pattern: ${testCase.deterministicResult?.matchedPattern || 'none'}`);
    console.log(`Has "BOOKING CONFIRMATION" in PDF: ${testCase.hasBookingHeading}`);

    const judgment = await judgeClassification(testCase);
    console.log(`\nJudge: ${judgment.isCorrect ? '✅ CORRECT' : '❌ WRONG'}`);
    if (!judgment.isCorrect) {
      console.log(`Expected: ${judgment.expectedType}`);
    }
    console.log(`Reason: ${judgment.reasoning}`);

    results[testCase.carrier].total++;
    if (judgment.isCorrect) {
      results[testCase.carrier].correct++;
    }
    results[testCase.carrier].cases.push({
      subject: testCase.subject.substring(0, 40),
      files: testCase.attachmentFilenames[0]?.substring(0, 30) || 'none',
      classified: testCase.deterministicResult?.documentType || 'NO_MATCH',
      hasBookingHeading: testCase.hasBookingHeading,
      correct: judgment.isCorrect,
      expected: judgment.expectedType,
    });
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY BY CARRIER');
  console.log('='.repeat(80));

  let totalCorrect = 0;
  let totalCases = 0;

  for (const [carrier, stats] of Object.entries(results)) {
    const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    console.log(`\n${carrier.toUpperCase()}: ${stats.correct}/${stats.total} (${accuracy}%)`);

    totalCorrect += stats.correct;
    totalCases += stats.total;

    const failed = stats.cases.filter(c => !c.correct);
    if (failed.length > 0) {
      console.log('  Failed:');
      for (const f of failed) {
        console.log(`    - "${f.subject}" [${f.files}]`);
        console.log(`      Got: ${f.classified} | Expected: ${f.expected} | HasHeading: ${f.hasBookingHeading}`);
      }
    }
  }

  const overallAccuracy = totalCases > 0 ? Math.round((totalCorrect / totalCases) * 100) : 0;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`OVERALL: ${totalCorrect}/${totalCases} (${overallAccuracy}%)`);
  console.log('='.repeat(80));

  if (overallAccuracy >= 90) {
    console.log('\n✅ Safe to deploy (>= 90%)');
  } else if (overallAccuracy >= 70) {
    console.log('\n⚠️ Review failures (70-90%)');
  } else {
    console.log('\n❌ Fix issues before deploy (< 70%)');
  }
}

runTest().catch(console.error);
