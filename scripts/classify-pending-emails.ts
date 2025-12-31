#!/usr/bin/env npx tsx
/**
 * Classify Pending Emails
 *
 * Uses the unified classification service (deterministic first, AI fallback)
 * to classify emails that don't have document_classifications records.
 */

import { createClient } from '@supabase/supabase-js';
import {
  classifyEmail,
  isShippingLineEmail,
} from '../lib/config/shipping-line-patterns';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface Stats {
  total: number;
  classified: number;
  deterministic: number;
  aiClassified: number;
  noMatch: number;
  errors: number;
  byDocType: Record<string, number>;
  byCarrier: Record<string, number>;
}

const stats: Stats = {
  total: 0,
  classified: 0,
  deterministic: 0,
  aiClassified: 0,
  noMatch: 0,
  errors: 0,
  byDocType: {},
  byCarrier: {},
};

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              CLASSIFY PENDING EMAILS (UNIFIED SERVICE)                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Find emails without classifications
  console.log('Finding unclassified emails...');

  // Get all email IDs that already have classifications
  const { data: existingClassifications } = await supabase
    .from('document_classifications')
    .select('email_id');

  const classifiedIds = new Set((existingClassifications || []).map(c => c.email_id));
  console.log(`  Already classified: ${classifiedIds.size}`);

  // Get all emails
  let allEmails: any[] = [];
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const { data: batch, error } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, true_sender_email, body_text, snippet, has_attachments')
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    if (!batch || batch.length === 0) break;

    allEmails = allEmails.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  console.log(`  Total emails in database: ${allEmails.length}`);

  // Filter to only unclassified
  const unclassifiedEmails = allEmails.filter(e => !classifiedIds.has(e.id));
  console.log(`  Unclassified emails: ${unclassifiedEmails.length}`);
  console.log('');

  if (unclassifiedEmails.length === 0) {
    console.log('All emails are already classified!');
    return;
  }

  console.log('Classifying emails...');
  console.log('─'.repeat(60));

  for (const email of unclassifiedEmails) {
    stats.total++;

    try {
      const sender = email.true_sender_email || email.sender_email;

      // Get attachment filenames for this email
      const { data: attachments } = await supabase
        .from('raw_attachments')
        .select('filename')
        .eq('email_id', email.id);

      const filenames = (attachments || []).map((a: any) => a.filename);

      // Try deterministic classification first
      const result = classifyEmail(email.subject || '', sender, filenames);

      let documentType: string;
      let confidence: number;
      let method: string;
      let carrierId: string | null = null;
      let carrierName: string | null = null;

      if (result && result.confidence > 0) {
        // Deterministic match
        documentType = result.documentType;
        confidence = result.confidence;
        method = 'deterministic';
        carrierId = result.carrierId;
        carrierName = result.carrierName;
        stats.deterministic++;
        stats.byCarrier[carrierName || 'unknown'] = (stats.byCarrier[carrierName || 'unknown'] || 0) + 1;
      } else {
        // No deterministic match - classify as general_correspondence for now
        // (AI classification can be added later if needed)
        documentType = 'general_correspondence';
        confidence = 50;
        method = 'fallback';
        stats.noMatch++;
      }

      // Save classification
      const { error: insertError } = await supabase
        .from('document_classifications')
        .insert({
          email_id: email.id,
          document_type: documentType,
          confidence_score: confidence,
        });

      if (insertError) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.log(`  Error inserting: ${insertError.message}`);
        }
      } else {
        stats.classified++;
        stats.byDocType[documentType] = (stats.byDocType[documentType] || 0) + 1;
      }

      // Progress update
      if (stats.total % 200 === 0) {
        console.log(`  Processed: ${stats.total} | Classified: ${stats.classified} | Deterministic: ${stats.deterministic}`);
      }
    } catch (err: any) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  printReport();
}

function printReport() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('CLASSIFICATION COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Total processed:     ${stats.total}`);
  console.log(`Successfully saved:  ${stats.classified}`);
  console.log(`Deterministic match: ${stats.deterministic}`);
  console.log(`No match (fallback): ${stats.noMatch}`);
  console.log(`Errors:              ${stats.errors}`);
  console.log('');

  console.log('BY DOCUMENT TYPE:');
  console.log('─'.repeat(50));
  const sortedTypes = Object.entries(stats.byDocType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('');
  console.log('BY CARRIER (Deterministic):');
  console.log('─'.repeat(50));
  const sortedCarriers = Object.entries(stats.byCarrier).sort((a, b) => b[1] - a[1]);
  for (const [carrier, count] of sortedCarriers) {
    console.log(`  ${carrier.padEnd(25)} ${count}`);
  }
  console.log('');
}

main().catch(console.error);
