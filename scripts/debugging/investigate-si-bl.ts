/**
 * Investigate SI and BL classification issues
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
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

// SI patterns that should be classified as shipping_instruction
const SI_PATTERNS: RegExp[] = [
  /\bSI\s+(submission|confirm|draft|approved|received)/i,
  /\bshipping\s+instruction/i,
  /\bS\.?I\.?\s+draft/i,
  /\bdraft\s+SI\b/i,
  /\bSI\s+for\s+approval/i,
  /\bSI\s+details/i,
  /\bsubmit.*SI\b/i,
  /\bSI\s+submitted/i,
];

// BL patterns that should be classified as bill_of_lading
const BL_PATTERNS: RegExp[] = [
  /\bB\/?L\s+(draft|release|copy|surrender)/i,
  /\bHBL\s*(draft|#|release)/i,
  /\bMBL\s*(draft|#|release)/i,
  /\bbill\s+of\s+lading/i,
  /\bBL\s+draft/i,
  /\bdraft\s+BL\b/i,
  /\bSeaway\s+BL/i,
  /\bHouse\s+B\/?L/i,
  /\bMaster\s+B\/?L/i,
  /\bBL\s+instructions/i,
  /\bBL\s+amendment/i,
  /\bBL\s+correction/i,
];

function matchesPattern(subject: string, patterns: RegExp[]): { matched: boolean; pattern: string } {
  for (const pattern of patterns) {
    if (pattern.test(subject)) {
      return { matched: true, pattern: pattern.toString() };
    }
  }
  return { matched: false, pattern: '' };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('SI & BL CLASSIFICATION INVESTIGATION');
  console.log('═'.repeat(70));
  console.log('\nFetching data...');

  const [emails, classifications] = await Promise.all([
    fetchAll<{ id: string; subject: string }>('raw_emails', 'id, subject'),
    fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id, document_type'),
  ]);

  console.log(`Emails: ${emails.length}, Classifications: ${classifications.length}`);

  const classMap = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // Find SI misclassifications
  console.log('\n\n📋 SHIPPING INSTRUCTION (SI) ANALYSIS');
  console.log('─'.repeat(70));

  const siMismatches: Array<{ subject: string; actual: string; pattern: string }> = [];
  const siCorrect: string[] = [];

  for (const email of emails) {
    if (!email.subject) continue;
    const match = matchesPattern(email.subject, SI_PATTERNS);
    if (match.matched) {
      const actual = classMap.get(email.id);
      if (actual && actual !== 'shipping_instruction' && actual !== 'si_submission') {
        siMismatches.push({ subject: email.subject, actual, pattern: match.pattern });
      } else if (actual === 'shipping_instruction' || actual === 'si_submission') {
        siCorrect.push(email.subject);
      }
    }
  }

  console.log(`SI patterns matched: ${siMismatches.length + siCorrect.length}`);
  console.log(`  Correctly classified: ${siCorrect.length}`);
  console.log(`  Misclassified: ${siMismatches.length}`);

  if (siMismatches.length > 0) {
    // Group by actual type
    const byActual: Record<string, number> = {};
    siMismatches.forEach(m => {
      byActual[m.actual] = (byActual[m.actual] || 0) + 1;
    });

    console.log('\nMisclassified as:');
    Object.entries(byActual)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

    console.log('\nSample SI misclassifications:');
    siMismatches.slice(0, 10).forEach(m => {
      console.log(`  [${m.actual}] ${m.subject.substring(0, 60)}...`);
    });
  }

  // Find BL misclassifications
  console.log('\n\n📋 BILL OF LADING (BL) ANALYSIS');
  console.log('─'.repeat(70));

  const blMismatches: Array<{ subject: string; actual: string; pattern: string }> = [];
  const blCorrect: string[] = [];

  for (const email of emails) {
    if (!email.subject) continue;
    const match = matchesPattern(email.subject, BL_PATTERNS);
    if (match.matched) {
      const actual = classMap.get(email.id);
      if (actual && actual !== 'bill_of_lading') {
        blMismatches.push({ subject: email.subject, actual, pattern: match.pattern });
      } else if (actual === 'bill_of_lading') {
        blCorrect.push(email.subject);
      }
    }
  }

  console.log(`BL patterns matched: ${blMismatches.length + blCorrect.length}`);
  console.log(`  Correctly classified: ${blCorrect.length}`);
  console.log(`  Misclassified: ${blMismatches.length}`);

  if (blMismatches.length > 0) {
    // Group by actual type
    const byActual: Record<string, number> = {};
    blMismatches.forEach(m => {
      byActual[m.actual] = (byActual[m.actual] || 0) + 1;
    });

    console.log('\nMisclassified as:');
    Object.entries(byActual)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

    console.log('\nSample BL misclassifications:');
    blMismatches.slice(0, 10).forEach(m => {
      console.log(`  [${m.actual}] ${m.subject.substring(0, 60)}...`);
    });
  }

  // Check what SI/BL docs we DO have and their subjects
  console.log('\n\n📋 CURRENT SI/BL CLASSIFICATIONS');
  console.log('─'.repeat(70));

  const siDocs = emails.filter(e => classMap.get(e.id) === 'shipping_instruction' || classMap.get(e.id) === 'si_submission');
  const blDocs = emails.filter(e => classMap.get(e.id) === 'bill_of_lading');

  console.log(`\nCurrently classified as SI: ${siDocs.length}`);
  console.log('Sample subjects:');
  siDocs.slice(0, 5).forEach(e => {
    console.log(`  ${e.subject?.substring(0, 65)}...`);
  });

  console.log(`\nCurrently classified as BL: ${blDocs.length}`);
  console.log('Sample subjects:');
  blDocs.slice(0, 5).forEach(e => {
    console.log(`  ${e.subject?.substring(0, 65)}...`);
  });

  // Summary
  console.log('\n\n═'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));
  console.log(`SI: ${siMismatches.length} potential misclassifications to fix`);
  console.log(`BL: ${blMismatches.length} potential misclassifications to fix`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
