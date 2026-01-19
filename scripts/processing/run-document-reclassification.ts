/**
 * Document Reclassification Script
 *
 * Reclassifies existing documents using the improved DocumentContentClassificationService.
 * Fixes misclassifications caused by weak regex patterns in the original implementation.
 *
 * Usage:
 *   npx tsx scripts/run-document-reclassification.ts --sample 20    # Test with 20 docs
 *   npx tsx scripts/run-document-reclassification.ts --all          # Reclassify all
 *   npx tsx scripts/run-document-reclassification.ts --stats        # Show stats only
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  createDocumentContentClassificationService,
} from '../lib/services/classification/document-content-classification-service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const contentClassifier = createDocumentContentClassificationService();

// Registry document types
type DocumentType =
  | 'booking_confirmation'
  | 'shipping_instructions'
  | 'draft_bl'
  | 'final_bl'
  | 'house_bl'
  | 'master_bl'
  | 'arrival_notice'
  | 'delivery_order'
  | 'invoice'
  | 'packing_list'
  | 'certificate'
  | 'vgm'
  | 'checklist'
  | 'customs_entry'
  | 'other';

/**
 * Map content classifier types to registry types.
 */
function mapToRegistryType(contentType: string): DocumentType {
  const typeMap: Record<string, DocumentType> = {
    // Booking
    booking_confirmation: 'booking_confirmation',
    booking_amendment: 'booking_confirmation',

    // Shipping Instructions
    shipping_instruction: 'shipping_instructions',
    si_draft: 'shipping_instructions',
    si_confirmation: 'shipping_instructions',

    // Bills of Lading
    draft_bl: 'draft_bl',
    final_bl: 'final_bl',
    house_bl: 'house_bl',
    master_bl: 'master_bl',
    seaway_bill: 'house_bl',

    // Arrival/Delivery
    arrival_notice: 'arrival_notice',
    delivery_order: 'delivery_order',
    release_order: 'delivery_order',

    // Commercial
    commercial_invoice: 'invoice',
    freight_invoice: 'invoice',
    proforma_invoice: 'invoice',
    invoice: 'invoice',

    // Packing
    packing_list: 'packing_list',

    // VGM
    vgm: 'vgm',
    vgm_declaration: 'vgm',

    // Customs
    entry_summary: 'customs_entry',
    customs_declaration: 'customs_entry',
    customs_bond: 'customs_entry',
    isf: 'customs_entry',

    // Certificates
    certificate_of_origin: 'certificate',
    fumigation_certificate: 'certificate',
    phytosanitary_certificate: 'certificate',
    insurance_certificate: 'certificate',

    // Checklist
    checklist: 'checklist',
  };

  return typeMap[contentType] || 'other';
}

/**
 * Fallback filename-based classification.
 */
function classifyByFilename(filename: string): DocumentType {
  const upper = filename.toUpperCase();

  if (/BOOKING.*CONFIRM/i.test(upper)) return 'booking_confirmation';
  if (/\bBC\s*\d+/i.test(upper)) return 'booking_confirmation';
  if (/SHIPPING.*INSTRUCT/i.test(upper)) return 'shipping_instructions';
  if (/ARRIVAL.*NOTICE/i.test(upper)) return 'arrival_notice';
  if (/\bAN[-_]\d+/i.test(upper)) return 'arrival_notice';
  if (/HOUSE.*B[\/]?L/i.test(upper)) return 'house_bl';
  if (/\bHBL[-_]/i.test(upper)) return 'house_bl';
  if (/MASTER.*B[\/]?L/i.test(upper)) return 'master_bl';
  if (/\bMBL[-_]/i.test(upper)) return 'master_bl';
  if (/DRAFT.*B[\/]?L/i.test(upper)) return 'draft_bl';
  if (/FINAL.*B[\/]?L/i.test(upper)) return 'final_bl';
  if (/DELIVERY.*ORDER/i.test(upper)) return 'delivery_order';
  if (/\bDO[-_]\d+/i.test(upper)) return 'delivery_order';
  if (/INVOICE/i.test(upper)) return 'invoice';
  if (/\bINV[-_P]\d+/i.test(upper)) return 'invoice';
  if (/PACKING.*LIST/i.test(upper)) return 'packing_list';
  if (/\bVGM\b/i.test(upper)) return 'vgm';
  if (/ENTRY.*SUMMARY/i.test(upper)) return 'customs_entry';
  if (/\b7501\b/.test(upper)) return 'customs_entry';
  if (/CERTIFICATE/i.test(upper)) return 'certificate';

  return 'other';
}

