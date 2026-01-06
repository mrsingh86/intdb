/**
 * Classify Unknown Documents with AI
 *
 * Processes documents that deterministic classification couldn't match.
 * Uses Claude Haiku for cost-effective AI classification.
 */

import { createClient } from '@supabase/supabase-js';
import { ContentClassifierService } from '../lib/services/content-classifier-service.js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function classifyUnknowns() {
  console.log('='.repeat(80));
  console.log('CLASSIFYING UNKNOWN DOCUMENTS WITH AI');
  console.log('='.repeat(80));

  // Find documents classified as 'unknown' or with low confidence
  const { data: unknowns, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      true_sender_email,
      body_text,
      document_classifications!inner (
        id,
        document_type,
        confidence_score
      ),
      raw_attachments!inner (
        id,
        filename,
        extracted_text
      )
    `)
    .eq('raw_attachments.mime_type', 'application/pdf')
    .not('raw_attachments.extracted_text', 'is', null)
    .eq('document_classifications.document_type', 'unknown')
    .limit(100);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${unknowns?.length || 0} documents needing AI classification\n`);

  if (!unknowns || unknowns.length === 0) {
    console.log('No unknown documents to process.');
    return;
  }

  const classifier = new ContentClassifierService();
  let classified = 0;
  let failed = 0;

  for (const email of unknowns) {
    const classification = Array.isArray(email.document_classifications)
      ? email.document_classifications[0]
      : email.document_classifications;

    const attachment = Array.isArray(email.raw_attachments)
      ? email.raw_attachments[0]
      : email.raw_attachments;

    if (!attachment?.extracted_text) continue;

    console.log(`Processing: ${email.subject?.slice(0, 50)}...`);
    console.log(`  Current: ${classification.document_type} (${classification.confidence_score}%)`);

    try {
      const result = await classifier.classifyEmailWithAttachments(
        email.id,
        email.true_sender_email || email.sender_email || '',
        email.subject || '',
        email.body_text?.slice(0, 500) || '',
        [{
          id: attachment.id,
          filename: attachment.filename,
          extractedText: attachment.extracted_text,
        }]
      );

      const newType = result.attachmentClassifications[0]?.documentType || 'unknown';
      const newConfidence = result.emailConfidence;
      const source = result.attachmentClassifications[0]?.source || 'unknown';

      if (newType !== 'unknown' && newConfidence >= 70) {
        // Update in database
        await supabase
          .from('document_classifications')
          .update({
            document_type: newType,
            confidence_score: newConfidence,
            model_version: `content-first|${source}`,
            classification_reason: `[AI] ${result.attachmentClassifications[0]?.reasoning || ''}`,
            classified_at: new Date().toISOString(),
          })
          .eq('id', classification.id);

        console.log(`  -> ${newType} (${newConfidence}%) [${source}]`);
        classified++;
      } else {
        console.log(`  -> Still unknown or low confidence`);
        failed++;
      }
    } catch (err) {
      console.error(`  Error:`, err);
      failed++;
    }
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log(`Total processed: ${unknowns.length}`);
  console.log(`Successfully classified: ${classified}`);
  console.log(`Still unknown: ${failed}`);
}

classifyUnknowns().catch(console.error);
