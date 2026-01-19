/**
 * Cross-verify classifications: Check if subject matches document_type
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

async function verify() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get recent learning episodes with chronicle data
  const { data: episodes } = await supabase
    .from('learning_episodes')
    .select('predicted_document_type, prediction_method, prediction_confidence, thread_position, classification_strategy, chronicle_id')
    .order('created_at', { ascending: false })
    .limit(48);

  if (!episodes || episodes.length === 0) {
    console.log('No episodes found');
    return;
  }

  // Get chronicle details for these episodes
  const chronicleIds = episodes.map(e => e.chronicle_id);
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, subject, from_party, document_type')
    .in('id', chronicleIds);

  const chronicleMap = new Map(chronicles?.map(c => [c.id, c]) || []);

  console.log('='.repeat(110));
  console.log('CROSS-VERIFICATION: Subject vs Classification (Recent 48 from test)');
  console.log('='.repeat(110));

  let correct = 0;
  let questionable = 0;
  const issues: { subject: string; type: string; reason: string }[] = [];

  for (const ep of episodes) {
    const c = chronicleMap.get(ep.chronicle_id);
    if (!c) continue;

    const subject = c.subject.toLowerCase();
    const docType = c.document_type;

    // Simple heuristic checks
    let isCorrect = true;
    let reason = '';

    // Check for obvious mismatches
    if (docType === 'booking_confirmation' && !subject.includes('booking') && !subject.includes('confirmation') && !subject.includes('bkg')) {
      if (subject.includes('amendment') || subject.includes('update')) {
        isCorrect = false;
        reason = 'Subject has amendment/update but classified as confirmation';
      }
    }

    if (docType === 'arrival_notice' && !subject.includes('arrival') && !subject.includes('eta') && !subject.includes('vessel')) {
      isCorrect = false;
      reason = 'No arrival keywords in subject';
    }

    if (docType === 'invoice' && !subject.includes('invoice') && !subject.includes('debit') && !subject.includes('credit') && !subject.includes('payment')) {
      isCorrect = false;
      reason = 'No invoice keywords in subject';
    }

    if (docType === 'bl_draft' && !subject.includes('draft') && !subject.includes('b/l') && !subject.includes('bl') && !subject.includes('bill')) {
      isCorrect = false;
      reason = 'No BL draft keywords in subject';
    }

    if (docType === 'rate_request' && !subject.includes('rate') && !subject.includes('quote') && !subject.includes('enquiry') && !subject.includes('request')) {
      // Check if it was normalized from 'request'
      if (ep.predicted_document_type === 'rate_request') {
        isCorrect = false;
        reason = 'No rate keywords - may be wrong normalization';
      }
    }

    if (docType === 'carrier_announcement' && !subject.includes('announcement') && !subject.includes('advisory') && !subject.includes('notice') && !subject.includes('alert') && !subject.includes('update')) {
      isCorrect = false;
      reason = 'No announcement keywords in subject';
    }

    const subjectDisplay = c.subject.substring(0, 70) + (c.subject.length > 70 ? '...' : '');
    const fromDisplay = (c.from_party || 'unknown').substring(0, 25).padEnd(25);
    const typeDisplay = docType.padEnd(25);
    const confDisplay = `${ep.prediction_confidence}%`.padStart(4);
    const methodDisplay = ep.prediction_method.padEnd(15);

    const status = isCorrect ? '✓' : '?';

    if (!isCorrect) {
      questionable++;
      issues.push({ subject: c.subject, type: docType, reason });
    } else {
      correct++;
    }

    console.log(`${status} ${typeDisplay} ${confDisplay} ${methodDisplay} | ${subjectDisplay}`);
  }

  console.log('='.repeat(110));
  console.log(`\nSUMMARY:`);
  console.log(`  Likely correct:    ${correct}`);
  console.log(`  Questionable:      ${questionable}`);
  console.log(`  Accuracy estimate: ${Math.round(correct / (correct + questionable) * 100)}%`);

  if (issues.length > 0) {
    console.log(`\n⚠️  QUESTIONABLE CLASSIFICATIONS:`);
    console.log('-'.repeat(110));
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. Type: ${issue.type}`);
      console.log(`   Subject: ${issue.subject.substring(0, 90)}`);
      console.log(`   Issue: ${issue.reason}`);
      console.log('');
    });
  }
}

verify().catch(console.error);
