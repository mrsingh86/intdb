/**
 * Verify reclassified records - cross-check subject vs document_type
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

async function verify() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  // Get recently reclassified records
  const { data: records } = await supabase
    .from('chronicle')
    .select('subject, document_type, from_party')
    .not('reanalyzed_at', 'is', null)
    .order('reanalyzed_at', { ascending: false })
    .limit(50);

  console.log('CROSS-VERIFICATION: Reclassified Records (50 sample)');
  console.log('='.repeat(100));

  let correct = 0;
  let questionable = 0;
  const issues: Array<{ subject: string; type: string; reason: string }> = [];

  for (const r of records || []) {
    const subject = r.subject.toLowerCase();
    const docType = r.document_type;
    let isCorrect = true;
    let reason = '';

    // Heuristic checks
    if (docType === 'rate_request') {
      const hasRateKeywords = subject.includes('rate') || subject.includes('quote') ||
        subject.includes('quotation') || subject.includes('inquiry') ||
        subject.includes('enquiry') || subject.includes('request id') || subject.includes('pricing');
      if (!hasRateKeywords) {
        isCorrect = false;
        reason = 'No rate/quote keywords';
      }
    }

    if (docType === 'arrival_notice') {
      const hasArrivalKeywords = subject.includes('arrival') || subject.includes(' an ') || subject.includes('eta');
      if (!hasArrivalKeywords) {
        isCorrect = false;
        reason = 'No arrival keywords';
      }
    }

    if (docType === 'invoice') {
      const hasInvoiceKeywords = subject.includes('inv') || subject.includes('debit') || subject.includes('credit');
      if (!hasInvoiceKeywords) {
        isCorrect = false;
        reason = 'No invoice keywords';
      }
    }

    if (docType === 'booking_confirmation') {
      const hasBookingKeywords = subject.includes('booking') || subject.includes('bkg') || subject.includes('confirmation');
      if (!hasBookingKeywords) {
        if (subject.includes('amendment') || subject.includes('update')) {
          isCorrect = false;
          reason = 'Has amendment/update, not confirmation';
        }
      }
    }

    if (docType === 'sob_confirmation') {
      const hasSobKeywords = subject.includes('sob') || subject.includes('shipped') || subject.includes('on board');
      if (!hasSobKeywords) {
        isCorrect = false;
        reason = 'No SOB keywords';
      }
    }

    const mark = isCorrect ? '✓' : '?';
    if (!isCorrect) {
      questionable++;
      issues.push({ subject: r.subject.substring(0, 60), type: docType, reason });
    } else {
      correct++;
    }

    console.log(`${mark} ${docType.padEnd(25)} | ${r.subject.substring(0, 65)}`);
  }

  console.log('='.repeat(100));
  console.log('');
  console.log('SUMMARY:');
  console.log(`  Likely correct: ${correct}`);
  console.log(`  Questionable: ${questionable}`);
  console.log(`  Accuracy estimate: ${Math.round(correct / (correct + questionable) * 100)}%`);

  if (issues.length > 0) {
    console.log('');
    console.log('QUESTIONABLE CLASSIFICATIONS:');
    issues.slice(0, 10).forEach((issue, idx) => {
      console.log(`${idx + 1}. ${issue.type}: ${issue.subject}`);
      console.log(`   Issue: ${issue.reason}`);
    });
  }
}

verify().catch(console.error);
