/**
 * Bulk Reclassification Script: Content-First Classification
 *
 * Replaces current subject/body-based classification with content-first approach.
 * Only reclassifies documents where PDF content is available.
 *
 * Usage: npx tsx scripts/reclassify-all-documents.ts
 *
 * @author Claude Opus 4.5
 * @date 2026-01-06
 */

import { createClient } from '@supabase/supabase-js';
import { ContentClassifierService } from '../lib/services/content-classifier-service.js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ReclassificationStats {
  total: number;
  reclassified: number;
  unchanged: number;
  errors: number;
  byOldType: Record<string, number>;
  byNewType: Record<string, number>;
  changes: Array<{
    emailId: string;
    oldType: string;
    newType: string;
    oldConfidence: number;
    newConfidence: number;
  }>;
}

async function reclassifyAllDocuments() {
  console.log('='.repeat(80));
  console.log('CONTENT-FIRST BULK RECLASSIFICATION');
  console.log('='.repeat(80));
  console.log(`\nStarted at: ${new Date().toISOString()}\n`);

  const stats: ReclassificationStats = {
    total: 0,
    reclassified: 0,
    unchanged: 0,
    errors: 0,
    byOldType: {},
    byNewType: {},
    changes: [],
  };

  // Fetch all emails with PDF attachments that have extracted text
  const BATCH_SIZE = 100;
  let offset = 0;
  let hasMore = true;

  const classifier = new ContentClassifierService();

  while (hasMore) {
    console.log(`\nFetching batch at offset ${offset}...`);

    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select(`
        id,
        subject,
        sender_email,
        true_sender_email,
        body_text,
        thread_position,
        document_classifications (
          id,
          document_type,
          confidence_score
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
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching emails:', error);
      break;
    }

    if (!emails || emails.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Processing ${emails.length} emails...`);

    for (const email of emails) {
      stats.total++;

      const currentClassification = Array.isArray(email.document_classifications)
        ? email.document_classifications[0]
        : email.document_classifications;

      const attachment = Array.isArray(email.raw_attachments)
        ? email.raw_attachments[0]
        : email.raw_attachments;

      if (!attachment?.extracted_text) {
        stats.errors++;
        continue;
      }

      const oldType = currentClassification?.document_type || 'unknown';
      const oldConfidence = parseFloat(currentClassification?.confidence_score) || 0;

      // Track old type counts
      stats.byOldType[oldType] = (stats.byOldType[oldType] || 0) + 1;

      try {
        // Run content-first classification
        const senderEmail = email.true_sender_email || email.sender_email || '';
        const result = await classifier.classifyEmailWithAttachments(
          email.id,
          senderEmail,
          email.subject || '',
          email.body_text?.slice(0, 500) || '',
          [{
            id: attachment.id,
            filename: attachment.filename,
            extractedText: attachment.extracted_text,
          }],
          email.thread_position
        );

        const newType = result.attachmentClassifications[0]?.documentType || 'unknown';
        const newConfidence = result.emailConfidence;
        const newSource = result.attachmentClassifications[0]?.source || 'unknown';

        // Track new type counts
        stats.byNewType[newType] = (stats.byNewType[newType] || 0) + 1;

        if (oldType !== newType) {
          stats.reclassified++;
          stats.changes.push({
            emailId: email.id,
            oldType,
            newType,
            oldConfidence,
            newConfidence,
          });

          // Update the classification in database
          if (currentClassification?.id) {
            await supabase
              .from('document_classifications')
              .update({
                document_type: newType,
                confidence_score: newConfidence,
                model_version: `content-first|${newSource}`,
                classification_reason: `Content-first reclassification from ${oldType}. Source: ${newSource}. ${result.attachmentClassifications[0]?.reasoning || ''}`,
                classified_at: new Date().toISOString(),
              })
              .eq('id', currentClassification.id);
          } else {
            // Create new classification if none exists
            await supabase
              .from('document_classifications')
              .insert({
                email_id: email.id,
                document_type: newType,
                confidence_score: newConfidence,
                model_version: `content-first|${newSource}`,
                classification_reason: `Content-first classification. Source: ${newSource}. ${result.attachmentClassifications[0]?.reasoning || ''}`,
                classified_at: new Date().toISOString(),
              });
          }
        } else {
          stats.unchanged++;
        }

        // Progress indicator
        if (stats.total % 100 === 0) {
          console.log(`  Processed ${stats.total} emails (${stats.reclassified} changed)...`);
        }

      } catch (err) {
        stats.errors++;
        console.error(`Error processing email ${email.id}:`, err);
      }
    }

    offset += BATCH_SIZE;
    hasMore = emails.length === BATCH_SIZE;
  }

  // Print summary
  console.log('\n');
  console.log('='.repeat(80));
  console.log('RECLASSIFICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total processed:   ${stats.total}`);
  console.log(`Reclassified:      ${stats.reclassified} (${(stats.reclassified / stats.total * 100).toFixed(1)}%)`);
  console.log(`Unchanged:         ${stats.unchanged} (${(stats.unchanged / stats.total * 100).toFixed(1)}%)`);
  console.log(`Errors:            ${stats.errors}`);

  console.log('\n');
  console.log('='.repeat(80));
  console.log('BEFORE (Old Classification) - Top 20 Types');
  console.log('='.repeat(80));
  const oldSorted = Object.entries(stats.byOldType).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [type, count] of oldSorted) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('AFTER (New Classification) - Top 20 Types');
  console.log('='.repeat(80));
  const newSorted = Object.entries(stats.byNewType).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [type, count] of newSorted) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('MAJOR MIGRATION PATTERNS (Top 20)');
  console.log('='.repeat(80));

  // Group changes by old->new pattern
  const migrationPatterns: Record<string, number> = {};
  for (const change of stats.changes) {
    const key = `${change.oldType} -> ${change.newType}`;
    migrationPatterns[key] = (migrationPatterns[key] || 0) + 1;
  }

  const patternsSorted = Object.entries(migrationPatterns).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [pattern, count] of patternsSorted) {
    console.log(`  ${pattern.padEnd(50)} ${count}`);
  }

  console.log(`\n\nCompleted at: ${new Date().toISOString()}`);

  // Save detailed results to file
  const fs = await import('fs');
  const outputPath = './reclassification-results.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: {
      total: stats.total,
      reclassified: stats.reclassified,
      unchanged: stats.unchanged,
      errors: stats.errors,
    },
    byOldType: stats.byOldType,
    byNewType: stats.byNewType,
    migrationPatterns,
    sampleChanges: stats.changes.slice(0, 100),
  }, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

// Run the reclassification
reclassifyAllDocuments().catch(console.error);
