#!/usr/bin/env npx tsx
/**
 * Entity Extraction Backfill Script
 *
 * Runs schema-based extraction on classified emails and saves to new tables:
 * - email_extractions: Entities from email subject/body
 * - document_extractions: Entities from PDF attachments
 *
 * Usage:
 *   npx tsx scripts/backfill-entity-extractions.ts [--limit N] [--doc-type TYPE] [--dry-run]
 *
 * Options:
 *   --limit N       Process at most N emails (default: 500)
 *   --doc-type TYPE Only process emails with this document type
 *   --dry-run       Don't save to database, just show what would be extracted
 *   --force         Re-extract even if already extracted
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { createUnifiedExtractionService } from '../lib/services/extraction';

// Parse command line arguments
const args = process.argv.slice(2);
const limit = parseInt(args.find((a, i) => args[i - 1] === '--limit') || '500');
const docType = args.find((a, i) => args[i - 1] === '--doc-type');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface BackfillStats {
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  totalEmailExtractions: number;
  totalDocumentExtractions: number;
}

async function backfillExtractions(): Promise<void> {
  console.log('='.repeat(60));
  console.log('ENTITY EXTRACTION BACKFILL');
  console.log('='.repeat(60));
  console.log(`Limit: ${limit}`);
  console.log(`Document Type: ${docType || 'all'}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log(`Force Re-extract: ${force}`);
  console.log('');

  const extractionService = createUnifiedExtractionService(supabase);

  // Build query for emails needing extraction
  let query = supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      body_text,
      document_classifications(document_type, confidence_score),
      raw_attachments(id, extracted_text, mime_type, filename)
    `)
    .not('document_classifications', 'is', null)
    .order('received_at', { ascending: false })
    .limit(limit);

  // Filter by document type if specified
  if (docType) {
    query = query.eq('document_classifications.document_type', docType);
  }

  const { data: emails, error } = await query;

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No emails found for extraction');
    return;
  }

  console.log(`Found ${emails.length} emails to process\n`);

  const stats: BackfillStats = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    totalEmailExtractions: 0,
    totalDocumentExtractions: 0,
  };

  // Process each email
  for (const email of emails) {
    stats.processed++;
    const classification = email.document_classifications?.[0];
    const documentType = classification?.document_type || 'unknown';

    // Get PDF attachment
    const pdfAttachment = email.raw_attachments?.find(
      (a: { extracted_text: string; mime_type: string; filename: string }) =>
        a.extracted_text &&
        (a.mime_type?.includes('pdf') || a.filename?.toLowerCase().endsWith('.pdf'))
    );

    const shortId = email.id.substring(0, 8);
    const subject = email.subject?.substring(0, 40) || '(no subject)';

    // Skip if already extracted (unless force)
    if (!force) {
      const { count } = await supabase
        .from('email_extractions')
        .select('id', { count: 'exact', head: true })
        .eq('email_id', email.id);

      if ((count || 0) > 0) {
        console.log(`[${stats.processed}/${emails.length}] ${shortId}... SKIP (already extracted)`);
        stats.skipped++;
        continue;
      }
    }

    console.log(`[${stats.processed}/${emails.length}] ${shortId}... ${documentType} - "${subject}..."`);

    if (dryRun) {
      // Just show what would be extracted
      console.log(`  Would extract from: email body${pdfAttachment ? ' + PDF' : ''}`);
      stats.success++;
      continue;
    }

    try {
      const result = await extractionService.extract({
        emailId: email.id,
        attachmentId: pdfAttachment?.id,
        documentType,
        emailSubject: email.subject || '',
        emailBody: email.body_text || '',
        pdfContent: pdfAttachment?.extracted_text || '',
      });

      if (result.success) {
        stats.success++;
        stats.totalEmailExtractions += result.emailExtractions;
        stats.totalDocumentExtractions += result.documentExtractions;

        const entityCount = Object.keys(result.entities).length;
        console.log(
          `  ✅ Extracted: ${result.emailExtractions} email, ${result.documentExtractions} doc entities (${entityCount} unique)`
        );

        // Show key entities
        const keyEntities = ['booking_number', 'container_number', 'bl_number', 'hbl_number'];
        for (const key of keyEntities) {
          if (result.entities[key]) {
            console.log(`     ${key}: ${result.entities[key]}`);
          }
        }
      } else {
        stats.failed++;
        console.log(`  ❌ Failed: ${result.errors?.join(', ')}`);
      }
    } catch (error) {
      stats.failed++;
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 50));
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Processed: ${stats.processed}`);
  console.log(`Success: ${stats.success}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Email Extractions: ${stats.totalEmailExtractions}`);
  console.log(`Document Extractions: ${stats.totalDocumentExtractions}`);

  // Show extraction stats
  if (!dryRun && stats.success > 0) {
    console.log('\nExtraction Stats by Entity Type:');

    const { data: emailStats } = await supabase
      .from('email_extractions')
      .select('entity_type')
      .order('entity_type');

    if (emailStats) {
      const counts: Record<string, number> = {};
      for (const e of emailStats) {
        counts[e.entity_type] = (counts[e.entity_type] || 0) + 1;
      }

      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sorted.slice(0, 10)) {
        console.log(`  ${type}: ${count}`);
      }
    }
  }
}

// Run backfill
backfillExtractions()
  .then(() => {
    console.log('\nBackfill complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
