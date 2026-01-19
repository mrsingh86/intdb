/**
 * Validation Script: Content-First Classification vs Current System
 *
 * Compares the new content-based classification against the existing
 * subject/body-based classification on a sample of emails.
 *
 * Usage: npx ts-node scripts/validate-content-classification.ts
 *
 * @author Claude Opus 4.5
 * @date 2026-01-05
 */

import { createClient } from '@supabase/supabase-js';
import { ContentClassifierService } from '../lib/services/content-classifier-service.js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ValidationResult {
  emailId: string;
  subject: string;
  filename: string;
  senderEmail: string;
  senderType: string;

  // Current classification
  currentType: string;
  currentConfidence: number;
  currentReason: string;

  // New content-based classification
  newType: string;
  newConfidence: number;
  newSource: string;
  newReasoning?: string;

  // Judge validation
  judgeValid?: boolean;
  judgeAdjustment?: number;
  judgeReason?: string;
  judgeSuggestedType?: string;

  // Comparison
  typesMatch: boolean;
  contentPreview: string;
}

async function runValidation(sampleSize: number = 100) {
  console.log('='.repeat(80));
  console.log('CONTENT-FIRST CLASSIFICATION VALIDATION');
  console.log('='.repeat(80));
  console.log(`\nSample size: ${sampleSize} emails with PDF attachments\n`);

  // Fetch sample emails with classifications and attachments
  const { data: samples, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      true_sender_email,
      body_text,
      thread_position,
      document_classifications!inner (
        document_type,
        confidence_score,
        classification_reason,
        model_version
      ),
      raw_attachments!inner (
        id,
        filename,
        mime_type,
        extracted_text
      )
    `)
    .eq('raw_attachments.mime_type', 'application/pdf')
    .not('raw_attachments.extracted_text', 'is', null)
    .order('received_at', { ascending: false })
    .limit(sampleSize);

  if (error) {
    console.error('Error fetching samples:', error);
    return;
  }

  if (!samples || samples.length === 0) {
    console.error('No samples found');
    return;
  }

  console.log(`Found ${samples.length} emails with PDF attachments\n`);

  const classifier = new ContentClassifierService();
  const results: ValidationResult[] = [];

  let matchCount = 0;
  let mismatchCount = 0;
  let judgeDisagreeCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const classification = Array.isArray(sample.document_classifications)
      ? sample.document_classifications[0]
      : sample.document_classifications;
    const attachment = Array.isArray(sample.raw_attachments)
      ? sample.raw_attachments[0]
      : sample.raw_attachments;

    if (!classification || !attachment) continue;

    process.stdout.write(`\rProcessing ${i + 1}/${samples.length}...`);

    // Run new content-based classification
    const senderEmail = sample.true_sender_email || sample.sender_email || '';
    const newClassification = await classifier.classifyEmailWithAttachments(
      sample.id,
      senderEmail,
      sample.subject || '',
      sample.body_text?.slice(0, 500) || '',
      [{
        id: attachment.id,
        filename: attachment.filename,
        extractedText: attachment.extracted_text,
      }],
      sample.thread_position
    );

    const primaryAtt = newClassification.attachmentClassifications[0];
    const typesMatch = classification.document_type === primaryAtt?.documentType;

    if (typesMatch) {
      matchCount++;
    } else {
      mismatchCount++;
    }

    if (newClassification.judgeValidation && !newClassification.judgeValidation.isValid) {
      judgeDisagreeCount++;
    }

    results.push({
      emailId: sample.id,
      subject: sample.subject?.slice(0, 60) || '(no subject)',
      filename: attachment.filename,
      senderEmail: senderEmail.slice(0, 40),
      senderType: newClassification.senderType,

      currentType: classification.document_type,
      currentConfidence: parseFloat(classification.confidence_score) || 0,
      currentReason: classification.classification_reason?.slice(0, 50) || '',

      newType: primaryAtt?.documentType || 'unknown',
      newConfidence: primaryAtt?.confidence || 0,
      newSource: primaryAtt?.source || 'none',
      newReasoning: primaryAtt?.reasoning?.slice(0, 50),

      judgeValid: newClassification.judgeValidation?.isValid,
      judgeAdjustment: newClassification.judgeValidation?.confidenceAdjustment,
      judgeReason: newClassification.judgeValidation?.reason?.slice(0, 50),
      judgeSuggestedType: newClassification.judgeValidation?.suggestedType,

      typesMatch,
      contentPreview: attachment.extracted_text?.slice(0, 200) || '',
    });
  }

  console.log('\n\n');

  // Print summary
  console.log('='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total samples:           ${results.length}`);
  console.log(`Types match:             ${matchCount} (${(matchCount / results.length * 100).toFixed(1)}%)`);
  console.log(`Types mismatch:          ${mismatchCount} (${(mismatchCount / results.length * 100).toFixed(1)}%)`);
  console.log(`Judge disagrees:         ${judgeDisagreeCount}`);
  console.log('');

  // Print mismatches for review
  console.log('='.repeat(80));
  console.log('MISMATCHES (Current vs Content-Based)');
  console.log('='.repeat(80));

  const mismatches = results.filter(r => !r.typesMatch);
  for (const m of mismatches.slice(0, 30)) {
    console.log('');
    console.log(`Email: ${m.emailId}`);
    console.log(`Subject: ${m.subject}`);
    console.log(`Filename: ${m.filename}`);
    console.log(`Sender: ${m.senderEmail} (${m.senderType})`);
    console.log(`Current: ${m.currentType} (${m.currentConfidence}%) - ${m.currentReason}`);
    console.log(`New:     ${m.newType} (${m.newConfidence}%) [${m.newSource}]`);
    if (m.judgeReason) {
      console.log(`Judge:   ${m.judgeValid ? 'VALID' : 'INVALID'} (${m.judgeAdjustment}) - ${m.judgeReason}`);
      if (m.judgeSuggestedType) {
        console.log(`         Suggested: ${m.judgeSuggestedType}`);
      }
    }
    console.log(`Content: ${m.contentPreview.replace(/\n/g, ' ').slice(0, 100)}...`);
    console.log('-'.repeat(80));
  }

  // Print cases where judge disagrees with current classification
  console.log('\n');
  console.log('='.repeat(80));
  console.log('JUDGE DISAGREEMENTS (Current classification likely wrong)');
  console.log('='.repeat(80));

  const judgeDisagrees = results.filter(r => r.judgeValid === false);
  for (const j of judgeDisagrees.slice(0, 20)) {
    console.log('');
    console.log(`Email: ${j.emailId}`);
    console.log(`Subject: ${j.subject}`);
    console.log(`Filename: ${j.filename}`);
    console.log(`Current: ${j.currentType} (${j.currentConfidence}%)`);
    console.log(`Judge says: ${j.judgeReason}`);
    if (j.judgeSuggestedType) {
      console.log(`Suggested: ${j.judgeSuggestedType}`);
    }
    console.log(`Content: ${j.contentPreview.replace(/\n/g, ' ').slice(0, 100)}...`);
    console.log('-'.repeat(80));
  }

  // Statistics by document type
  console.log('\n');
  console.log('='.repeat(80));
  console.log('ACCURACY BY DOCUMENT TYPE (Current System)');
  console.log('='.repeat(80));

  const byType: Record<string, { total: number; matches: number }> = {};
  for (const r of results) {
    if (!byType[r.currentType]) {
      byType[r.currentType] = { total: 0, matches: 0 };
    }
    byType[r.currentType].total++;
    if (r.typesMatch) {
      byType[r.currentType].matches++;
    }
  }

  const typeStats = Object.entries(byType)
    .map(([type, stats]) => ({
      type,
      total: stats.total,
      matches: stats.matches,
      accuracy: (stats.matches / stats.total * 100).toFixed(1),
    }))
    .sort((a, b) => b.total - a.total);

  console.log('\nType                      | Count | Matches | Accuracy');
  console.log('-'.repeat(60));
  for (const stat of typeStats) {
    console.log(
      `${stat.type.padEnd(25)} | ${String(stat.total).padStart(5)} | ${String(stat.matches).padStart(7)} | ${stat.accuracy}%`
    );
  }

  // Save full results to file
  const fs = await import('fs');
  const outputPath = './validation-results.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n\nFull results saved to: ${outputPath}`);
}

// Run validation
runValidation(100).catch(console.error);
