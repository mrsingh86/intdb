/**
 * Backfill Email Classification
 *
 * Reclassifies all emails using the new ClassificationOrchestrator.
 * Updates document_classifications with new fields:
 * - email_type
 * - email_category
 * - email_type_confidence
 * - sender_category
 * - sentiment
 * - sentiment_score
 *
 * Usage:
 *   npx tsx scripts/backfill-email-classification.ts [--limit N] [--batch-size N] [--dry-run]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { createClassificationOrchestrator, ClassificationOutput } from '../lib/services/classification/index.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const orchestrator = createClassificationOrchestrator();

// Parse command line arguments
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const dryRun = args.includes('--dry-run');
const withAI = args.includes('--with-ai');

const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : 0; // 0 = no limit
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;

interface EmailRow {
  id: string;
  subject: string;
  sender_email: string;
  true_sender_email: string | null;
  body_text: string | null;
}

interface ClassificationRow {
  email_id: string;
  document_type: string;
}

interface Stats {
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  byDocumentType: Map<string, number>;
  byEmailType: Map<string, number>;
  bySenderCategory: Map<string, number>;
  bySentiment: Map<string, number>;
}

async function getEmailsNeedingBackfill(offset: number, limit: number): Promise<EmailRow[]> {
  // Get emails that have classifications but no email_type
  const { data, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      true_sender_email,
      body_text
    `)
    .not('subject', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to fetch emails: ${error.message}`);
  }

  return data || [];
}

async function getAttachmentFilenames(emailId: string): Promise<string[]> {
  const { data } = await supabase
    .from('raw_attachments')
    .select('filename')
    .eq('email_id', emailId);

  return data?.map(a => a.filename).filter(Boolean) || [];
}

async function getPdfContent(emailId: string): Promise<string> {
  const { data } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', emailId)
    .not('extracted_text', 'is', null);

  return data?.map(a => a.extracted_text).filter(Boolean).join('\n\n---\n\n') || '';
}

async function updateClassification(
  emailId: string,
  result: ClassificationOutput
): Promise<boolean> {
  // Build classification reason
  const reasons: string[] = [];
  reasons.push(`Document: ${result.documentType} (${result.documentConfidence}%)`);
  reasons.push(`Email: ${result.emailType} (${result.emailTypeConfidence}%)`);
  reasons.push(`Sender: ${result.senderCategory}`);
  reasons.push(`Sentiment: ${result.sentiment}`);
  if (result.usedAIFallback) {
    reasons.push(`AI: ${result.aiReasoning}`);
  }

  // Determine model version
  let modelVersion: string;
  if (result.usedAIFallback) {
    modelVersion = 'v3|ai-fallback|backfill';
  } else if (result.documentMethod === 'pdf_content') {
    modelVersion = 'v3|content-first|backfill';
  } else {
    modelVersion = 'v3|pattern|backfill';
  }

  // Check if classification exists
  const { data: existing } = await supabase
    .from('document_classifications')
    .select('id')
    .eq('email_id', emailId)
    .single();

  if (existing) {
    // Update existing classification with new fields
    const { error } = await supabase
      .from('document_classifications')
      .update({
        document_type: result.documentType,
        confidence_score: Math.max(result.documentConfidence, result.emailTypeConfidence),
        model_version: modelVersion,
        classification_reason: reasons.join(' | '),
        is_manual_review: result.needsManualReview,
        document_direction: result.direction,
        workflow_state: result.documentWorkflowState,
        email_type: result.emailType,
        email_category: result.emailCategory,
        email_type_confidence: result.emailTypeConfidence,
        sender_category: result.senderCategory,
        sentiment: result.sentiment,
        sentiment_score: result.sentimentScore,
      })
      .eq('email_id', emailId);

    return !error;
  } else {
    // Insert new classification
    const { error } = await supabase
      .from('document_classifications')
      .insert({
        email_id: emailId,
        document_type: result.documentType,
        confidence_score: Math.max(result.documentConfidence, result.emailTypeConfidence),
        model_name: result.usedAIFallback ? 'ai-fallback' : 'classification-orchestrator',
        model_version: modelVersion,
        classification_reason: reasons.join(' | '),
        is_manual_review: result.needsManualReview,
        document_direction: result.direction,
        workflow_state: result.documentWorkflowState,
        classified_at: new Date().toISOString(),
        email_type: result.emailType,
        email_category: result.emailCategory,
        email_type_confidence: result.emailTypeConfidence,
        sender_category: result.senderCategory,
        sentiment: result.sentiment,
        sentiment_score: result.sentimentScore,
      });

    return !error;
  }
}

async function runBackfill() {
  console.log('='.repeat(80));
  console.log('EMAIL CLASSIFICATION BACKFILL');
  console.log('='.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`AI Fallback: ${withAI ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log(`Limit: ${LIMIT || 'No limit'}`);
  console.log('');

  // Get total count
  const { count } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .not('subject', 'is', null);

  const totalEmails = LIMIT ? Math.min(LIMIT, count || 0) : (count || 0);
  console.log(`Total emails to process: ${totalEmails}`);
  console.log('');

  const stats: Stats = {
    total: totalEmails,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    byDocumentType: new Map(),
    byEmailType: new Map(),
    bySenderCategory: new Map(),
    bySentiment: new Map(),
  };

  const startTime = Date.now();
  let offset = 0;

  while (offset < totalEmails) {
    const batchSize = Math.min(BATCH_SIZE, totalEmails - offset);
    const emails = await getEmailsNeedingBackfill(offset, batchSize);

    if (emails.length === 0) break;

    console.log(`\nProcessing batch ${Math.floor(offset / BATCH_SIZE) + 1} (${offset + 1}-${offset + emails.length} of ${totalEmails})...`);

    for (const email of emails) {
      try {
        // Get attachment info
        const attachmentFilenames = await getAttachmentFilenames(email.id);
        const pdfContent = await getPdfContent(email.id);

        // Classify
        let result: ClassificationOutput;
        if (withAI) {
          result = await orchestrator.classifyWithAI({
            subject: email.subject || '',
            senderEmail: email.sender_email || '',
            trueSenderEmail: email.true_sender_email,
            bodyText: email.body_text || '',
            attachmentFilenames,
            pdfContent: pdfContent || undefined,
          });
        } else {
          result = orchestrator.classify({
            subject: email.subject || '',
            senderEmail: email.sender_email || '',
            trueSenderEmail: email.true_sender_email,
            bodyText: email.body_text || '',
            attachmentFilenames,
            pdfContent: pdfContent || undefined,
          });
        }

        // Track stats
        stats.byDocumentType.set(result.documentType, (stats.byDocumentType.get(result.documentType) || 0) + 1);
        stats.byEmailType.set(result.emailType, (stats.byEmailType.get(result.emailType) || 0) + 1);
        stats.bySenderCategory.set(result.senderCategory, (stats.bySenderCategory.get(result.senderCategory) || 0) + 1);
        stats.bySentiment.set(result.sentiment, (stats.bySentiment.get(result.sentiment) || 0) + 1);

        // Update database
        if (!dryRun) {
          const success = await updateClassification(email.id, result);
          if (success) {
            stats.updated++;
          } else {
            stats.errors++;
          }
        } else {
          stats.updated++;
        }

        stats.processed++;

        // Progress indicator
        if (stats.processed % 50 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = stats.processed / elapsed;
          const remaining = (totalEmails - stats.processed) / rate;
          console.log(`  Processed: ${stats.processed}/${totalEmails} (${(stats.processed / totalEmails * 100).toFixed(1)}%) - ${rate.toFixed(1)}/s - ETA: ${Math.round(remaining)}s`);
        }

      } catch (error: any) {
        console.error(`  Error processing email ${email.id}: ${error.message}`);
        stats.errors++;
      }
    }

    offset += batchSize;

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Final summary
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n' + '='.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total processed: ${stats.processed}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Time: ${elapsed.toFixed(1)}s (${(stats.processed / elapsed).toFixed(1)} emails/s)`);

  console.log('\nDocument Types:');
  for (const [type, count] of [...stats.byDocumentType.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = (count / stats.processed * 100).toFixed(1);
    console.log(`  ${type}: ${count} (${pct}%)`);
  }

  console.log('\nEmail Types:');
  for (const [type, count] of [...stats.byEmailType.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = (count / stats.processed * 100).toFixed(1);
    console.log(`  ${type}: ${count} (${pct}%)`);
  }

  console.log('\nSender Categories:');
  for (const [type, count] of [...stats.bySenderCategory.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = (count / stats.processed * 100).toFixed(1);
    console.log(`  ${type}: ${count} (${pct}%)`);
  }

  console.log('\nSentiment:');
  for (const [type, count] of [...stats.bySentiment.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = (count / stats.processed * 100).toFixed(1);
    console.log(`  ${type}: ${count} (${pct}%)`);
  }
}

runBackfill().catch(console.error);
