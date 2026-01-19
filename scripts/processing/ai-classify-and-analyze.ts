/**
 * AI Classification + Pattern Analysis
 *
 * 1. Run AI on documents missing content-first classification
 * 2. Analyze PDF content to find deterministic patterns
 * 3. Output suggested content markers for config
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const BATCH_SIZE = 20;
const DRY_RUN = !process.argv.includes('--execute');

interface ClassificationResult {
  oldType: string;
  aiType: string;
  confidence: number;
  reasoning: string;
  extractedText: string;
  filename: string;
}

async function classifyWithAI(text: string, filename: string): Promise<{ type: string; confidence: number; reasoning: string }> {
  const prompt = `Classify this shipping/logistics document. Return JSON only.

Document types: booking_confirmation, booking_amendment, booking_cancellation, arrival_notice,
shipping_instruction, shipping_bill, bill_of_lading, hbl, mbl, draft_hbl, sob_confirmation,
delivery_order, invoice, freight_invoice, duty_invoice, commercial_invoice, payment_receipt,
packing_list, entry_summary, cargo_manifest, vgm_confirmation, gate_in_confirmation,
vessel_schedule, delay_notice, container_release, empty_return, proof_of_delivery,
rate_quote, rate_confirmation, isf_filing, customs_clearance, shipment_notice, unknown

Filename: ${filename}
Content (first 3000 chars):
${text.slice(0, 3000)}

Return: {"type": "...", "confidence": 0-100, "reasoning": "brief reason", "key_markers": ["word1", "word2"]}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const json = JSON.parse(content.text);
      return {
        type: json.type || 'unknown',
        confidence: json.confidence || 50,
        reasoning: `${json.reasoning || ''} | Markers: ${(json.key_markers || []).join(', ')}`,
      };
    }
  } catch (err: any) {
    console.error('AI error:', err.message);
  }
  return { type: 'unknown', confidence: 0, reasoning: 'AI failed' };
}

async function run() {
  console.log('='.repeat(80));
  console.log(DRY_RUN ? 'AI CLASSIFICATION - DRY RUN' : 'AI CLASSIFICATION - EXECUTING');
  console.log('='.repeat(80));

  // Get documents not yet classified by content-first
  const { data: docs, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      document_classifications!inner (
        id,
        document_type,
        model_version,
        is_manual_review
      ),
      raw_attachments!inner (
        filename,
        extracted_text
      )
    `)
    .not('document_classifications.model_version', 'like', 'content-first%')
    .not('document_classifications.is_manual_review', 'eq', true)
    .not('raw_attachments.extracted_text', 'is', null)
    .limit(200);

  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  console.log(`Found ${docs?.length || 0} documents to process\n`);

  const results: ClassificationResult[] = [];
  const patternsByType: Record<string, string[]> = {};
  let processed = 0;
  let changed = 0;
  let verified = 0;

  for (const doc of docs || []) {
    const classification = Array.isArray(doc.document_classifications)
      ? doc.document_classifications[0]
      : doc.document_classifications;
    const attachment = Array.isArray(doc.raw_attachments)
      ? doc.raw_attachments[0]
      : doc.raw_attachments;

    if (!attachment?.extracted_text || !classification) continue;

    processed++;
    process.stdout.write(`  [${processed}/${docs?.length}] ${attachment.filename?.slice(0, 40)}... `);

    const aiResult = await classifyWithAI(attachment.extracted_text, attachment.filename || '');

    const oldType = classification.document_type;
    const matches = oldType === aiResult.type;

    if (matches) {
      verified++;
      console.log(`✓ ${oldType} (verified)`);
    } else {
      changed++;
      console.log(`${oldType} → ${aiResult.type} (${aiResult.confidence}%)`);
    }

    results.push({
      oldType,
      aiType: aiResult.type,
      confidence: aiResult.confidence,
      reasoning: aiResult.reasoning,
      extractedText: attachment.extracted_text.slice(0, 500),
      filename: attachment.filename || '',
    });

    // Collect patterns by AI type
    if (!patternsByType[aiResult.type]) patternsByType[aiResult.type] = [];
    patternsByType[aiResult.type].push(attachment.extracted_text.slice(0, 1000));

    // Update database if not dry run
    if (!DRY_RUN && aiResult.confidence >= 70) {
      await supabase.from('document_classifications').update({
        document_type: aiResult.type,
        confidence_score: aiResult.confidence,
        classification_reason: `[AI] ${aiResult.reasoning}`,
        model_version: 'content-first|ai_haiku',
        classified_at: new Date().toISOString(),
      }).eq('id', classification.id);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  // Analyze patterns
  console.log('\n');
  console.log('='.repeat(80));
  console.log('PATTERN ANALYSIS - Suggested Content Markers');
  console.log('='.repeat(80));

  for (const [type, texts] of Object.entries(patternsByType)) {
    if (texts.length < 3) continue; // Need at least 3 samples

    const commonWords = findCommonPatterns(texts);
    if (commonWords.length > 0) {
      console.log(`\n${type.toUpperCase()} (${texts.length} samples):`);
      console.log(`  Suggested markers: ${commonWords.slice(0, 10).join(', ')}`);
    }
  }

  // Summary
  console.log('\n');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total processed: ${processed}`);
  console.log(`Verified (AI agrees): ${verified} (${(verified/processed*100).toFixed(1)}%)`);
  console.log(`Changed (AI differs): ${changed} (${(changed/processed*100).toFixed(1)}%)`);

  // Migration patterns
  const migrations: Record<string, number> = {};
  for (const r of results) {
    if (r.oldType !== r.aiType) {
      const key = `${r.oldType} → ${r.aiType}`;
      migrations[key] = (migrations[key] || 0) + 1;
    }
  }

  console.log('\nTop migrations:');
  Object.entries(migrations)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([pattern, count]) => console.log(`  ${pattern}: ${count}`));

  // Save results
  const fs = await import('fs');
  fs.writeFileSync('./ai-classification-results.json', JSON.stringify({
    processed,
    verified,
    changed,
    migrations,
    patternsByType: Object.fromEntries(
      Object.entries(patternsByType).map(([k, v]) => [k, v.length])
    ),
  }, null, 2));
  console.log('\nResults saved to: ./ai-classification-results.json');
}

function findCommonPatterns(texts: string[]): string[] {
  // Find words/phrases that appear in most documents
  const wordCounts: Record<string, number> = {};

  const stopWords = new Set(['THE', 'AND', 'FOR', 'THIS', 'WITH', 'FROM', 'THAT', 'ARE', 'WAS', 'HAVE', 'HAS', 'WILL', 'CAN', 'NOT', 'YOUR', 'YOU', 'ALL', 'ANY', 'BUT', 'BEEN']);

  for (const text of texts) {
    const words = new Set(
      text.toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w))
    );
    for (const word of words) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
  }

  // Return words that appear in >60% of documents
  const threshold = texts.length * 0.6;
  return Object.entries(wordCounts)
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
}

run().catch(console.error);
