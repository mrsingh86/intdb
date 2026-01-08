/**
 * Reclassify Emails with Fixed Logic
 *
 * Uses the updated classification that prioritizes body content
 * over subject for thread replies.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { ClassificationOrchestrator } from '../../lib/services/classification';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BATCH_SIZE = 100;

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RECLASSIFYING EMAILS WITH FIXED LOGIC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const orchestrator = new ClassificationOrchestrator();

  // Get total count
  const { count } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  console.log(`Total classifications to process: ${count}\n`);

  let processed = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const changes: { old: string; new: string; count: number }[] = [];

  // Process in batches
  let offset = 0;
  while (offset < (count || 0)) {
    const { data: classifications, error } = await supabase
      .from('document_classifications')
      .select(`
        id,
        email_id,
        document_type,
        email_type,
        confidence_score,
        raw_emails!inner (
          subject,
          body_text,
          sender_email,
          true_sender_email
        )
      `)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`Error fetching batch at offset ${offset}:`, error);
      offset += BATCH_SIZE;
      continue;
    }

    for (const c of classifications || []) {
      const email = (c as any).raw_emails;

      try {
        // Reclassify with new logic
        const result = orchestrator.classify({
          subject: email?.subject || '',
          bodyText: email?.body_text || '',
          senderEmail: email?.sender_email || '',
          trueSenderEmail: email?.true_sender_email,
        });

        const oldDocType = c.document_type;
        const newDocType = result.documentType;
        const oldEmailType = c.email_type;
        const newEmailType = result.emailType;

        // Check if changed
        if (oldDocType !== newDocType || oldEmailType !== newEmailType) {
          // Update database
          const { error: updateError } = await supabase
            .from('document_classifications')
            .update({
              document_type: newDocType,
              confidence_score: result.documentConfidence,
              email_type: newEmailType,
              email_type_confidence: result.emailTypeConfidence,
              email_category: result.emailCategory,
              sender_category: result.senderCategory,
              sentiment: result.sentiment,
              sentiment_score: result.sentimentScore,
              document_direction: result.direction,
            })
            .eq('id', c.id);

          if (updateError) {
            errors++;
            console.error(`Error updating ${c.id}:`, updateError.message);
          } else {
            updated++;

            // Track changes
            if (oldDocType !== newDocType) {
              const changeKey = `${oldDocType} → ${newDocType}`;
              const existing = changes.find(ch => `${ch.old} → ${ch.new}` === changeKey);
              if (existing) {
                existing.count++;
              } else {
                changes.push({ old: oldDocType, new: newDocType, count: 1 });
              }
            }
          }
        } else {
          unchanged++;
        }

        processed++;
      } catch (err: any) {
        errors++;
        console.error(`Error processing ${c.id}:`, err.message);
      }
    }

    offset += BATCH_SIZE;

    // Progress update
    const pct = ((processed / (count || 1)) * 100).toFixed(1);
    console.log(`Progress: ${processed}/${count} (${pct}%) | Updated: ${updated} | Unchanged: ${unchanged} | Errors: ${errors}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RECLASSIFICATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nTotal processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Errors: ${errors}`);

  if (changes.length > 0) {
    console.log('\n--- Document Type Changes ---');
    changes
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .forEach(ch => {
        console.log(`  ${ch.count.toString().padStart(4)}x  ${ch.old} → ${ch.new}`);
      });
  }

  console.log('\n');
}

main().catch(console.error);
