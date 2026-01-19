#!/usr/bin/env npx tsx
/**
 * Comprehensive Entity Re-extraction Script
 *
 * Purpose: Re-extract entities from booking confirmation emails with improved prompts
 * Targets: vessel_name, eta, etd, port_of_loading, port_of_discharge, consignee_name, shipper_name
 *
 * Current State:
 * - 293 booking confirmation emails (121 with body content)
 * - Only 8% have vessel_name extracted
 * - Only 12% have ETA extracted
 *
 * Target: 80%+ extraction for key fields
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
const BATCH_SIZE = 20;
const RATE_LIMIT_MS = 500;

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
  container_numbers?: string[];
  commodity?: string;
  confidence: number;
}

interface EmailData {
  id: string;
  subject: string;
  body_text: string;
}

// ============================================================================
// EXTRACTION PROMPT
// ============================================================================

function buildExtractionPrompt(email: EmailData): string {
  const bodyPreview = (email.body_text || '').substring(0, 6000);

  return `Extract shipping information from this booking confirmation email.

SUBJECT: ${email.subject || 'N/A'}

EMAIL CONTENT:
${bodyPreview}

---

EXTRACTION RULES:

1. VESSEL NAME: Look for patterns like:
   - "Vessel: [name]" or "V/N: [name]"
   - "MV [name]" or "Mother Vessel: [name]"
   - In table rows under "Vessel" column
   - EXCLUDE feeder vessel names if main vessel is available

2. VOYAGE NUMBER: Look for:
   - "Voyage: [number]" or "Voy: [number]"
   - Usually alphanumeric like "001E", "234W", "N123"

3. PORT OF LOADING (POL): Look for:
   - "Port of Loading:", "POL:", "Load Port:", "From:"
   - MUST be a sea port, NOT an ICD or inland location
   - Include country code if available (e.g., "NHAVA SHEVA, IN")

4. PORT OF DISCHARGE (POD): Look for:
   - "Port of Discharge:", "POD:", "Discharge Port:", "To:"
   - MUST be a sea port, NOT an ICD or inland location

5. ETD (Estimated Time of Departure): Look for:
   - "ETD:", "Departure:", "Sailing Date:"
   - MUST be for the OCEAN vessel leg, NOT truck/rail
   - Format as YYYY-MM-DD

6. ETA (Estimated Time of Arrival): Look for:
   - "ETA:", "Arrival:", "Expected Arrival:"
   - MUST be for the OCEAN vessel leg destination
   - Format as YYYY-MM-DD

7. CUTOFF DATES: Look for:
   - "SI Cutoff:", "Doc Cutoff:", "Documentation Cut-off:"
   - "VGM Cutoff:", "Verified Gross Mass Cut-off:"
   - "Cargo Cutoff:", "CY Cutoff:", "Container Yard Cut-off:"
   - "Gate Cutoff:", "Gate Close:"
   - Format as YYYY-MM-DD

8. SHIPPER: Look for:
   - "Shipper:", "Exporter:", "Consignor:"
   - Usually a company name with address

9. CONSIGNEE: Look for:
   - "Consignee:", "Importer:", "Notify Party:"
   - Usually a company name with address

10. CONTAINER NUMBERS: Look for:
    - Format like "MSKU1234567" or "HLXU 123456 7"
    - 4 letters + 7 digits

11. BOOKING NUMBER: Look for:
    - "Booking No:", "Booking Number:", "BKG:"
    - Various formats depending on carrier

12. BL NUMBER: Look for:
    - "BL No:", "Bill of Lading:", "B/L:"
    - May start with carrier code

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
  "container_numbers": ["array of strings"] or null,
  "commodity": "string or null",
  "confidence": 0-100
}`;
}

// ============================================================================
// EXTRACTION FUNCTION
// ============================================================================

async function extractEntities(email: EmailData): Promise<ExtractedEntities | null> {
  const prompt = buildExtractionPrompt(email);

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    // Extract JSON from response
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

async function saveEntityIfNew(
  emailId: string,
  entityType: string,
  entityValue: string | string[],
  confidence: number,
  sourceDocType: string
): Promise<boolean> {
  // Handle arrays (container_numbers)
  const value = Array.isArray(entityValue) ? entityValue.join(', ') : entityValue;
  if (!value || value.trim() === '') return false;

  // Check if entity already exists
  const { data: existing } = await supabase
    .from('entity_extractions')
    .select('id')
    .eq('email_id', emailId)
    .eq('entity_type', entityType)
    .single();

  if (existing) return false; // Already exists

  // Insert new entity
  const { error } = await supabase
    .from('entity_extractions')
    .insert({
      email_id: emailId,
      entity_type: entityType,
      entity_value: value,
      confidence_score: confidence,
      extraction_method: 'claude-haiku-comprehensive-v1',
      source_document_type: sourceDocType,
      is_verified: false
    });

  return !error;
}

async function updateShipmentFromEntities(
  shipmentId: string,
  entities: ExtractedEntities
): Promise<string[]> {
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  if (!shipment) return [];

  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  // Map entities to shipment fields (only update if empty)
  const fieldMappings: Array<[string, keyof ExtractedEntities, (v: unknown) => unknown]> = [
    ['vessel_name', 'vessel_name', v => v],
    ['voyage_number', 'voyage_number', v => v],
    ['port_of_loading', 'port_of_loading', v => v],
    ['port_of_discharge', 'port_of_discharge', v => v],
    ['etd', 'etd', v => v],
    ['eta', 'eta', v => v],
    ['si_cutoff', 'si_cutoff', v => v],
    ['vgm_cutoff', 'vgm_cutoff', v => v],
    ['cargo_cutoff', 'cargo_cutoff', v => v],
    ['gate_cutoff', 'gate_cutoff', v => v],
    ['shipper_name', 'shipper_name', v => v],
    ['consignee_name', 'consignee_name', v => v],
    ['container_numbers', 'container_numbers', v => v],
    ['commodity_description', 'commodity', v => v],
  ];

  for (const [shipmentField, entityField, transform] of fieldMappings) {
    if (!shipment[shipmentField] && entities[entityField]) {
      updates[shipmentField] = transform(entities[entityField]);
      changes.push(shipmentField);
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('shipments').update(updates).eq('id', shipmentId);
  }

  return changes;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function getEmailsNeedingExtraction(): Promise<EmailData[]> {
  // Get booking confirmation emails
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  if (!classifications) return [];

  const emailIds = classifications.map(c => c.email_id);

  // Get emails with their content (only those with body_text)
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', emailIds)
    .order('received_at', { ascending: false });

  // Filter for emails with actual content (>100 chars)
  const emailsWithContent = (emails || []).filter(
    e => e.body_text && e.body_text.length > 100
  );

  return emailsWithContent;
}

async function getShipmentForEmail(emailId: string): Promise<string | null> {
  // Check via booking number in entity extractions
  const { data: bookingEntity } = await supabase
    .from('entity_extractions')
    .select('entity_value')
    .eq('email_id', emailId)
    .eq('entity_type', 'booking_number')
    .single();

  if (!bookingEntity) return null;

  const { data: shipment } = await supabase
    .from('shipments')
    .select('id')
    .eq('booking_number', bookingEntity.entity_value)
    .single();

  return shipment?.id || null;
}

async function processEmail(email: EmailData): Promise<{
  newEntities: number;
  shipmentUpdates: string[];
}> {
  // Extract entities using AI
  const entities = await extractEntities(email);

  if (!entities) {
    return { newEntities: 0, shipmentUpdates: [] };
  }

  let newEntities = 0;
  const confidence = entities.confidence || 80;

  // Save each entity type
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
    if (value) {
      const saved = await saveEntityIfNew(
        email.id,
        entityType,
        value as string | string[],
        confidence,
        'booking_confirmation'
      );
      if (saved) newEntities++;
    }
  }

  // Update linked shipment
  let shipmentUpdates: string[] = [];
  const shipmentId = await getShipmentForEmail(email.id);
  if (shipmentId) {
    shipmentUpdates = await updateShipmentFromEntities(shipmentId, entities);
  }

  return { newEntities, shipmentUpdates };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE ENTITY RE-EXTRACTION FROM BOOKING EMAILS        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get initial stats
  const { count: initialEntityCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  console.log(`Initial entity count: ${initialEntityCount}`);

  // Get emails needing extraction
  const emails = await getEmailsNeedingExtraction();
  console.log(`Booking confirmation emails to process: ${emails.length}\n`);

  if (emails.length === 0) {
    console.log('No emails to process.');
    return;
  }

  let totalNewEntities = 0;
  let totalShipmentUpdates = 0;
  let processed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(emails.length/BATCH_SIZE)} ---`);

    for (const email of batch) {
      processed++;
      const progress = `[${processed}/${emails.length}]`;

      try {
        const result = await processEmail(email);

        if (result.newEntities > 0 || result.shipmentUpdates.length > 0) {
          console.log(`${progress} ✓ ${email.subject?.substring(0, 50)}...`);
          console.log(`         New entities: ${result.newEntities}, Shipment updates: ${result.shipmentUpdates.join(', ') || 'none'}`);
        } else {
          console.log(`${progress} - ${email.subject?.substring(0, 50)}... (no new data)`);
        }

        totalNewEntities += result.newEntities;
        totalShipmentUpdates += result.shipmentUpdates.length;
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
  console.log(`Shipment fields updated: ${totalShipmentUpdates}`);
  console.log(`Errors: ${errors}`);

  // Check new data completeness
  const { data: shipmentStats } = await supabase
    .from('shipments')
    .select('vessel_name, eta, consignee_name, etd, port_of_loading, port_of_discharge');

  if (shipmentStats) {
    const total = shipmentStats.length;
    console.log('\nShipment Field Completeness (After):');
    const fields = ['vessel_name', 'eta', 'consignee_name', 'etd', 'port_of_loading', 'port_of_discharge'];
    for (const field of fields) {
      const filled = shipmentStats.filter(s => s[field as keyof typeof s]).length;
      console.log(`  ${field}: ${filled}/${total} (${Math.round(filled/total*100)}%)`);
    }
  }

  const { count: finalEntityCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  console.log(`\nEntity count: ${initialEntityCount} → ${finalEntityCount} (+${(finalEntityCount || 0) - (initialEntityCount || 0)})`);
}

main().catch(console.error);
