/**
 * Smart Misclassification Detection
 *
 * 1. Define expected subject patterns for each document type
 * 2. Find emails where subject suggests one type but classified differently
 * 3. Group by mismatch category
 * 4. Use LLM judge on samples to validate
 */
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic();

// Expected subject patterns for each document type
// ORDER MATTERS - more specific patterns checked first
const EXPECTED_PATTERNS: Record<string, RegExp[]> = {
  // SI DRAFT (from shipper for approval) - check BEFORE general SI
  si_draft: [
    /\bchecklist\s+(for\s+)?(approval|review)/i,
    /\bSIL\s*&\s*VGM/i,
    /\bSI\s+draft/i,
    /\bdraft\s+SI\b/i,
    /\bSI\s+for\s+(approval|review)/i,
  ],
  // HBL DRAFT (to shipper for approval) - check BEFORE general BL
  hbl_draft: [
    /\bBL\s+draft\s+for/i,
    /\bHBL\s+draft/i,
    /\bdraft\s+(HBL|B\/L|BL)\b/i,
    /\bBL\s+for\s+approval/i,
    /\bmodification.*draft\s+BL/i,
  ],
  sob_confirmation: [
    /\bSOB\s+CONFIRM/i,
    /\bSOB\s+for\b/i,
    /\bshipped\s+on\s+board/i,
    /\bon\s*board\s+confirm/i,
  ],
  arrival_notice: [
    /\barrival\s+notice\b/i,
    /\bnotice\s+of\s+arrival\b/i,
  ],
  bill_of_lading: [
    /\bB\/?L\s+(copy|release)/i,
    /\bbill\s+of\s+lading\b/i,
    /\bsea\s*waybill\b/i,
    /\bSeaway\s+BL\s+Release/i,
    /\bHBL\s*#/i,
    /\bMBL\s*#/i,
  ],
  booking_cancellation: [
    /\bbooking.*cancel/i,
    /\bcancel.*booking/i,
  ],
  booking_amendment: [
    /\b(1st|2nd|3rd|\d+th)\s+UPDATE\b/i,
    /\bamendment\s+to\s+booking/i,
    /\brollover\b/i,
  ],
  delivery_order: [
    /\bdelivery\s+order\b/i,
    /\bD\/?O\s+(release|issued)/i,
  ],
  vgm_confirmation: [
    /\bVGM\s+(confirm|accept|receiv)/i,
    /\bverified\s+gross\s+mass/i,
  ],
  invoice: [
    /\bfreight\s+invoice\b/i,
    /\binvoice\s*#\s*[A-Z0-9-]+/i,
  ],
  shipping_instruction: [
    /\bSI\s+(submission|confirm)/i,
    /\bshipping\s+instruction/i,
  ],
};

interface Mismatch {
  emailId: string;
  subject: string;
  expectedType: string;
  actualType: string;
  matchedPattern: string;
}

interface MismatchBucket {
  expectedType: string;
  actualType: string;
  count: number;
  samples: Mismatch[];
}

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase
      .from(table)
      .select(select)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      all = all.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return all;
}

function detectExpectedType(subject: string): { type: string; pattern: string } | null {
  for (const [docType, patterns] of Object.entries(EXPECTED_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(subject)) {
        return { type: docType, pattern: pattern.toString() };
      }
    }
  }
  return null;
}

async function llmJudge(samples: Mismatch[]): Promise<void> {
  console.log('\n🤖 LLM Judge Evaluation (using Sonnet):');
  console.log('─'.repeat(70));

  for (const sample of samples.slice(0, 5)) {
    const prompt = `You are a shipping document classification expert.

Given this email subject: "${sample.subject}"

The system classified it as: ${sample.actualType}
But the subject pattern suggests: ${sample.expectedType}

Which classification is CORRECT? Respond with JSON:
{"correct_type": "type_name", "confidence": 0-100, "reasoning": "brief explanation"}`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        const verdict = result.correct_type === sample.expectedType ? '✓ Pattern correct' :
                       result.correct_type === sample.actualType ? '✗ AI was correct' : '? Different';
        console.log(`\n${verdict}`);
        console.log(`  Subject: ${sample.subject.substring(0, 60)}...`);
        console.log(`  Expected: ${sample.expectedType} | Actual: ${sample.actualType}`);
        console.log(`  Judge says: ${result.correct_type} (${result.confidence}%)`);
        console.log(`  Reason: ${result.reasoning}`);
      }
    } catch (err) {
      console.log(`  Error judging: ${err}`);
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              SMART MISCLASSIFICATION DETECTION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Fetch all emails and classifications
  console.log('Fetching data...');
  const [emails, classifications] = await Promise.all([
    fetchAll<{ id: string; subject: string }>('raw_emails', 'id, subject'),
    fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id, document_type'),
  ]);

  console.log(`Emails: ${emails.length}, Classifications: ${classifications.length}`);

  // Create lookup
  const classificationMap = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // Find mismatches
  const mismatches: Mismatch[] = [];

  for (const email of emails) {
    if (!email.subject) continue;

    const expected = detectExpectedType(email.subject);
    if (!expected) continue;

    const actualType = classificationMap.get(email.id);
    if (!actualType) continue;

    // Check if mismatch
    if (actualType !== expected.type) {
      mismatches.push({
        emailId: email.id,
        subject: email.subject,
        expectedType: expected.type,
        actualType,
        matchedPattern: expected.pattern,
      });
    }
  }

  console.log(`\nFound ${mismatches.length} potential misclassifications`);

  // Group by mismatch type
  const buckets = new Map<string, MismatchBucket>();

  for (const m of mismatches) {
    const key = `${m.expectedType}|${m.actualType}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        expectedType: m.expectedType,
        actualType: m.actualType,
        count: 0,
        samples: [],
      });
    }
    const bucket = buckets.get(key)!;
    bucket.count++;
    if (bucket.samples.length < 5) {
      bucket.samples.push(m);
    }
  }

  // Sort by count and display
  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => b.count - a.count);

  console.log('\n📊 Mismatch Buckets (sorted by count):');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('Expected Type'.padEnd(25) + 'Actual Type'.padEnd(25) + 'Count'.padStart(8));
  console.log('─'.repeat(70));

  for (const bucket of sortedBuckets) {
    console.log(
      bucket.expectedType.padEnd(25) +
      bucket.actualType.padEnd(25) +
      bucket.count.toString().padStart(8)
    );
  }

  // Show samples for top buckets
  console.log('\n📋 Sample misclassifications from top buckets:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  for (const bucket of sortedBuckets.slice(0, 5)) {
    console.log(`\n[${bucket.expectedType} → ${bucket.actualType}] (${bucket.count} emails)`);
    console.log('─'.repeat(70));
    for (const sample of bucket.samples.slice(0, 3)) {
      console.log(`  • ${sample.subject.substring(0, 65)}...`);
    }
  }

  // LLM Judge on top bucket
  if (sortedBuckets.length > 0 && sortedBuckets[0].samples.length > 0) {
    await llmJudge(sortedBuckets[0].samples);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY:');
  console.log('─'.repeat(70));
  console.log(`Total emails analyzed: ${emails.length}`);
  console.log(`Emails with clear subject patterns: ${mismatches.length + (emails.length - mismatches.length)}`);
  console.log(`Potential misclassifications: ${mismatches.length}`);
  console.log(`Mismatch buckets: ${sortedBuckets.length}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