async function main() {
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const allMode = args.includes('--all');
  const statsMode = args.includes('--stats');
  const sampleSize = sampleMode
    ? parseInt(args[args.indexOf('--sample') + 1] || '20')
    : 20;

  console.log('DOCUMENT RECLASSIFICATION');
  console.log('='.repeat(70));
  console.log('Reclassifies documents using ContentClassificationService');
  console.log('Fixes: Invoice -> "shipping_instructions" misclassifications');
  console.log('='.repeat(70));

  // Current document counts
  const { data: currentCounts } = await supabase
    .from('documents')
    .select('document_type');

  const countsByType: Record<string, number> = {};
  for (const doc of currentCounts || []) {
    countsByType[doc.document_type] = (countsByType[doc.document_type] || 0) + 1;
  }

  console.log('\nCurrent document counts:');
  for (const [type, count] of Object.entries(countsByType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  if (statsMode) {
    return;
  }

  if (!sampleMode && !allMode) {
    console.log('\nUsage:');
    console.log('  npx tsx scripts/run-document-reclassification.ts --sample 20');
    console.log('  npx tsx scripts/run-document-reclassification.ts --all');
    console.log('  npx tsx scripts/run-document-reclassification.ts --stats');
    return;
  }

  // Fetch documents with their attachments
  console.log(`\nFetching documents${sampleMode ? ` (sample: ${sampleSize})` : ''}...`);

  let query = supabase
    .from('documents')
    .select(`
      id,
      document_type,
      primary_reference,
      current_version_id
    `);

  if (sampleMode) {
    query = query.limit(sampleSize);
  }

  const { data: documents, error } = await query;

  if (error) {
    console.error('Failed to fetch documents:', error.message);
    return;
  }

  console.log(`Fetched ${documents?.length || 0} documents\n`);

  // Stats tracking
  const stats = {
    processed: 0,
    reclassified: 0,
    unchanged: 0,
    noContent: 0,
    errors: 0,
    changes: {} as Record<string, Record<string, number>>,
  };

  // Process each document
  for (const doc of documents || []) {
    stats.processed++;

    try {
      // Get version to find attachment
      if (!doc.current_version_id) continue;

      const { data: version } = await supabase
        .from('document_versions')
        .select('first_seen_attachment_id')
        .eq('id', doc.current_version_id)
        .single();

      if (!version?.first_seen_attachment_id) continue;

      const { data: attachment } = await supabase
        .from('raw_attachments')
        .select('filename, extracted_text')
        .eq('id', version.first_seen_attachment_id)
        .single();

      if (!attachment) continue;

      // Classify using content
      let newType: DocumentType = 'other';

      if (attachment.extracted_text && attachment.extracted_text.length >= 50) {
        const classification = contentClassifier.classify({
          pdfContent: attachment.extracted_text,
        });

        if (classification && classification.confidence >= 70) {
          newType = mapToRegistryType(classification.documentType);
        }
      }

      // Fallback to filename
      if (newType === 'other' && attachment.filename) {
        newType = classifyByFilename(attachment.filename);
      }

      const oldType = doc.document_type;

      // Track change
      if (oldType !== newType) {
        stats.reclassified++;

        if (!stats.changes[oldType]) stats.changes[oldType] = {};
        stats.changes[oldType][newType] = (stats.changes[oldType][newType] || 0) + 1;

        // Sample output
        if (stats.reclassified <= 30) {
          console.log(`[${stats.reclassified}] ${oldType} -> ${newType}`);
          console.log(`    File: ${attachment.filename?.substring(0, 50)}`);
          console.log(`    Ref: ${doc.primary_reference}`);
        }

        // Update document
        if (allMode) {
          await supabase
            .from('documents')
            .update({ document_type: newType })
            .eq('id', doc.id);
        }
      } else {
        stats.unchanged++;
      }
    } catch (error) {
      stats.errors++;
    }

    // Progress
    if (stats.processed % 50 === 0) {
      console.log(`  ... processed ${stats.processed}/${documents?.length || 0}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nProcessed: ${stats.processed}`);
  console.log(`Reclassified: ${stats.reclassified}`);
  console.log(`Unchanged: ${stats.unchanged}`);
  console.log(`Errors: ${stats.errors}`);

  console.log('\nReclassification changes:');
  for (const [from, tos] of Object.entries(stats.changes)) {
    for (const [to, count] of Object.entries(tos)) {
      console.log(`  ${from} -> ${to}: ${count}`);
    }
  }

  if (sampleMode) {
    console.log('\n[Sample mode - no updates made]');
    console.log('Run with --all to apply changes');
  }
}

main().catch(console.error);
