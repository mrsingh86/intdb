/**
 * Document Registry Backfill
 *
 * Populates the document registry from existing business document attachments.
 * Creates documents and versions, links attachments.
 *
 * WHAT IT DOES:
 * 1. Fetches all business document attachments (PDFs, Excel, Word)
 * 2. Extracts references from filename and extracted_text
 * 3. Creates documents and versions in registry
 * 4. Links attachments to versions
 * 5. Detects duplicates (same content shared multiple times)
 *
 * Usage:
 *   npx tsx scripts/run-document-registry-backfill.ts --sample 50     # Test
 *   npx tsx scripts/run-document-registry-backfill.ts --all           # Full run
 *   npx tsx scripts/run-document-registry-backfill.ts --stats         # Show stats only
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { createHash } from 'crypto';
import {
  DocumentRegistryService,
  createDocumentRegistryService,
} from '../lib/services/document-registry-service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const registryService = createDocumentRegistryService(supabase);

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Compute content hash from available data.
 * Since we don't have actual file bytes, use extracted_text + filename + size as proxy.
 */
function computeProxyHash(
  filename: string,
  extractedText: string | null,
  sizeBytes: number
): string {
  const content = [
    filename,
    sizeBytes.toString(),
    (extractedText || '').substring(0, 2000), // First 2000 chars of extracted text
  ].join('|');

  return createHash('sha256').update(content).digest('hex');
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const allMode = args.includes('--all');
  const statsMode = args.includes('--stats');
  const sampleSize = sampleMode
    ? parseInt(args[args.indexOf('--sample') + 1] || '50')
    : 50;

  console.log('DOCUMENT REGISTRY BACKFILL');
  console.log('='.repeat(70));
  console.log('Creates documents and versions from existing attachments');
  console.log('Tracks: SI iterations, BL versions, Invoice amendments, duplicates');
  console.log('='.repeat(70));

  // Get counts
  const { count: totalAttachments } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('is_business_document', true);

  const { count: existingDocs } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true });

  const { count: existingVersions } = await supabase
    .from('document_versions')
    .select('*', { count: 'exact', head: true });

  console.log(`\nCurrent state:`);
  console.log(`  Business document attachments: ${totalAttachments}`);
  console.log(`  Documents in registry: ${existingDocs}`);
  console.log(`  Document versions: ${existingVersions}`);

  if (statsMode) {
    await showStats();
    return;
  }

  if (!sampleMode && !allMode) {
    console.log('\nUsage:');
    console.log('  npx tsx scripts/run-document-registry-backfill.ts --sample 50');
    console.log('  npx tsx scripts/run-document-registry-backfill.ts --all');
    console.log('  npx tsx scripts/run-document-registry-backfill.ts --stats');
    return;
  }

  // Fetch attachments
  console.log(`\nFetching ${sampleMode ? sampleSize : 'all'} business document attachments...`);

  let attachments: any[] = [];
  const BATCH_SIZE = 500;

  if (sampleMode) {
    const { data, error } = await supabase
      .from('raw_attachments')
      .select(`
        id,
        email_id,
        filename,
        mime_type,
        size_bytes,
        extracted_text,
        raw_emails!inner(id, received_at)
      `)
      .eq('is_business_document', true)
      .is('document_version_id', null) // Not yet registered
      .limit(sampleSize);

    if (error) {
      console.error('Failed to fetch attachments:', error.message);
      return;
    }
    attachments = data || [];
  } else {
    // Fetch all in batches
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('raw_attachments')
        .select(`
          id,
          email_id,
          filename,
          mime_type,
          size_bytes,
          extracted_text,
          raw_emails!inner(id, received_at)
        `)
        .eq('is_business_document', true)
        .is('document_version_id', null)
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        console.error('Failed to fetch attachments:', error.message);
        return;
      }

      if (data && data.length > 0) {
        attachments = attachments.concat(data);
        offset += BATCH_SIZE;
        console.log(`  Fetched ${attachments.length} attachments...`);
      }

      hasMore = data && data.length === BATCH_SIZE;
    }
  }

  console.log(`\nProcessing ${attachments.length} attachments...\n`);

  // Stats tracking
  const stats = {
    processed: 0,
    success: 0,
    failed: 0,
    newDocuments: 0,
    newVersions: 0,
    duplicates: 0,
    noReference: 0,
    byDocType: {} as Record<string, number>,
    errors: [] as string[],
  };

  // Process attachments
  for (const att of attachments) {
    stats.processed++;

    try {
      // Compute content hash
      const contentHash = computeProxyHash(
        att.filename,
        att.extracted_text,
        att.size_bytes
      );

      // Get email received_at
      const receivedAt = att.raw_emails?.received_at || new Date().toISOString();

      // Register in document registry
      const result = await registryService.registerAttachment(
        att.id,
        contentHash,
        att.filename,
        att.extracted_text,
        att.email_id,
        receivedAt
      );

      if (result.success) {
        stats.success++;

        if (result.isNewDocument) stats.newDocuments++;
        if (result.isNewVersion) stats.newVersions++;
        if (result.isDuplicate) stats.duplicates++;
        if (!result.documentId) stats.noReference++;

        // Track by document type
        const refs = registryService.extractReferences(att.filename, att.extracted_text);
        stats.byDocType[refs.documentType] = (stats.byDocType[refs.documentType] || 0) + 1;

        // Show sample output
        if (stats.processed <= 20) {
          const icon = result.isDuplicate ? '🔄' : result.isNewVersion ? '📝' : result.isNewDocument ? '📄' : '❓';
          const status = result.isDuplicate
            ? 'DUP'
            : result.isNewVersion
            ? 'NEW_VER'
            : result.isNewDocument
            ? 'NEW_DOC'
            : 'NO_REF';
          console.log(
            `[${stats.processed}] ${icon} ${status.padEnd(8)} ${att.filename?.substring(0, 45)}`
          );
          if (result.documentId) {
            console.log(`     ↳ doc: ${result.documentId.substring(0, 8)}... ver: ${result.versionId?.substring(0, 8)}...`);
          }
        }
      } else {
        stats.failed++;
        if (stats.errors.length < 10) {
          stats.errors.push(`${att.filename}: ${result.error}`);
        }
      }
    } catch (error) {
      stats.failed++;
      if (stats.errors.length < 10) {
        stats.errors.push(`${att.filename}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // Progress
    if (stats.processed % 100 === 0) {
      console.log(`  ... processed ${stats.processed}/${attachments.length}`);
    }

    // Rate limiting
    if (stats.processed % 50 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nProcessed: ${stats.processed}`);
  console.log(`Success: ${stats.success}`);
  console.log(`Failed: ${stats.failed}`);

  console.log(`\nDocument registry:`);
  console.log(`  New documents created: ${stats.newDocuments}`);
  console.log(`  New versions created: ${stats.newVersions}`);
  console.log(`  Duplicates detected: ${stats.duplicates}`);
  console.log(`  No reference found: ${stats.noReference}`);

  console.log(`\nBy document type:`);
  const sortedTypes = Object.entries(stats.byDocType)
    .sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type}: ${count}`);
  }

  if (stats.errors.length > 0) {
    console.log(`\nSample errors:`);
    for (const err of stats.errors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  }

  // Verify final state
  await showStats();
}

async function showStats() {
  console.log('\n' + '='.repeat(70));
  console.log('DOCUMENT REGISTRY STATISTICS');
  console.log('='.repeat(70));

  // Documents by type
  const { data: docsByType } = await supabase
    .from('documents')
    .select('document_type')
    .then(({ data }) => {
      const counts: Record<string, number> = {};
      for (const doc of data || []) {
        counts[doc.document_type] = (counts[doc.document_type] || 0) + 1;
      }
      return { data: counts };
    });

  console.log('\nDocuments by type:');
  for (const [type, count] of Object.entries(docsByType || {}).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Documents with multiple versions
  const { data: multiVersion } = await supabase
    .from('documents')
    .select('id, primary_reference, document_type, version_count')
    .gt('version_count', 1)
    .order('version_count', { ascending: false })
    .limit(10);

  console.log('\nDocuments with multiple versions (top 10):');
  for (const doc of multiVersion || []) {
    console.log(`  ${doc.document_type}: ${doc.primary_reference} - ${doc.version_count} versions`);
  }

  // Attachments linked vs unlinked
  const { count: linked } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('is_business_document', true)
    .not('document_version_id', 'is', null);

  const { count: unlinked } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('is_business_document', true)
    .is('document_version_id', null);

  console.log(`\nAttachment linkage:`);
  console.log(`  Linked to documents: ${linked}`);
  console.log(`  Not yet linked: ${unlinked}`);
}

main().catch(console.error);
