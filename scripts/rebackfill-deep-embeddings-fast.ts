/**
 * FAST Re-backfill ALL embeddings with DEEP content
 *
 * Uses parallel processing for speed.
 * Processes 10 concurrent requests at a time.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const BATCH_SIZE = 100;  // Records per batch
const CONCURRENCY = 10;  // Parallel embedding requests

interface ChronicleRecord {
  id: string;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  document_type: string | null;
  attachments: any[] | null;
  container_numbers: string[] | null;
  mbl_number: string | null;
  hbl_number: string | null;
  vessel_name: string | null;
  shipper_name: string | null;
  consignee_name: string | null;
  origin_location: string | null;
  destination_location: string | null;
  issue_description: string | null;
  action_description: string | null;
  commodity: string | null;
}

/**
 * Build deep text for embedding
 */
function buildDeepText(r: ChronicleRecord): string {
  const parts: string[] = [];

  if (r.document_type) parts.push(`[${r.document_type}]`);
  if (r.subject) parts.push(r.subject);
  if (r.summary) parts.push(r.summary);
  if (r.body_preview) parts.push(r.body_preview.substring(0, 500));

  if (r.container_numbers?.length) parts.push(`containers: ${r.container_numbers.join(', ')}`);
  if (r.mbl_number) parts.push(`MBL: ${r.mbl_number}`);
  if (r.hbl_number) parts.push(`HBL: ${r.hbl_number}`);
  if (r.vessel_name) parts.push(`vessel: ${r.vessel_name}`);

  if (r.shipper_name) parts.push(`shipper: ${r.shipper_name}`);
  if (r.consignee_name) parts.push(`consignee: ${r.consignee_name}`);

  if (r.origin_location) parts.push(`origin: ${r.origin_location}`);
  if (r.destination_location) parts.push(`destination: ${r.destination_location}`);

  if (r.issue_description) parts.push(`issue: ${r.issue_description}`);
  if (r.action_description) parts.push(`action: ${r.action_description}`);

  if (r.commodity) parts.push(`commodity: ${r.commodity}`);

  // Attachment text
  if (r.attachments && Array.isArray(r.attachments)) {
    for (const att of r.attachments) {
      const extractedText = att.extractedText || att.extracted_text || '';
      if (extractedText) {
        parts.push(`attachment: ${extractedText.substring(0, 1000)}`);
        break;
      }
    }
  }

  return parts.filter(Boolean).join(' | ');
}

/**
 * Generate embedding via Edge Function
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!response.ok) {
      console.error(`Embedding API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error('Embedding error:', error);
    return null;
  }
}

/**
 * Process a single record
 */
async function processRecord(record: ChronicleRecord): Promise<boolean> {
  const text = buildDeepText(record);
  const embedding = await generateEmbedding(text);

  if (!embedding) return false;

  const { error } = await supabase
    .from('chronicle')
    .update({
      embedding: embedding,
      embedding_generated_at: new Date().toISOString(),
    })
    .eq('id', record.id);

  return !error;
}

/**
 * Process records in parallel with limited concurrency
 */
async function processInParallel(records: ChronicleRecord[]): Promise<{ success: number; errors: number }> {
  let success = 0;
  let errors = 0;

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < records.length; i += CONCURRENCY) {
    const chunk = records.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(processRecord));

    for (const result of results) {
      if (result) success++;
      else errors++;
    }
  }

  return { success, errors };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('FAST RE-BACKFILL - DEEP EMBEDDINGS');
  console.log('═'.repeat(70));
  console.log(`Concurrency: ${CONCURRENCY} parallel requests`);
  console.log(`Batch size: ${BATCH_SIZE} records\n`);

  // Get total count
  const { count: totalCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Total records: ${totalCount}\n`);

  let processed = 0;
  let errors = 0;
  let offset = 0;
  const startTime = Date.now();

  while (offset < (totalCount || 0)) {
    // Fetch batch
    const { data: batch, error } = await supabase
      .from('chronicle')
      .select(`
        id, subject, summary, body_preview, document_type, attachments,
        container_numbers, mbl_number, hbl_number, vessel_name,
        shipper_name, consignee_name, origin_location, destination_location,
        issue_description, action_description, commodity
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !batch || batch.length === 0) break;

    // Process in parallel
    const result = await processInParallel(batch as ChronicleRecord[]);

    processed += result.success;
    errors += result.errors;
    offset += batch.length;

    // Progress
    const percent = Math.round((offset / (totalCount || 1)) * 100);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = elapsed > 0 ? (processed / elapsed).toFixed(1) : '0';
    const eta = elapsed > 0 ? Math.round(((totalCount || 0) - offset) / (processed / elapsed)) : 0;

    console.log(
      `[${percent.toString().padStart(3)}%] ` +
      `Processed: ${processed.toString().padStart(6)} | ` +
      `Errors: ${errors} | ` +
      `Rate: ${rate}/s | ` +
      `ETA: ${Math.floor(eta / 60)}m ${eta % 60}s`
    );
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);

  console.log('\n' + '═'.repeat(70));
  console.log('COMPLETE');
  console.log('═'.repeat(70));
  console.log(`  Processed: ${processed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
  console.log(`  Rate: ${(processed / totalTime).toFixed(1)} records/sec`);
  console.log('═'.repeat(70));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
