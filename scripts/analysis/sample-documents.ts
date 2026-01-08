/**
 * Sample Documents for Schema Creation
 *
 * Fetches sample documents of each type to analyze structure.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface DocSample {
  id: string;
  filename: string;
  text: string;
  category: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DOCUMENT SAMPLING FOR SCHEMA CREATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get all attachments with extracted text
  const { data: attachments, error } = await supabase
    .from('raw_attachments')
    .select('id, filename, extracted_text')
    .eq('extraction_status', 'completed')
    .not('extracted_text', 'is', null);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log(`Total attachments with text: ${attachments?.length || 0}\n`);

  // Categorize documents
  const samples: Record<string, DocSample[]> = {
    bl_draft: [],
    bl_final: [],
    booking_confirmation: [],
    freight_invoice: [],
    arrival_notice: [],
    packing_list: [],
    commercial_invoice: [],
    entry_summary: [],
    shipping_instruction: [],
    delivery_order: [],
  };

  for (const att of attachments || []) {
    const fn = (att.filename || '').toLowerCase();
    const text = (att.extracted_text || '').toUpperCase();

    const sample: DocSample = {
      id: att.id,
      filename: att.filename,
      text: att.extracted_text || '',
      category: 'unknown'
    };

    // Categorize based on filename and content
    if (fn.includes('draft') && (fn.includes('bl') || text.includes('BILL OF LADING'))) {
      sample.category = 'bl_draft';
      samples.bl_draft.push(sample);
    } else if (text.includes('BILL OF LADING') && !text.includes('DRAFT')) {
      sample.category = 'bl_final';
      samples.bl_final.push(sample);
    } else if (fn.includes('bc') || text.includes('BOOKING CONFIRMATION')) {
      sample.category = 'booking_confirmation';
      samples.booking_confirmation.push(sample);
    } else if (text.includes('ARRIVAL NOTICE')) {
      sample.category = 'arrival_notice';
      samples.arrival_notice.push(sample);
    } else if (text.includes('PACKING LIST')) {
      sample.category = 'packing_list';
      samples.packing_list.push(sample);
    } else if (text.includes('COMMERCIAL INVOICE')) {
      sample.category = 'commercial_invoice';
      samples.commercial_invoice.push(sample);
    } else if (text.includes('ENTRY SUMMARY') || text.includes('CBP FORM 7501')) {
      sample.category = 'entry_summary';
      samples.entry_summary.push(sample);
    } else if (text.includes('SHIPPING INSTRUCTION')) {
      sample.category = 'shipping_instruction';
      samples.shipping_instruction.push(sample);
    } else if (text.includes('DELIVERY ORDER')) {
      sample.category = 'delivery_order';
      samples.delivery_order.push(sample);
    } else if (fn.includes('inv') || text.includes('INVOICE')) {
      sample.category = 'freight_invoice';
      samples.freight_invoice.push(sample);
    }
  }

  // Print summary
  console.log('Documents by category:');
  for (const [cat, docs] of Object.entries(samples)) {
    console.log(`  ${cat}: ${docs.length}`);
  }

  // Save samples to files for analysis
  const outputDir = '/Users/dineshtarachandani/intdb/scripts/analysis/document_samples';

  // Create directory if not exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('\n─── SAVING SAMPLES ───\n');

  for (const [category, docs] of Object.entries(samples)) {
    if (docs.length === 0) continue;

    // Take up to 3 samples per category
    const sampleDocs = docs.slice(0, 3);

    for (let i = 0; i < sampleDocs.length; i++) {
      const doc = sampleDocs[i];
      const filename = `${category}_sample_${i + 1}.txt`;
      const filepath = `${outputDir}/${filename}`;

      const content = `FILENAME: ${doc.filename}
CATEGORY: ${category}
========================================

${doc.text}
`;

      fs.writeFileSync(filepath, content);
      console.log(`Saved: ${filename} (${doc.text.length} chars)`);
    }
  }

  console.log(`\nSamples saved to: ${outputDir}`);
  console.log('\n═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
