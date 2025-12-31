#!/usr/bin/env npx tsx
/**
 * Reclassify Emails Using Deterministic Patterns
 *
 * Problem: Emails were classified using AI which used different document types
 * (commercial_invoice, amendment_notice) instead of proper types (invoice, booking_amendment).
 *
 * Solution: Re-run classification using deterministic patterns from shipping-line-patterns.ts
 */

import { createClient } from '@supabase/supabase-js';
import { classifyEmail, isShippingLineEmail } from '../lib/config/shipping-line-patterns';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface Stats {
  total: number;
  reclassified: number;
  unchanged: number;
  noMatch: number;
  errors: number;
  byOldType: Record<string, number>;
  byNewType: Record<string, number>;
  changes: { old: string; new: string; count: number }[];
}

const stats: Stats = {
  total: 0,
  reclassified: 0,
  unchanged: 0,
  noMatch: 0,
  errors: 0,
  byOldType: {},
  byNewType: {},
  changes: [],
};

async function main() {
  console.log('');
  console.log(''.repeat(80));
  console.log('      RECLASSIFY EMAILS WITH DETERMINISTIC PATTERNS                          ');
  console.log(''.repeat(80));
  console.log('');

  // Get all emails with their current classifications
  let offset = 0;
  const limit = 500;
  const changeMap = new Map<string, number>();

  while (true) {
    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select(`
        id,
        subject,
        sender_email,
        true_sender_email,
        document_classifications!inner(id, document_type, confidence_score)
      `)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    if (!emails || emails.length === 0) break;

    for (const email of emails) {
      stats.total++;

      try {
        const classification = (email as any).document_classifications[0];
        if (!classification) continue;

        const oldType = classification.document_type;
        stats.byOldType[oldType] = (stats.byOldType[oldType] || 0) + 1;

        // Get attachment filenames for this email
        const { data: attachments } = await supabase
          .from('raw_attachments')
          .select('filename')
          .eq('email_id', email.id);

        const filenames = (attachments || []).map(a => a.filename);
        const sender = email.true_sender_email || email.sender_email;

        // Run deterministic classification
        const result = classifyEmail(email.subject || '', sender, filenames);

        if (!result) {
          stats.noMatch++;
          continue;
        }

        const newType = result.documentType;

        if (oldType === newType) {
          stats.unchanged++;
          stats.byNewType[newType] = (stats.byNewType[newType] || 0) + 1;
          continue;
        }

        // Track the change
        const changeKey = `${oldType} -> ${newType}`;
        changeMap.set(changeKey, (changeMap.get(changeKey) || 0) + 1);

        // Update the classification (only document_type and confidence_score)
        const { error: updateError } = await supabase
          .from('document_classifications')
          .update({
            document_type: newType,
            confidence_score: result.confidence,
          })
          .eq('id', classification.id);

        if (updateError) {
          stats.errors++;
          if (stats.errors <= 5) {
            console.log(`  Error: ${updateError.message}`);
          }
        } else {
          stats.reclassified++;
          stats.byNewType[newType] = (stats.byNewType[newType] || 0) + 1;
        }
      } catch (err: any) {
        stats.errors++;
      }

      if (stats.total % 200 === 0) {
        console.log(`  Processed: ${stats.total} | Reclassified: ${stats.reclassified}`);
      }
    }

    offset += limit;
    if (emails.length < limit) break;
  }

  // Convert change map to sorted array
  stats.changes = Array.from(changeMap.entries())
    .map(([key, count]) => {
      const [old, newType] = key.split(' -> ');
      return { old, new: newType, count };
    })
    .sort((a, b) => b.count - a.count);

  printReport();
}

function printReport() {
  console.log('');
  console.log(''.repeat(80));
  console.log('RECLASSIFICATION COMPLETE');
  console.log(''.repeat(80));
  console.log('');
  console.log(`Total emails processed: ${stats.total}`);
  console.log(`Reclassified: ${stats.reclassified}`);
  console.log(`Unchanged: ${stats.unchanged}`);
  console.log(`No pattern match: ${stats.noMatch}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('');

  if (stats.changes.length > 0) {
    console.log('TOP RECLASSIFICATIONS:');
    console.log(''.repeat(60));
    for (const change of stats.changes.slice(0, 20)) {
      console.log(`  ${change.old.padEnd(25)} -> ${change.new.padEnd(25)} (${change.count})`);
    }
    console.log('');
  }

  console.log('DOCUMENT TYPE COUNTS (After Reclassification):');
  console.log(''.repeat(60));
  const sortedTypes = Object.entries(stats.byNewType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }
  console.log('');
}

main().catch(console.error);
