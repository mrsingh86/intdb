/**
 * FAST Bulk Reclassification - Deterministic Only (No AI)
 *
 * Quality safeguards:
 * 1. DRY_RUN mode - preview changes without updating
 * 2. Only reclassify if new confidence >= 85%
 * 3. Preserve manual reviews (is_manual_review=true)
 * 4. Track all unknowns for optional AI pass later
 *
 * Usage:
 *   DRY RUN:  npx tsx scripts/reclassify-fast.ts --dry-run
 *   EXECUTE:  npx tsx scripts/reclassify-fast.ts --execute
 */

import { createClient } from '@supabase/supabase-js';
import {
  DOCUMENT_TYPE_CONFIGS,
} from '../lib/config/content-classification-config.js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const DRY_RUN = !process.argv.includes('--execute');
const MIN_CONFIDENCE = 85;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Fast deterministic classifier
function classifyByContent(extractedText: string): { type: string; confidence: number; markers: string[] } | null {
  const textUpper = extractedText.toUpperCase();
  let bestMatch: { type: string; confidence: number; markers: string[] } | null = null;

  for (const config of DOCUMENT_TYPE_CONFIGS) {
    for (const marker of config.contentMarkers) {
      if (marker.exclude?.some(ex => textUpper.includes(ex.toUpperCase()))) continue;

      const matchedRequired: string[] = [];
      let allRequired = true;
      for (const req of marker.required) {
        if (textUpper.includes(req.toUpperCase())) {
          matchedRequired.push(req);
        } else {
          allRequired = false;
          break;
        }
      }

      if (!allRequired || matchedRequired.length === 0) continue;

      let confidence = marker.confidence;
      const matchedOptional: string[] = [];
      if (marker.optional) {
        for (const opt of marker.optional) {
          if (textUpper.includes(opt.toUpperCase())) {
            matchedOptional.push(opt);
            confidence += 2;
          }
        }
      }
      confidence = Math.min(confidence, 99);

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { type: config.type, confidence, markers: [...matchedRequired, ...matchedOptional] };
      }
    }
  }
  return bestMatch;
}

function classifyByFilename(filename: string): { type: string; confidence: number } | null {
  for (const config of DOCUMENT_TYPE_CONFIGS) {
    if (config.filenamePatterns) {
      for (const pattern of config.filenamePatterns) {
        if (pattern.test(filename)) {
          return { type: config.type, confidence: 75 };
        }
      }
    }
  }
  return null;
}

interface Stats {
  total: number;
  willReclassify: number;
  unchanged: number;
  skippedManualReview: number;
  skippedLowConfidence: number;
  unknowns: number;
  byOldType: Record<string, number>;
  byNewType: Record<string, number>;
  migrations: Record<string, number>;
  sampleChanges: Array<{ old: string; new: string; confidence: number; markers: string }>;
}

