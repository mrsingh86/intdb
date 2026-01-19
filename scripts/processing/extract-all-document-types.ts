#!/usr/bin/env npx tsx
/**
 * Comprehensive Entity Extraction for ALL Document Types
 *
 * Purpose: Extract entities from all extractable document types, not just booking_confirmation
 * Target: Increase coverage from 9% to 50%+ by processing:
 * - booking_confirmation
 * - shipping_instruction
 * - si_draft
 * - bill_of_lading
 * - arrival_notice
 * - vgm_confirmation
 * - packing_list
 * - commercial_invoice
 * - customs_clearance
 * - delivery_order
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
const BATCH_SIZE = 10;
const RATE_LIMIT_MS = 500;

// All extractable document types
const EXTRACTABLE_TYPES = [
  'booking_confirmation',
  'shipping_instruction',
  'si_draft',
  'bill_of_lading',
  'arrival_notice',
  'vgm_confirmation',
  'packing_list',
  'commercial_invoice',
  'customs_clearance',
  'delivery_order'
];

// ============================================================================
// TYPES
// ============================================================================

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
  notify_party?: string;
  container_numbers?: string[];
  commodity?: string;
  weight_kg?: string;
  invoice_number?: string;
  delivery_order_number?: string;
  customs_entry_number?: string;
  confidence: number;
}

interface EmailData {
  id: string;
  subject: string;
  body_text: string;
}

// ============================================================================
// DOCUMENT TYPE SPECIFIC PROMPTS
// ============================================================================

function getDocumentTypePrompt(documentType: string): string {
  const prompts: Record<string, string> = {
    booking_confirmation: `Extract shipping information from this BOOKING CONFIRMATION email.
Focus on: booking_number, vessel_name, voyage_number, port_of_loading, port_of_discharge, etd, eta,
si_cutoff, vgm_cutoff, cargo_cutoff, shipper_name, consignee_name, container_numbers`,

    shipping_instruction: `Extract shipping information from this SHIPPING INSTRUCTION email.
Focus on: booking_number, bl_number, shipper_name, consignee_name, notify_party, commodity,
container_numbers, port_of_loading, port_of_discharge, vessel_name`,

    bill_of_lading: `Extract shipping information from this BILL OF LADING email.
Focus on: bl_number, booking_number, vessel_name, voyage_number, port_of_loading, port_of_discharge,
etd, eta, shipper_name, consignee_name, notify_party, container_numbers, commodity, weight_kg`,

    arrival_notice: `Extract shipping information from this ARRIVAL NOTICE email.
Focus on: bl_number, vessel_name, eta, port_of_discharge, consignee_name, notify_party,
container_numbers, delivery_order_number`,

    commercial_invoice: `Extract shipping information from this COMMERCIAL INVOICE email.
Focus on: invoice_number, bl_number, shipper_name, consignee_name, commodity, weight_kg,
container_numbers`,

    packing_list: `Extract shipping information from this PACKING LIST email.
Focus on: invoice_number, bl_number, shipper_name, consignee_name, commodity, weight_kg,
container_numbers`,

    vgm_confirmation: `Extract shipping information from this VGM CONFIRMATION email.
Focus on: booking_number, container_numbers, weight_kg, vgm_cutoff, port_of_loading`,

    si_draft: `Extract shipping information from this SHIPPING INSTRUCTION DRAFT email.
Focus on: booking_number, shipper_name, consignee_name, notify_party, commodity,
port_of_loading, port_of_discharge`,

    customs_clearance: `Extract shipping information from this CUSTOMS CLEARANCE email.
Focus on: customs_entry_number, bl_number, consignee_name, commodity, port_of_discharge,
container_numbers`,

    delivery_order: `Extract shipping information from this DELIVERY ORDER email.
Focus on: delivery_order_number, bl_number, consignee_name, container_numbers,
port_of_discharge, vessel_name`
  };

  return prompts[documentType] || prompts.booking_confirmation;
}

function buildExtractionPrompt(email: EmailData, documentType: string): string {
  const bodyPreview = (email.body_text || '').substring(0, 6000);
  const typeSpecificPrompt = getDocumentTypePrompt(documentType);

  return `${typeSpecificPrompt}

SUBJECT: ${email.subject || 'N/A'}

EMAIL CONTENT:
${bodyPreview}

---

EXTRACTION RULES:

1. VESSEL NAME: Look for patterns like "Vessel:", "V/N:", "MV", "Mother Vessel:"
   - EXCLUDE feeder vessel names if main vessel is available

2. VOYAGE NUMBER: Look for "Voyage:", "Voy:" - usually alphanumeric like "001E", "234W"

3. PORT OF LOADING (POL): Look for "Port of Loading:", "POL:", "Load Port:", "From:"
   - MUST be a sea port, NOT an ICD or inland location

4. PORT OF DISCHARGE (POD): Look for "Port of Discharge:", "POD:", "Discharge Port:", "To:"
   - MUST be a sea port, NOT an ICD or inland location

5. DATES: Format as YYYY-MM-DD
   - ETD: Estimated Time of Departure (for OCEAN vessel)
   - ETA: Estimated Time of Arrival (for OCEAN vessel)
   - SI Cutoff: Documentation cutoff
   - VGM Cutoff: Verified Gross Mass cutoff
   - Cargo Cutoff: Container yard cutoff
   - Gate Cutoff: Gate close time

6. PARTIES:
   - Shipper: "Shipper:", "Exporter:", "Consignor:"
   - Consignee: "Consignee:", "Importer:"
   - Notify Party: "Notify Party:", "Notify:"

7. CONTAINER NUMBERS: Format like "MSKU1234567" (4 letters + 7 digits)

8. BOOKING NUMBER: "Booking No:", "Booking Number:", "BKG:"

9. BL NUMBER: "BL No:", "Bill of Lading:", "B/L:"

10. INVOICE NUMBER: "Invoice No:", "Invoice Number:"

11. DELIVERY ORDER: "D/O No:", "Delivery Order:"

12. CUSTOMS ENTRY: "Entry No:", "Customs Entry:"

Return ONLY valid JSON (no markdown, no explanation):
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
  "shipper_name": "string or null",
  "consignee_name": "string or null",
  "notify_party": "string or null",
  "container_numbers": ["array of strings"] or null,
  "commodity": "string or null",
  "weight_kg": "string or null",
  "invoice_number": "string or null",
  "delivery_order_number": "string or null",
  "customs_entry_number": "string or null",
  "confidence": 0-100
}`;
}

// ============================================================================
// EXTRACTION FUNCTION
// ============================================================================

async function extractEntities(email: EmailData, documentType: string): Promise<ExtractedEntities | null> {
  const prompt = buildExtractionPrompt(email, documentType);

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

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedEntities;
    return parsed;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`  Extraction error: ${message}`);
    return null;
  }
}

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

async function saveEntity(
  emailId: string,
  entityType: string,
  entityValue: string | string[],
  confidence: number,
  sourceDocType: string
): Promise<boolean> {
  const value = Array.isArray(entityValue) ? entityValue.join(', ') : entityValue;
  if (!value || value.trim() === '') return false;

  // Check if entity already exists
  const { data: existing } = await supabase
    .from('entity_extractions')
    .select('id')
    .eq('email_id', emailId)
    .eq('entity_type', entityType)
    .single();

  if (existing) return false;

  // Insert new entity
  const { error } = await supabase
    .from('entity_extractions')
    .insert({
      email_id: emailId,
      entity_type: entityType,
      entity_value: value,
      confidence_score: confidence,
      extraction_method: 'claude-haiku-all-doc-types-v1',
      source_document_type: sourceDocType,
      is_verified: false
    });

  return !error;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function getEmailsNeedingExtraction(): Promise<Array<{email: EmailData; docType: string}>> {
  // Get all extractable document types
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('document_type', EXTRACTABLE_TYPES);

  if (!classifications) return [];

  // Get existing extractions
  const { data: existingExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const alreadyExtracted = new Set(existingExtractions?.map(e => e.email_id) || []);

  // Filter to only emails without extractions
  const needingExtraction = classifications.filter(c => !alreadyExtracted.has(c.email_id));

  console.log(`Found ${needingExtraction.length} emails needing extraction`);
  console.log(`Already extracted: ${alreadyExtracted.size} emails`);

  // Get email content in batches
  const results: Array<{email: EmailData; docType: string}> = [];

  for (let i = 0; i < needingExtraction.length; i += 100) {
    const batch = needingExtraction.slice(i, i + 100);
    const emailIds = batch.map(c => c.email_id);

    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text')
      .in('id', emailIds);

    if (emails) {
      emails.forEach(email => {
        const classification = batch.find(c => c.email_id === email.id);
        if (classification && email.body_text && email.body_text.length > 100) {
          results.push({
            email: email as EmailData,
            docType: classification.document_type
          });
        }
      });
    }
  }

  console.log(`Filtered to ${results.length} emails with content (>100 chars)`);
  return results;
}

async function processEmail(email: EmailData, documentType: string): Promise<number> {
  const entities = await extractEntities(email, documentType);

  if (!entities) {
    return 0;
  }

  let newEntities = 0;
  const confidence = entities.confidence || 70;

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
    ['notify_party', 'notify_party'],
    ['container_numbers', 'container_numbers'],
    ['commodity', 'commodity'],
    ['weight_kg', 'weight_kg'],
    ['invoice_number', 'invoice_number'],
    ['delivery_order_number', 'delivery_order_number'],
    ['customs_entry_number', 'customs_entry_number']
  ];

  for (const [entityType, entityKey] of entityTypes) {
    const value = entities[entityKey];
    if (value) {
      const saved = await saveEntity(
        email.id,
        entityType,
        value as string | string[],
        confidence,
        documentType
      );
      if (saved) newEntities++;
    }
  }

  return newEntities;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE ENTITY EXTRACTION - ALL DOCUMENT TYPES          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get initial stats
  const { count: initialEntityCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  const { count: totalClassified } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  console.log(`Initial state:`);
  console.log(`  Total classified emails: ${totalClassified}`);
  console.log(`  Emails with extractions: ${initialEntityCount ? Math.floor(initialEntityCount / 10) : 0} (approx)`);
  console.log(`  Extractable types: ${EXTRACTABLE_TYPES.join(', ')}\n`);

  // Get emails needing extraction
  const emailsToProcess = await getEmailsNeedingExtraction();
  console.log(`\nEmails to process: ${emailsToProcess.length}\n`);

  if (emailsToProcess.length === 0) {
    console.log('No emails to process. All extractable emails already have entities extracted.');
    return;
  }

  // Group by document type for stats
  const byType: Record<string, number> = {};
  emailsToProcess.forEach(({ docType }) => {
    byType[docType] = (byType[docType] || 0) + 1;
  });

  console.log('Emails by document type:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type.padEnd(30)} ${count}`);
  });
  console.log('');

  let totalNewEntities = 0;
  let processed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < emailsToProcess.length; i += BATCH_SIZE) {
    const batch = emailsToProcess.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(emailsToProcess.length/BATCH_SIZE)} ---`);

    for (const { email, docType } of batch) {
      processed++;
      const progress = `[${processed}/${emailsToProcess.length}]`;

      try {
        const newEntities = await processEmail(email, docType);

        if (newEntities > 0) {
          console.log(`${progress} ✓ [${docType.substring(0, 15).padEnd(15)}] ${newEntities} entities - ${email.subject?.substring(0, 40)}...`);
        } else {
          console.log(`${progress} - [${docType.substring(0, 15).padEnd(15)}] no data - ${email.subject?.substring(0, 40)}...`);
        }

        totalNewEntities += newEntities;
      } catch (error) {
        errors++;
        console.log(`${progress} ✗ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // Final stats
  console.log('\n' + '═'.repeat(70));
  console.log('EXTRACTION COMPLETE');
  console.log('═'.repeat(70));
  console.log(`Emails processed: ${processed}`);
  console.log(`New entities created: ${totalNewEntities}`);
  console.log(`Errors: ${errors}`);

  // Get final coverage
  const { data: finalExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const uniqueEmailsWithExtractions = new Set(finalExtractions?.map(e => e.email_id)).size;
  const coveragePct = totalClassified ? ((uniqueEmailsWithExtractions / totalClassified) * 100).toFixed(1) : '0';

  console.log(`\nFinal coverage: ${uniqueEmailsWithExtractions}/${totalClassified} emails (${coveragePct}%)`);

  // Cost estimate
  const estimatedCost = processed * 0.0015;
  console.log(`\nEstimated API cost: $${estimatedCost.toFixed(4)}`);
}

main().catch(console.error);
