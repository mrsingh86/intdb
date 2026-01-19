#!/usr/bin/env npx tsx
/**
 * Full Entity Extraction for ALL Unprocessed Emails
 *
 * Processes all 1,792 emails that don't have entity extractions yet.
 * Uses batching and rate limiting to avoid API limits.
 */

import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

if (!anthropicKey) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 300; // 300ms between requests
const MAX_EMAILS = 2000; // Safety limit

interface ExtractedEntities {
  booking_number?: string;
  bl_number?: string;
  vessel_name?: string;
  voyage_number?: string;
  port_of_loading?: string;
  port_of_discharge?: string;
  etd?: string;
  eta?: string;
  si_cutoff?: string;
  vgm_cutoff?: string;
  cargo_cutoff?: string;
  gate_cutoff?: string;
  shipper_name?: string;
  consignee_name?: string;
  container_numbers?: string[];
  commodity?: string;
  confidence: number;
}

function buildExtractionPrompt(subject: string, body: string, docType: string): string {
  const bodyPreview = (body || '').substring(0, 8000);

  return `Extract shipping/logistics entities from this ${docType} email.

SUBJECT: ${subject || 'N/A'}

EMAIL CONTENT:
${bodyPreview || '[No body content]'}

---

Extract ALL available information. Return ONLY valid JSON (no markdown):
{
  "booking_number": "string or null",
  "bl_number": "string or null",
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "port_of_loading": "string or null",
  "port_of_discharge": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null",
  "shipper_name": "company name or null",
  "consignee_name": "company name or null",
  "container_numbers": ["array"] or null,
  "commodity": "string or null",
  "confidence": 0-100
}

If no shipping data found, return {"confidence": 0}`;
}

async function extractEntities(
  subject: string,
  body: string,
  docType: string
): Promise<ExtractedEntities | null> {
  const prompt = buildExtractionPrompt(subject, body, docType);

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as ExtractedEntities;
  } catch (error: unknown) {
    return null;
  }
}

async function saveEntities(
  emailId: string,
  entities: ExtractedEntities,
  docType: string
): Promise<number> {
  const confidence = entities.confidence || 50;
  let saved = 0;

  const entityTypes: Array<[string, keyof ExtractedEntities]> = [
    ['booking_number', 'booking_number'],
    ['bl_number', 'bl_number'],
    ['vessel_name', 'vessel_name'],
    ['voyage_number', 'voyage_number'],
    ['port_of_loading', 'port_of_loading'],
    ['port_of_discharge', 'port_of_discharge'],
    ['etd', 'etd'],
    ['eta', 'eta'],
    ['si_cutoff', 'si_cutoff'],
    ['vgm_cutoff', 'vgm_cutoff'],
    ['cargo_cutoff', 'cargo_cutoff'],
    ['gate_cutoff', 'gate_cutoff'],
    ['shipper_name', 'shipper_name'],
    ['consignee_name', 'consignee_name'],
    ['container_numbers', 'container_numbers'],
    ['commodity', 'commodity'],
  ];

  for (const [entityType, entityKey] of entityTypes) {
    const value = entities[entityKey];
    if (!value) continue;

    const strValue = Array.isArray(value) ? value.join(', ') : String(value);
    if (!strValue.trim()) continue;

    // Check if exists
    const { data: existing } = await supabase
      .from('entity_extractions')
      .select('id')
      .eq('email_id', emailId)
      .eq('entity_type', entityType)
      .single();

    if (existing) continue;

    const { error } = await supabase
      .from('entity_extractions')
      .insert({
        email_id: emailId,
        entity_type: entityType,
        entity_value: strValue,
        confidence_score: confidence,
        extraction_method: 'claude-haiku-full-extraction-v1',
        source_document_type: docType,
        is_verified: false
      });

    if (!error) saved++;
  }

  return saved;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     FULL ENTITY EXTRACTION FOR ALL UNPROCESSED EMAILS             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get emails without extractions
  console.log('Finding emails without entity extractions...');

  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id')
    .order('received_at', { ascending: false });

  const { data: emailsWithEntities } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const extractedEmailIds = new Set((emailsWithEntities || []).map(e => e.email_id));
  const emailsToProcess = (allEmails || [])
    .filter(e => !extractedEmailIds.has(e.id))
    .slice(0, MAX_EMAILS);

  console.log(`Total emails: ${allEmails?.length || 0}`);
  console.log(`Already extracted: ${extractedEmailIds.size}`);
  console.log(`To process: ${emailsToProcess.length}\n`);

  if (emailsToProcess.length === 0) {
    console.log('No emails to process!');
    return;
  }

  // Get document classifications for these emails
  const emailIds = emailsToProcess.map(e => e.id);
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', emailIds);

  const emailDocTypes = new Map<string, string>();
  (classifications || []).forEach(c => emailDocTypes.set(c.email_id, c.document_type));

  // Get full email data in batches
  let totalProcessed = 0;
  let totalEntities = 0;
  let errors = 0;
  let noData = 0;

  const startTime = Date.now();

  for (let i = 0; i < emailsToProcess.length; i += BATCH_SIZE) {
    const batchIds = emailsToProcess.slice(i, i + BATCH_SIZE).map(e => e.id);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(emailsToProcess.length / BATCH_SIZE);

    console.log(`\n━━━ Batch ${batchNum}/${totalBatches} ━━━`);

    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text')
      .in('id', batchIds);

    for (const email of (emails || [])) {
      totalProcessed++;
      const progress = `[${totalProcessed}/${emailsToProcess.length}]`;
      const docType = emailDocTypes.get(email.id) || 'unknown';

      try {
        const entities = await extractEntities(
          email.subject || '',
          email.body_text || '',
          docType
        );

        if (!entities || entities.confidence < 10) {
          noData++;
          process.stdout.write('.');
          continue;
        }

        const saved = await saveEntities(email.id, entities, docType);

        if (saved > 0) {
          totalEntities += saved;
          console.log(`\n${progress} ✓ +${saved} entities (${docType})`);
        } else {
          process.stdout.write('.');
        }
      } catch (err) {
        errors++;
        process.stdout.write('x');
      }

      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }

    // Progress stats
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = totalProcessed / elapsed;
    const remaining = (emailsToProcess.length - totalProcessed) / rate;
    console.log(`\n  Progress: ${totalProcessed}/${emailsToProcess.length} | Rate: ${rate.toFixed(1)}/s | ETA: ${Math.round(remaining)}s`);
  }

  // Final stats
  const totalTime = (Date.now() - startTime) / 1000;

  console.log('\n');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('                        EXTRACTION COMPLETE');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`Emails processed:    ${totalProcessed}`);
  console.log(`New entities saved:  ${totalEntities}`);
  console.log(`No extractable data: ${noData}`);
  console.log(`Errors:              ${errors}`);
  console.log(`Time:                ${Math.round(totalTime)}s`);

  // Updated coverage
  const { data: finalEntities } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const finalUniqueEmails = new Set((finalEntities || []).map(e => e.email_id)).size;
  const { count: totalEmailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const coverage = ((finalUniqueEmails / (totalEmailCount || 1)) * 100).toFixed(1);

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('                        FINAL COVERAGE');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`Emails with extractions: ${finalUniqueEmails}/${totalEmailCount} (${coverage}%)`);
  console.log(`Total entities:          ${finalEntities?.length || 0}`);
}

main().catch(console.error);
