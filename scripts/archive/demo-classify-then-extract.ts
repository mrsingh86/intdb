/**
 * Demo: Classification + Extraction Pipeline
 *
 * Two-step approach:
 * 1. Classify document type (Haiku - fast & cheap)
 * 2. Extract with document-specific schema (Haiku or Sonnet based on complexity)
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// TEST DATA - Multiple Document Types
// =============================================================================

const TEST_DOCUMENTS = [
  {
    name: 'COSCO Booking Confirmation',
    subject: 'Cosco Shipping Line Booking Confirmation - COSU6441804980',
    content: `BOOKING NUMBER: COSU6441804980
RATE AGREEMENT REFERENCE: SEN25678 - (SERVICE CONTRACT)
Booking Confirmation
BOOKING PARTY: INTOGLO PRIVATE LIMITED
SHIPPER: INTOGLO PRIVATE LIMITED
1 X 40' Hi-Cube Container
PLACE OF RECEIPT: Nhava Sheva, Maharashtra, India
PORT OF LOADING: Nhava Sheva / Nhava Sheva JNPT
INTENDED VESSEL/VOYAGE: CMA CGM VERDI 0INLRW1MA
ETD: 18 Jan 2026
PORT OF DISCHARGE: New York / Port Liberty New York
ETA: 18 Feb 2026
INTENDED SI CUT-OFF: 15 Jan 2026 05:00
INTENDED FCL CY CUT-OFF: 16 Jan 2026 12:00
CARGO DESCRIPTION: PAPER BAGS
CARGO WEIGHT: 16000 KG`,
  },
  {
    name: 'Maersk Booking Amendment',
    subject: 'Booking Amendment : 263814897',
    content: `BOOKING AMENDMENT
2026-01-09 11:25 UTC
Booking No.: 263814897
Booked by Party: INTOGLO PRIVATE LIMITED.
Service Mode: CY/CY
From: Gurgaon, HARYANA, India
To: Toronto, Ontario, Canada
Service Contract: 299973976
Commodity Description: Autoparts, car parts, vehicle parts
Equipment: 1 x 20 DRY, Gross Weight: 20000.000 KGS
Intended Transport Plan:
PIPAVAV TERMINAL → Newark - Maher Terminal
Vessel: CORNELIA MAERSK, Voy No: 603W
ETD: 2026-01-21, ETA: 2026-02-24`,
  },
  {
    name: 'Hapag-Lloyd SI Confirmation',
    subject: 'RE: SI Submitted - BKG 37860708',
    content: `Dear Customer,

We confirm receipt of your Shipping Instructions for the following booking:

Booking Number: 37860708
BL Number: HLCUBO1260164692
Shipper: SAFEWATER LINES INDIA PRIVATE LIMITED
Consignee: ABC IMPORTS LLC, NEW YORK
Notify Party: SAME AS CONSIGNEE

Container: HLCU1234567 (20GP)
Commodity: GLYCINE
Gross Weight: 21000 KGS

Port of Loading: HAZIRA (INHZA)
Port of Discharge: HOUSTON, TX (USHOU)

SI Cut-off was: 13-Jan-2026
VGM Cut-off: 14-Jan-2026

Please review the draft BL which will be sent separately.

Best regards,
Hapag-Lloyd Documentation Team`,
  },
  {
    name: 'Arrival Notice',
    subject: 'ARRIVAL NOTICE - BL COSU6441804980 - VESSEL CMA CGM VERDI',
    content: `ARRIVAL NOTICE

Dear Valued Customer,

We are pleased to inform you that the following shipment has arrived:

B/L Number: COSU6441804980
Vessel: CMA CGM VERDI
Voyage: 0INLRW1MA
Port of Discharge: NEW YORK, NY

Arrival Date: 18-FEB-2026
Container: CSQU1234567 (40HC)

Free Time Expires: 23-FEB-2026
Demurrage will apply after free time.

Consignee: INTOGLO TECHNOLOGIES INC
4047 LONG AVENUE, TRACY, CA 95377

Please arrange customs clearance and pickup.

Sincerely,
COSCO Shipping Lines`,
  },
];

// =============================================================================
// CLASSIFICATION SCHEMA (Step 1)
// =============================================================================

const ClassificationSchema = z.object({
  document_type: z.enum([
    'booking_confirmation',
    'booking_amendment',
    'shipping_instructions',
    'si_confirmation',
    'draft_bl',
    'final_bl',
    'arrival_notice',
    'delivery_order',
    'invoice',
    'vgm_confirmation',
    'unknown',
  ]),
  document_category: z.enum([
    'booking',      // booking_confirmation, booking_amendment
    'documentation', // SI, BL, packing list
    'transport',     // arrival notice, delivery order
    'financial',     // invoice, debit note
    'compliance',    // VGM, customs
    'unknown',
  ]),
  carrier_detected: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
});

// =============================================================================
// DOCUMENT-SPECIFIC EXTRACTION SCHEMAS (Step 2)
// =============================================================================

const BookingExtractionSchema = z.object({
  booking_number: z.string().nullish(),
  carrier_name: z.string().nullish(),
  vessel_name: z.string().nullish(),
  voyage_number: z.string().nullish(),
  port_of_loading: z.string().nullish(),
  port_of_discharge: z.string().nullish(),
  place_of_receipt: z.string().nullish(),
  place_of_delivery: z.string().nullish(),
  etd: z.string().nullish(),
  eta: z.string().nullish(),
  si_cutoff: z.string().nullish(),
  vgm_cutoff: z.string().nullish(),
  cargo_cutoff: z.string().nullish(),
  shipper_name: z.string().nullish(),
  commodity: z.string().nullish(),
  gross_weight_kg: z.union([z.number(), z.string()]).nullish(),
  container_count: z.number().nullish(),
  container_type: z.string().nullish(),
  service_contract: z.string().nullish(),
  is_amendment: z.boolean().optional(),
});

const SIExtractionSchema = z.object({
  booking_number: z.string().nullish(),
  bl_number: z.string().nullish(),
  carrier_name: z.string().nullish(),
  shipper_name: z.string().nullish(),
  shipper_address: z.string().nullish(),
  consignee_name: z.string().nullish(),
  consignee_address: z.string().nullish(),
  notify_party: z.string().nullish(),
  container_numbers: z.array(z.string()).optional().default([]),
  commodity: z.string().nullish(),
  gross_weight_kg: z.union([z.number(), z.string()]).nullish(),
  port_of_loading: z.string().nullish(),
  port_of_discharge: z.string().nullish(),
  si_cutoff: z.string().nullish(),
  vgm_cutoff: z.string().nullish(),
});

const ArrivalNoticeSchema = z.object({
  bl_number: z.string().nullish(),
  booking_number: z.string().nullish(),
  carrier_name: z.string().nullish(),
  vessel_name: z.string().nullish(),
  voyage_number: z.string().nullish(),
  port_of_discharge: z.string().nullish(),
  arrival_date: z.string().nullish(),
  container_numbers: z.array(z.string()).optional().default([]),
  consignee_name: z.string().nullish(),
  consignee_address: z.string().nullish(),
  free_time_expiry: z.string().nullish(),
  demurrage_start: z.string().nullish(),
});

// =============================================================================
// HELPER
// =============================================================================

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as any)._def;
  if (def.typeName === 'ZodObject') {
    const shape = (schema as z.ZodObject<any>).shape;
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodType);
    }
    return { type: 'object', properties };
  }
  if (def.typeName === 'ZodString') return { type: ['string', 'null'] };
  if (def.typeName === 'ZodNumber') return { type: ['number', 'null'] };
  if (def.typeName === 'ZodBoolean') return { type: 'boolean' };
  if (def.typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) };
  if (def.typeName === 'ZodEnum') return { type: 'string', enum: def.values };
  if (def.typeName === 'ZodNullable' || def.typeName === 'ZodOptional') return zodToJsonSchema(def.innerType);
  if (def.typeName === 'ZodDefault') return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };
  if (def.typeName === 'ZodUnion') return { type: ['number', 'string', 'null'] };
  return { type: ['string', 'null'] };
}

// =============================================================================
// STEP 1: CLASSIFICATION (Haiku - Fast & Cheap)
// =============================================================================

async function classifyDocument(subject: string, content: string): Promise<{
  classification: z.infer<typeof ClassificationSchema> | null;
  tokens: number;
  timeMs: number;
  error?: string;
}> {
  const tool: Anthropic.Tool = {
    name: 'classify_document',
    description: 'Classify shipping document type',
    input_schema: zodToJsonSchema(ClassificationSchema) as Anthropic.Tool.InputSchema,
  };

  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',  // Fast & cheap for classification
      max_tokens: 1024,
      system: `You are a shipping document classifier. Analyze the document and determine:
1. document_type: The specific type of document
2. document_category: The broad category
3. carrier_detected: Shipping line name if identifiable
4. confidence: 0-100 score
5. reasoning: Brief explanation

Document types:
- booking_confirmation: New booking confirmed by carrier
- booking_amendment: Changes to existing booking
- shipping_instructions: SI submission
- si_confirmation: Carrier confirms SI received
- draft_bl: Draft Bill of Lading for review
- final_bl: Final/released Bill of Lading
- arrival_notice: Vessel/cargo arrival notification
- delivery_order: Release for cargo pickup
- invoice: Freight/charges invoice
- vgm_confirmation: VGM submission confirmed`,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'classify_document' },
      messages: [{ role: 'user', content: `Subject: ${subject}\n\nContent:\n${content.slice(0, 2000)}` }],
    });

    const elapsed = Date.now() - startTime;
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    const tokens = response.usage.input_tokens + response.usage.output_tokens;

    if (!toolUse || toolUse.type !== 'tool_use') {
      return { classification: null, tokens, timeMs: elapsed, error: 'No response' };
    }

    const result = ClassificationSchema.safeParse(toolUse.input);
    if (!result.success) {
      return { classification: null, tokens, timeMs: elapsed, error: result.error.message };
    }

    return { classification: result.data, tokens, timeMs: elapsed };
  } catch (error) {
    return { classification: null, tokens: 0, timeMs: Date.now() - startTime, error: (error as Error).message };
  }
}

// =============================================================================
// STEP 2: EXTRACTION (Schema based on document type)
// =============================================================================

async function extractDocument(
  documentType: string,
  subject: string,
  content: string,
  carrier: string | null
): Promise<{
  data: Record<string, unknown> | null;
  tokens: number;
  timeMs: number;
  error?: string;
}> {
  // Select schema based on document type
  let schema: z.ZodType;
  let schemaName: string;

  if (documentType.includes('booking') || documentType === 'booking_confirmation' || documentType === 'booking_amendment') {
    schema = BookingExtractionSchema;
    schemaName = 'Booking';
  } else if (documentType.includes('si') || documentType === 'shipping_instructions' || documentType === 'si_confirmation') {
    schema = SIExtractionSchema;
    schemaName = 'SI/Documentation';
  } else if (documentType === 'arrival_notice' || documentType === 'delivery_order') {
    schema = ArrivalNoticeSchema;
    schemaName = 'Arrival/Delivery';
  } else {
    schema = BookingExtractionSchema;  // Default
    schemaName = 'General';
  }

  const tool: Anthropic.Tool = {
    name: 'extract_shipping_data',
    description: `Extract ${schemaName} data from shipping document`,
    input_schema: zodToJsonSchema(schema) as Anthropic.Tool.InputSchema,
  };

  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',  // Use Haiku for extraction too
      max_tokens: 2048,
      system: `You are extracting ${schemaName} data from a ${documentType} document.
${carrier ? `Carrier: ${carrier}` : ''}

Rules:
1. Extract only explicitly stated information
2. Convert dates to YYYY-MM-DD format
3. Use null for missing fields
4. Container numbers: 4 letters + 7 digits (e.g., COSU1234567)`,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'extract_shipping_data' },
      messages: [{ role: 'user', content: `Subject: ${subject}\n\nContent:\n${content}` }],
    });

    const elapsed = Date.now() - startTime;
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    const tokens = response.usage.input_tokens + response.usage.output_tokens;

    if (!toolUse || toolUse.type !== 'tool_use') {
      return { data: null, tokens, timeMs: elapsed, error: 'No response' };
    }

    const result = schema.safeParse(toolUse.input);
    if (!result.success) {
      return { data: null, tokens, timeMs: elapsed, error: result.error.message };
    }

    return { data: result.data as Record<string, unknown>, tokens, timeMs: elapsed };
  } catch (error) {
    return { data: null, tokens: 0, timeMs: Date.now() - startTime, error: (error as Error).message };
  }
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

async function processDocument(doc: typeof TEST_DOCUMENTS[0]) {
  console.log(`\n${'═'.repeat(78)}`);
  console.log(`  📄 ${doc.name}`);
  console.log(`${'═'.repeat(78)}`);
  console.log(`  Subject: ${doc.subject}`);

  // STEP 1: Classification
  console.log('\n  ┌─ STEP 1: CLASSIFICATION (Haiku) ─────────────────────────────────────────┐');
  const classResult = await classifyDocument(doc.subject, doc.content);

  if (!classResult.classification) {
    console.log(`  │  ❌ Failed: ${classResult.error}`);
    return null;
  }

  const cls = classResult.classification;
  console.log(`  │  Document Type:  ${cls.document_type}`);
  console.log(`  │  Category:       ${cls.document_category}`);
  console.log(`  │  Carrier:        ${cls.carrier_detected || 'Unknown'}`);
  console.log(`  │  Confidence:     ${cls.confidence}%`);
  console.log(`  │  Reasoning:      ${cls.reasoning.slice(0, 60)}...`);
  console.log(`  │  ⏱️  ${classResult.timeMs}ms | ${classResult.tokens} tokens | ~$${(classResult.tokens * 0.00025 / 1000).toFixed(5)}`);
  console.log('  └──────────────────────────────────────────────────────────────────────────┘');

  // STEP 2: Extraction
  console.log('\n  ┌─ STEP 2: EXTRACTION (Haiku) ─────────────────────────────────────────────┐');
  const extractResult = await extractDocument(
    cls.document_type,
    doc.subject,
    doc.content,
    cls.carrier_detected
  );

  if (!extractResult.data) {
    console.log(`  │  ❌ Failed: ${extractResult.error}`);
    return null;
  }

  // Display extracted fields
  const data = extractResult.data;
  const displayFields = Object.entries(data)
    .filter(([_, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .slice(0, 12);

  for (const [key, value] of displayFields) {
    const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
    console.log(`  │  ${key.padEnd(18)} ${displayValue.slice(0, 45)}`);
  }

  console.log(`  │  ⏱️  ${extractResult.timeMs}ms | ${extractResult.tokens} tokens | ~$${(extractResult.tokens * 0.00025 / 1000).toFixed(5)}`);
  console.log('  └──────────────────────────────────────────────────────────────────────────┘');

  // Summary
  const totalTokens = classResult.tokens + extractResult.tokens;
  const totalTime = classResult.timeMs + extractResult.timeMs;
  const totalCost = totalTokens * 0.00025 / 1000;

  console.log(`\n  📊 TOTAL: ${totalTime}ms | ${totalTokens} tokens | ~$${totalCost.toFixed(5)}`);

  return {
    document: doc.name,
    classification: cls,
    extraction: data,
    stats: {
      classifyTokens: classResult.tokens,
      extractTokens: extractResult.tokens,
      totalTokens,
      totalTime,
      totalCost,
    },
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         CLASSIFICATION + EXTRACTION PIPELINE DEMO                            ║');
  console.log('║         Step 1: Classify (Haiku) → Step 2: Extract (Haiku)                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  const results = [];

  for (const doc of TEST_DOCUMENTS) {
    const result = await processDocument(doc);
    if (result) results.push(result);
    await new Promise((r) => setTimeout(r, 300));  // Rate limiting
  }

  // Final Summary
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  console.log('\n  ┌────────────────────────────┬──────────────────┬─────────┬─────────┬──────────┐');
  console.log('  │ Document                   │ Type             │ Conf.   │ Tokens  │ Cost     │');
  console.log('  ├────────────────────────────┼──────────────────┼─────────┼─────────┼──────────┤');

  let totalTokens = 0;
  let totalCost = 0;

  for (const r of results) {
    const name = r.document.slice(0, 26).padEnd(26);
    const type = r.classification.document_type.slice(0, 16).padEnd(16);
    const conf = `${r.classification.confidence}%`.padEnd(7);
    const tokens = String(r.stats.totalTokens).padEnd(7);
    const cost = `$${r.stats.totalCost.toFixed(5)}`;
    console.log(`  │ ${name} │ ${type} │ ${conf} │ ${tokens} │ ${cost} │`);
    totalTokens += r.stats.totalTokens;
    totalCost += r.stats.totalCost;
  }

  console.log('  ├────────────────────────────┼──────────────────┼─────────┼─────────┼──────────┤');
  console.log(`  │ TOTAL (${results.length} documents)         │                  │         │ ${String(totalTokens).padEnd(7)} │ $${totalCost.toFixed(5)} │`);
  console.log('  └────────────────────────────┴──────────────────┴─────────┴─────────┴──────────┘');

  console.log(`\n  📈 Average per document: ${Math.round(totalTokens / results.length)} tokens, $${(totalCost / results.length).toFixed(5)}`);
  console.log(`  💰 Projected cost at 1,000 docs/month: $${(totalCost / results.length * 1000).toFixed(2)}`);

  console.log('\n\n✅ Pipeline demo complete!\n');
}

main().catch(console.error);
