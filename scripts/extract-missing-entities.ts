/**
 * Extract Missing Entities
 *
 * Processes emails that have classifications but NO entity extractions.
 * This fixes the gap where 97% of emails were classified but never had entities extracted.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/extract-missing-entities.ts
 *
 * Environment:
 *   BATCH_SIZE     - Emails per batch (default: 50)
 *   MAX_TOTAL      - Maximum emails to process (default: all)
 *   RATE_LIMIT_MS  - Delay between API calls (default: 150)
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configuration
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const MAX_TOTAL = parseInt(process.env.MAX_TOTAL || '0') || null;
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '150');

// Document types that should have entities extracted
const LINKABLE_DOC_TYPES = [
  'booking_confirmation',
  'booking_amendment',
  'booking_cancellation',
  'bill_of_lading',
  'shipping_instruction',
  'arrival_notice',
  'invoice',
  'freight_invoice',
  'delivery_order',
  'container_release',
  'vgm_submission',
  'customs_document',
  'cargo_manifest',
  'vessel_schedule',
  'railment_status',
  'rate_confirmation'
];

interface ExtractionResult {
  emailId: string;
  entitiesExtracted: number;
  shipmentLinked: boolean;
  error?: string;
}

interface Stats {
  totalToProcess: number;
  processed: number;
  successful: number;
  failed: number;
  entitiesExtracted: number;
  shipmentsLinked: number;
  startTime: number;
}

async function getEmailsWithoutEntities(): Promise<string[]> {
  console.log('Finding emails without entity extractions...');

  // Get all email IDs that have entities
  const { data: emailsWithEntities } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const emailsWithEntitiesSet = new Set(emailsWithEntities?.map(e => e.email_id) || []);
  console.log(`Emails WITH entities: ${emailsWithEntitiesSet.size}`);

  // Get emails with linkable classifications that DON'T have entities
  const emailsToProcess: string[] = [];
  let offset = 0;

  while (true) {
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('document_type', LINKABLE_DOC_TYPES)
      .range(offset, offset + 999);

    if (!classifications || classifications.length === 0) break;

    for (const c of classifications) {
      if (!emailsWithEntitiesSet.has(c.email_id)) {
        emailsToProcess.push(c.email_id);
      }
    }

    offset += 1000;
    if (classifications.length < 1000) break;
  }

  // Deduplicate
  const unique = [...new Set(emailsToProcess)];
  console.log(`Emails needing entity extraction: ${unique.length}`);

  return unique;
}

async function extractEntitiesFromEmail(emailId: string): Promise<ExtractionResult> {
  try {
    // Get email data
    const { data: email, error: emailError } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text, snippet')
      .eq('id', emailId)
      .single();

    if (emailError || !email) {
      return { emailId, entitiesExtracted: 0, shipmentLinked: false, error: 'Email not found' };
    }

    // Get classification
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', emailId)
      .single();

    // Get attachment text
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('extracted_text')
      .eq('email_id', emailId)
      .not('extracted_text', 'is', null);

    const attachmentText = attachments?.map(a => a.extracted_text).join('\n\n') || '';

    // Prepare text for extraction
    const fullText = [
      `Subject: ${email.subject || ''}`,
      `From: ${email.sender_email || ''}`,
      `Body: ${email.body_text || email.snippet || ''}`,
      attachmentText ? `\nAttachment Content:\n${attachmentText}` : ''
    ].join('\n');

    // Call Claude for entity extraction
    const entities = await extractWithClaude(fullText, classification?.document_type || 'unknown');

    if (entities.length === 0) {
      return { emailId, entitiesExtracted: 0, shipmentLinked: false };
    }

    // Store entities
    for (const entity of entities) {
      await supabase
        .from('entity_extractions')
        .upsert({
          email_id: emailId,
          entity_type: entity.type,
          entity_value: entity.value,
          confidence: entity.confidence || 0.9,
          extraction_method: 'ai',
          source: 'email_body',
          created_at: new Date().toISOString()
        }, {
          onConflict: 'email_id,entity_type'
        });
    }

    // Try to link to shipment
    const shipmentLinked = await linkToShipment(emailId, entities, classification?.document_type || 'unknown');

    return {
      emailId,
      entitiesExtracted: entities.length,
      shipmentLinked
    };

  } catch (error: any) {
    return {
      emailId,
      entitiesExtracted: 0,
      shipmentLinked: false,
      error: error.message
    };
  }
}

async function extractWithClaude(text: string, docType: string): Promise<Array<{type: string, value: string, confidence?: number}>> {
  const prompt = `Extract shipping entities from this ${docType} email/document.

TEXT:
${text.substring(0, 8000)}

Extract these entities if present:
- booking_number (carrier booking reference)
- bl_number (bill of lading number)
- container_number (container ID like MRKU1234567)
- vessel_name (ship name)
- voyage_number (voyage ID)
- port_of_loading (origin port)
- port_of_discharge (destination port)
- etd (estimated departure date)
- eta (estimated arrival date)
- si_cutoff (shipping instruction deadline)
- vgm_cutoff (verified gross mass deadline)
- cargo_cutoff (cargo delivery deadline)
- shipper (shipper company name)
- consignee (consignee company name)
- carrier (shipping line name)

Return JSON array:
[{"type": "booking_number", "value": "123456789", "confidence": 0.95}, ...]

Rules:
- Only include entities you're confident about
- For dates, use ISO format YYYY-MM-DD
- For ports, use full name not codes
- Return [] if no entities found`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Claude extraction error:', error);
    return [];
  }
}

async function linkToShipment(
  emailId: string,
  entities: Array<{type: string, value: string}>,
  docType: string
): Promise<boolean> {
  // Find booking or BL number
  const bookingNumber = entities.find(e => e.type === 'booking_number')?.value;
  const blNumber = entities.find(e => e.type === 'bl_number')?.value;

  if (!bookingNumber && !blNumber) return false;

  // Find matching shipment
  let shipmentId: string | null = null;

  if (bookingNumber) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (data) shipmentId = data.id;
  }

  if (!shipmentId && blNumber) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('bl_number', blNumber)
      .single();

    if (data) shipmentId = data.id;
  }

  if (!shipmentId) return false;

  // Create link
  const { error } = await supabase
    .from('shipment_documents')
    .insert({
      shipment_id: shipmentId,
      email_id: emailId,
      document_type: docType,
      link_method: 'ai',
      created_at: new Date().toISOString()
    });

  return !error;
}

function printProgress(stats: Stats): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed / elapsed;
  const remaining = (stats.totalToProcess - stats.processed) / rate;

  const percent = ((stats.processed / stats.totalToProcess) * 100).toFixed(1);
  const bar = '='.repeat(Math.floor(stats.processed / stats.totalToProcess * 40));
  const empty = ' '.repeat(40 - bar.length);

  process.stdout.write(
    `\r[${bar}${empty}] ${percent}% | ` +
    `${stats.processed}/${stats.totalToProcess} | ` +
    `Entities: ${stats.entitiesExtracted} | ` +
    `Linked: ${stats.shipmentsLinked} | ` +
    `ETA: ${Math.ceil(remaining)}s   `
  );
}

async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  EXTRACT MISSING ENTITIES');
  console.log('  Fixing emails with classifications but no entity extractions');
  console.log('═'.repeat(70));
  console.log('');

  // Get emails to process
  let emailIds = await getEmailsWithoutEntities();

  if (MAX_TOTAL && emailIds.length > MAX_TOTAL) {
    emailIds = emailIds.slice(0, MAX_TOTAL);
    console.log(`Limited to ${MAX_TOTAL} emails`);
  }

  if (emailIds.length === 0) {
    console.log('No emails need entity extraction!');
    return;
  }

  console.log(`\nProcessing ${emailIds.length} emails...`);
  console.log(`Batch size: ${BATCH_SIZE}, Rate limit: ${RATE_LIMIT_MS}ms\n`);

  const stats: Stats = {
    totalToProcess: emailIds.length,
    processed: 0,
    successful: 0,
    failed: 0,
    entitiesExtracted: 0,
    shipmentsLinked: 0,
    startTime: Date.now()
  };

  // Process in batches
  for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
    const batch = emailIds.slice(i, i + BATCH_SIZE);

    for (const emailId of batch) {
      const result = await extractEntitiesFromEmail(emailId);

      stats.processed++;
      if (result.error) {
        stats.failed++;
      } else {
        stats.successful++;
        stats.entitiesExtracted += result.entitiesExtracted;
        if (result.shipmentLinked) stats.shipmentsLinked++;
      }

      printProgress(stats);

      // Rate limiting
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // Final summary
  console.log('\n\n' + '═'.repeat(70));
  console.log('  EXTRACTION COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
  console.log('RESULTS:');
  console.log(`  Processed:          ${stats.processed}`);
  console.log(`  Successful:         ${stats.successful}`);
  console.log(`  Failed:             ${stats.failed}`);
  console.log(`  Entities Extracted: ${stats.entitiesExtracted}`);
  console.log(`  Shipments Linked:   ${stats.shipmentsLinked}`);
  console.log('');

  // Verify final state
  const { count: totalWithEntities } = await supabase
    .from('entity_extractions')
    .select('email_id', { count: 'exact', head: true });

  const { data: uniqueEmails } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const uniqueCount = new Set(uniqueEmails?.map(e => e.email_id) || []).size;

  console.log('FINAL STATE:');
  console.log(`  Total entity records: ${totalWithEntities}`);
  console.log(`  Unique emails with entities: ${uniqueCount}`);
  console.log('');
  console.log('═'.repeat(70));
}

main().catch(console.error);
