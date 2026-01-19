/**
 * Extract Entities for ALL Emails
 *
 * Reprocesses ALL emails (including already extracted) to ensure consistent
 * entity extraction across the entire database.
 *
 * Features:
 * - Processes all emails regardless of existing entities
 * - Extracts from email body + attachment text
 * - Links to existing shipments
 * - Provides detailed progress tracking
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/extract-all-entities.ts
 *
 * Environment:
 *   BATCH_SIZE     - Emails per batch (default: 50)
 *   MAX_TOTAL      - Maximum emails to process (default: all)
 *   RATE_LIMIT_MS  - Delay between API calls (default: 100)
 *   START_OFFSET   - Start from this offset (default: 0)
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
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '100');
const START_OFFSET = parseInt(process.env.START_OFFSET || '0');

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
  skipped: number;
  entitiesExtracted: number;
  shipmentsLinked: number;
  startTime: number;
  errors: Array<{ emailId: string; error: string }>;
}

async function getAllEmailIds(): Promise<string[]> {
  console.log('Fetching all emails...');

  const allIds: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('raw_emails')
      .select('id')
      .order('received_at', { ascending: true })
      .range(offset, offset + 999);

    if (error) throw new Error(`Failed to fetch emails: ${error.message}`);
    if (!data || data.length === 0) break;

    allIds.push(...data.map(e => e.id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Total emails in database: ${allIds.length}`);
  return allIds;
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

    const docType = classification?.document_type || 'unknown';

    // Skip non-shipping emails
    if (docType === 'not_shipping' || docType === 'unknown') {
      return { emailId, entitiesExtracted: 0, shipmentLinked: false };
    }

    // Get attachment text
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', emailId)
      .not('extracted_text', 'is', null);

    const attachmentText = attachments?.map(a =>
      `[${a.filename}]\n${a.extracted_text}`
    ).join('\n\n') || '';

    // Prepare text for extraction
    const fullText = [
      `Subject: ${email.subject || ''}`,
      `From: ${email.sender_email || ''}`,
      `Body: ${email.body_text || email.snippet || ''}`,
      attachmentText ? `\n--- ATTACHMENTS ---\n${attachmentText}` : ''
    ].join('\n');

    // Skip if no meaningful content
    if (fullText.length < 50) {
      return { emailId, entitiesExtracted: 0, shipmentLinked: false };
    }

    // Call Claude for entity extraction
    const entities = await extractWithClaude(fullText, docType);

    if (entities.length === 0) {
      return { emailId, entitiesExtracted: 0, shipmentLinked: false };
    }

    // Delete existing entities for this email (fresh extraction)
    await supabase
      .from('entity_extractions')
      .delete()
      .eq('email_id', emailId);

    // Store new entities
    const entitiesToInsert = entities.map(entity => ({
      email_id: emailId,
      entity_type: entity.type,
      entity_value: entity.value,
      confidence: entity.confidence || 0.9,
      extraction_method: 'ai',
      source: 'email_body',
      created_at: new Date().toISOString()
    }));

    await supabase.from('entity_extractions').insert(entitiesToInsert);

    // Try to link to shipment
    const shipmentLinked = await linkToShipment(emailId, entities, docType);

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
${text.substring(0, 10000)}

Extract these entities if present:
- booking_number (carrier booking reference, e.g., 262874542, HLBU12345678)
- bl_number (bill of lading number, e.g., HLCUNBO250224897)
- container_number (container ID like MRKU1234567, HLXU7654321)
- vessel_name (ship name, e.g., "APL SENTOSA", "EVER GIVEN")
- voyage_number (voyage ID, e.g., 0TR11W1MA)
- port_of_loading (origin port full name)
- port_of_discharge (destination port full name)
- etd (estimated departure date)
- eta (estimated arrival date)
- si_cutoff (shipping instruction deadline/cutoff)
- vgm_cutoff (verified gross mass deadline)
- cargo_cutoff (cargo delivery deadline)
- gate_cutoff (gate closing deadline)
- shipper (shipper company name)
- consignee (consignee company name)
- carrier (shipping line name - Hapag-Lloyd, Maersk, MSC, etc.)

Return JSON array:
[{"type": "booking_number", "value": "262874542", "confidence": 0.95}, ...]

Rules:
- Only include entities you're confident about (>80% confidence)
- For dates, use ISO format YYYY-MM-DD
- For ports, use full name (e.g., "Shanghai" not "CNSHA")
- Booking numbers are usually 9-12 digits or alphanumeric
- Container numbers are 11 characters (4 letters + 7 digits)
- Return [] if no entities found
- Do NOT include partial or unclear values`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const jsonMatch = content.text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate entities
    return parsed.filter((e: any) =>
      e.type &&
      e.value &&
      typeof e.value === 'string' &&
      e.value.trim().length > 0 &&
      !e.value.toLowerCase().includes('unknown') &&
      !e.value.toLowerCase().includes('n/a')
    );
  } catch (error) {
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

  // Check if link already exists
  const { data: existingLink } = await supabase
    .from('shipment_documents')
    .select('id')
    .eq('shipment_id', shipmentId)
    .eq('email_id', emailId)
    .single();

  if (existingLink) return true; // Already linked

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
    `ETA: ${Math.ceil(remaining / 60)}min   `
  );
}

async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  EXTRACT ALL ENTITIES');
  console.log('  Full re-extraction for all emails including attachments');
  console.log('═'.repeat(70));
  console.log('');

  // Get all emails
  let emailIds = await getAllEmailIds();

  // Apply offset
  if (START_OFFSET > 0) {
    emailIds = emailIds.slice(START_OFFSET);
    console.log(`Starting from offset ${START_OFFSET}`);
  }

  // Apply limit
  if (MAX_TOTAL && emailIds.length > MAX_TOTAL) {
    emailIds = emailIds.slice(0, MAX_TOTAL);
    console.log(`Limited to ${MAX_TOTAL} emails`);
  }

  if (emailIds.length === 0) {
    console.log('No emails to process!');
    return;
  }

  console.log(`\nProcessing ${emailIds.length} emails...`);
  console.log(`Batch size: ${BATCH_SIZE}, Rate limit: ${RATE_LIMIT_MS}ms\n`);

  const stats: Stats = {
    totalToProcess: emailIds.length,
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    entitiesExtracted: 0,
    shipmentsLinked: 0,
    startTime: Date.now(),
    errors: []
  };

  // Process emails
  for (let i = 0; i < emailIds.length; i++) {
    const emailId = emailIds[i];

    const result = await extractEntitiesFromEmail(emailId);

    stats.processed++;
    if (result.error) {
      stats.failed++;
      if (stats.errors.length < 20) {
        stats.errors.push({ emailId, error: result.error });
      }
    } else if (result.entitiesExtracted === 0) {
      stats.skipped++;
    } else {
      stats.successful++;
      stats.entitiesExtracted += result.entitiesExtracted;
      if (result.shipmentLinked) stats.shipmentsLinked++;
    }

    printProgress(stats);

    // Rate limiting
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  // Final summary
  const elapsed = (Date.now() - stats.startTime) / 1000;

  console.log('\n\n' + '═'.repeat(70));
  console.log('  EXTRACTION COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
  console.log('RESULTS:');
  console.log(`  Processed:          ${stats.processed}`);
  console.log(`  With Entities:      ${stats.successful}`);
  console.log(`  Skipped (no content): ${stats.skipped}`);
  console.log(`  Failed:             ${stats.failed}`);
  console.log(`  Entities Extracted: ${stats.entitiesExtracted}`);
  console.log(`  Shipments Linked:   ${stats.shipmentsLinked}`);
  console.log(`  Time Elapsed:       ${Math.round(elapsed / 60)} minutes`);
  console.log('');

  if (stats.errors.length > 0) {
    console.log('SAMPLE ERRORS:');
    for (const err of stats.errors.slice(0, 5)) {
      console.log(`  [${err.emailId.substring(0, 8)}...] ${err.error}`);
    }
    console.log('');
  }

  // Verify final state
  const { data: entityData } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const uniqueEmails = new Set(entityData?.map(e => e.email_id) || []).size;
  const totalEntities = entityData?.length || 0;

  console.log('FINAL STATE:');
  console.log(`  Total entity records:        ${totalEntities}`);
  console.log(`  Unique emails with entities: ${uniqueEmails}`);

  // Get linking stats
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('email_id');

  const linkedEmails = new Set(links?.map(l => l.email_id) || []).size;
  console.log(`  Emails linked to shipments:  ${linkedEmails}`);
  console.log('');
  console.log('═'.repeat(70));
}

main().catch(console.error);
