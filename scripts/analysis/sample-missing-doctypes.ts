/**
 * Sample Missing Document Types
 *
 * Fetches samples of document types that need extraction schemas:
 * - ISF Filing
 * - Shipping Bill (India)
 * - Container Release
 * - Proof of Delivery
 * - VGM Confirmation
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_TYPES = [
  'isf_filing',
  'isf',
  'shipping_bill',
  'container_release',
  'proof_of_delivery',
  'pod',
  'vgm_confirmation',
  'vgm',
  'booking_amendment',
  'sob_confirmation',
];

const OUTPUT_DIR = path.join(__dirname, 'document_samples');

async function sampleDocuments(): Promise<void> {
  console.log('='.repeat(70));
  console.log('SAMPLING MISSING DOCUMENT TYPES');
  console.log('='.repeat(70));

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // First, check what document types exist in classifications
  console.log('\nChecking classified document types...');
  const { data: types, error: typesError } = await supabase
    .from('document_classifications')
    .select('document_type')
    .not('document_type', 'is', null)
    .limit(5000);

  if (typesError) {
    console.error('Error fetching types:', typesError);
    return;
  }

  // Count by type
  const typeCounts = new Map<string, number>();
  for (const t of types || []) {
    const type = t.document_type?.toLowerCase() || 'unknown';
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }

  console.log('\nDocument type distribution:');
  const sortedTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes.slice(0, 30)) {
    const marker = TARGET_TYPES.some(t => type.includes(t)) ? ' ⬅️ TARGET' : '';
    console.log(`  ${type}: ${count}${marker}`);
  }

  // Sample each target type
  for (const targetType of TARGET_TYPES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Searching for: ${targetType}`);

    // Find attachments with this classification
    const { data: attachments, error } = await supabase
      .from('raw_attachments')
      .select(`
        id,
        filename,
        extracted_text,
        document_classifications!inner(
          document_type,
          confidence
        )
      `)
      .ilike('document_classifications.document_type', `%${targetType}%`)
      .not('extracted_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.log(`  Error: ${error.message}`);
      continue;
    }

    if (!attachments || attachments.length === 0) {
      console.log(`  No samples found`);

      // Try searching by filename patterns
      console.log(`  Trying filename search...`);
      const filenamePatterns: Record<string, string[]> = {
        'isf': ['ISF', 'Security Filing', '10+2'],
        'shipping_bill': ['Shipping Bill', 'SB No', 'DGFT'],
        'container_release': ['Release', 'Terminal', 'CRO'],
        'proof_of_delivery': ['POD', 'Proof of Delivery', 'Delivery Receipt'],
        'vgm': ['VGM', 'Verified Gross Mass'],
        'sob': ['SOB', 'Shipped on Board', 'On Board'],
      };

      const patterns = filenamePatterns[targetType] || [targetType];
      for (const pattern of patterns) {
        const { data: byFilename } = await supabase
          .from('raw_attachments')
          .select('id, filename, extracted_text')
          .ilike('filename', `%${pattern}%`)
          .not('extracted_text', 'is', null)
          .limit(2);

        if (byFilename && byFilename.length > 0) {
          console.log(`  Found ${byFilename.length} by filename pattern "${pattern}"`);
          for (const att of byFilename) {
            await saveDocument(att, targetType);
          }
          break;
        }
      }
      continue;
    }

    console.log(`  Found ${attachments.length} samples`);

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      await saveDocument(att, targetType, i + 1);
    }
  }

  // Also search email subjects for these types
  console.log('\n' + '='.repeat(70));
  console.log('SEARCHING EMAIL SUBJECTS');
  console.log('='.repeat(70));

  const subjectPatterns = [
    { pattern: 'ISF', type: 'isf_filing' },
    { pattern: 'Security Filing', type: 'isf_filing' },
    { pattern: 'Shipping Bill', type: 'shipping_bill' },
    { pattern: 'VGM', type: 'vgm_confirmation' },
    { pattern: 'Release', type: 'container_release' },
    { pattern: 'POD', type: 'proof_of_delivery' },
    { pattern: 'Delivered', type: 'proof_of_delivery' },
  ];

  for (const { pattern, type } of subjectPatterns) {
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text')
      .ilike('subject', `%${pattern}%`)
      .limit(2);

    if (emails && emails.length > 0) {
      console.log(`\n${type} (subject: "${pattern}"): ${emails.length} emails`);
      for (const email of emails) {
        console.log(`  - ${email.subject?.slice(0, 80)}...`);

        // Save email body as sample
        const filename = `${type}_email_sample.txt`;
        const filepath = path.join(OUTPUT_DIR, filename);
        const content = `SUBJECT: ${email.subject}\n${'='.repeat(40)}\n\n${email.body_text?.slice(0, 5000) || 'No body'}`;
        fs.writeFileSync(filepath, content);
        console.log(`    Saved to ${filename}`);
      }
    }
  }

  console.log('\n✅ Sampling complete');
}

async function saveDocument(
  att: { id: string; filename: string; extracted_text: string },
  docType: string,
  index?: number
): Promise<void> {
  const suffix = index ? `_${index}` : '';
  const safeType = docType.replace(/[^a-z0-9_]/g, '_');
  const filename = `${safeType}_sample${suffix}.txt`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const content = [
    `FILENAME: ${att.filename}`,
    `CATEGORY: ${docType}`,
    '='.repeat(40),
    '',
    att.extracted_text?.slice(0, 10000) || 'No text',
  ].join('\n');

  fs.writeFileSync(filepath, content);
  console.log(`    Saved: ${filename} (${att.extracted_text?.length || 0} chars)`);
}

sampleDocuments().catch(console.error);