async function reclassifyFast() {
  console.log('='.repeat(80));
  console.log(DRY_RUN ? '*** DRY RUN MODE - NO CHANGES WILL BE MADE ***' : '*** EXECUTING RECLASSIFICATION ***');
  console.log('='.repeat(80));
  console.log(`Minimum confidence threshold: ${MIN_CONFIDENCE}%`);
  const startTime = Date.now();

  const stats: Stats = {
    total: 0,
    willReclassify: 0,
    unchanged: 0,
    skippedManualReview: 0,
    skippedLowConfidence: 0,
    unknowns: 0,
    byOldType: {},
    byNewType: {},
    migrations: {},
    sampleChanges: [],
  };

  const updates: Array<{ id: string; document_type: string; confidence_score: number; classification_reason: string }> = [];
  const BATCH_SIZE = 500;
  let offset = 0;

  while (true) {
    console.log(`\nFetching batch at offset ${offset}...`);

    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select(`
        id,
        document_classifications (
          id,
          document_type,
          confidence_score,
          is_manual_review
        ),
        raw_attachments!inner (
          filename,
          extracted_text
        )
      `)
      .eq('raw_attachments.mime_type', 'application/pdf')
      .not('raw_attachments.extracted_text', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) { console.error('Fetch error:', error); break; }
    if (!emails || emails.length === 0) break;

    for (const email of emails) {
      stats.total++;

      const classification = Array.isArray(email.document_classifications)
        ? email.document_classifications[0]
        : email.document_classifications;

      const attachment = Array.isArray(email.raw_attachments)
        ? email.raw_attachments[0]
        : email.raw_attachments;

      if (!attachment?.extracted_text) continue;

      const oldType = classification?.document_type || 'unknown';
      const isManualReview = classification?.is_manual_review === true;

      stats.byOldType[oldType] = (stats.byOldType[oldType] || 0) + 1;

      // Skip manual reviews - human override is sacred
      if (isManualReview) {
        stats.skippedManualReview++;
        stats.byNewType[oldType] = (stats.byNewType[oldType] || 0) + 1;
        stats.unchanged++;
        continue;
      }

      // Classify by content
      const contentResult = classifyByContent(attachment.extracted_text);
      let newType = 'unknown';
      let newConfidence = 0;
      let reason = '';
      let markers = '';

      if (contentResult && contentResult.confidence >= MIN_CONFIDENCE) {
        newType = contentResult.type;
        newConfidence = contentResult.confidence;
        markers = contentResult.markers.slice(0, 3).join(', ');
        reason = `Content: ${markers}`;
      } else if (contentResult && contentResult.confidence >= 70) {
        // Lower confidence content match - use but flag
        newType = contentResult.type;
        newConfidence = contentResult.confidence;
        markers = contentResult.markers.slice(0, 2).join(', ');
        reason = `Low-conf content: ${markers}`;
      } else {
        // Try filename as fallback
        const filenameResult = classifyByFilename(attachment.filename);
        if (filenameResult) {
          newType = filenameResult.type;
          newConfidence = filenameResult.confidence;
          reason = `Filename: ${attachment.filename}`;
        } else {
          stats.unknowns++;
          newType = 'unknown';
          newConfidence = 0;
          reason = 'No match';
        }
      }

      stats.byNewType[newType] = (stats.byNewType[newType] || 0) + 1;

      if (oldType !== newType && newConfidence >= MIN_CONFIDENCE) {
        stats.willReclassify++;
        const migKey = `${oldType} -> ${newType}`;
        stats.migrations[migKey] = (stats.migrations[migKey] || 0) + 1;

        if (stats.sampleChanges.length < 50) {
          stats.sampleChanges.push({ old: oldType, new: newType, confidence: newConfidence, markers });
        }

        if (classification?.id) {
          updates.push({
            id: classification.id,
            document_type: newType,
            confidence_score: newConfidence,
            classification_reason: `[Content-First] ${reason}`,
          });
        }
      } else if (oldType !== newType && newConfidence < MIN_CONFIDENCE) {
        stats.skippedLowConfidence++;
        stats.unchanged++;
      } else {
        stats.unchanged++;
      }
    }

    console.log(`  Processed ${stats.total} (${stats.willReclassify} to change, ${stats.unknowns} unknown)`);
    offset += BATCH_SIZE;
    if (emails.length < BATCH_SIZE) break;
  }

  // Execute updates if not dry run
  if (!DRY_RUN && updates.length > 0) {
    console.log(`\n*** UPDATING ${updates.length} classifications in database... ***`);

    const UPDATE_BATCH = 50;
    for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
      const batch = updates.slice(i, i + UPDATE_BATCH);
      await Promise.all(batch.map(u =>
        supabase.from('document_classifications').update({
          document_type: u.document_type,
          confidence_score: u.confidence_score,
          classification_reason: u.classification_reason,
          model_version: 'content-first|deterministic',
          classified_at: new Date().toISOString(),
        }).eq('id', u.id)
      ));
      if ((i + UPDATE_BATCH) % 200 === 0) {
        console.log(`  Updated ${Math.min(i + UPDATE_BATCH, updates.length)}/${updates.length}...`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print results
  console.log('\n');
  console.log('='.repeat(80));
  console.log(DRY_RUN ? 'DRY RUN RESULTS (no changes made)' : 'RECLASSIFICATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Time elapsed:           ${elapsed} seconds`);
  console.log(`Total processed:        ${stats.total}`);
  console.log(`Will reclassify:        ${stats.willReclassify} (${(stats.willReclassify / stats.total * 100).toFixed(1)}%)`);
  console.log(`Unchanged:              ${stats.unchanged} (${(stats.unchanged / stats.total * 100).toFixed(1)}%)`);
  console.log(`Skipped (manual review):${stats.skippedManualReview}`);
  console.log(`Skipped (low conf):     ${stats.skippedLowConfidence}`);
  console.log(`Unknown (needs AI):     ${stats.unknowns}`);

  console.log('\n');
  console.log('='.repeat(80));
  console.log('BEFORE - Top 15 Document Types');
  console.log('='.repeat(80));
  Object.entries(stats.byOldType).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([type, count]) => console.log(`  ${type.padEnd(30)} ${count}`));

  console.log('\n');
  console.log('='.repeat(80));
  console.log('AFTER - Top 15 Document Types');
  console.log('='.repeat(80));
  Object.entries(stats.byNewType).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([type, count]) => console.log(`  ${type.padEnd(30)} ${count}`));

  console.log('\n');
  console.log('='.repeat(80));
  console.log('TOP 20 MIGRATION PATTERNS (what will change)');
  console.log('='.repeat(80));
  Object.entries(stats.migrations).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([pattern, count]) => console.log(`  ${pattern.padEnd(55)} ${count}`));

  console.log('\n');
  console.log('='.repeat(80));
  console.log('SAMPLE CHANGES (first 20)');
  console.log('='.repeat(80));
  stats.sampleChanges.slice(0, 20).forEach(c =>
    console.log(`  ${c.old.padEnd(25)} -> ${c.new.padEnd(25)} (${c.confidence}%) [${c.markers}]`)
  );

  if (DRY_RUN) {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('*** This was a DRY RUN. To execute, run:');
    console.log('*** npx tsx scripts/reclassify-fast.ts --execute');
    console.log('='.repeat(80));
  }

  // Save results
  const fs = await import('fs');
  fs.writeFileSync('./reclassification-preview.json', JSON.stringify(stats, null, 2));
  console.log('\nResults saved to: ./reclassification-preview.json');
}

reclassifyFast().catch(console.error);
