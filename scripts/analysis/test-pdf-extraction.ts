/**
 * Test PDF Attachment Entity Extraction
 *
 * Tests if entity patterns work on extracted PDF content.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { createSenderAwareExtractor } from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PDF ATTACHMENT ENTITY EXTRACTION TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const extractor = createSenderAwareExtractor(supabase);

  // Get PDFs with extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, extracted_text')
    .eq('extraction_status', 'completed')
    .eq('mime_type', 'application/pdf')
    .not('extracted_text', 'is', null)
    .limit(5);

  console.log(`Testing on ${attachments?.length || 0} PDFs\n`);

  let totalEntities = 0;
  const allTypes: Record<string, number> = {};

  for (const att of attachments || []) {
    console.log('─── ' + att.filename + ' ───');
    console.log('  Text length:', (att.extracted_text || '').length, 'chars');

    // Preview text
    const preview = (att.extracted_text || '').slice(0, 150).replace(/\n/g, ' ');
    console.log('  Preview:', preview + '...');

    // Extract entities
    const result = await extractor.extract({
      emailId: att.email_id,
      senderEmail: 'unknown@carrier.com',
      subject: att.filename,
      bodyText: att.extracted_text || '',
      sourceType: 'attachment',
    });

    console.log('  Entities:', result.extractions.length);
    totalEntities += result.extractions.length;

    // Group by type
    const byType: Record<string, string[]> = {};
    for (const e of result.extractions) {
      if (!byType[e.entityType]) byType[e.entityType] = [];
      byType[e.entityType].push(e.entityValue);
      allTypes[e.entityType] = (allTypes[e.entityType] || 0) + 1;
    }

    for (const [type, values] of Object.entries(byType)) {
      console.log(`    ${type}: ${values.slice(0, 2).join(', ')}`);
    }
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total entities extracted from PDFs: ${totalEntities}`);
  console.log('\nBy entity type:');
  Object.entries(allTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
}

main().catch(console.error);
