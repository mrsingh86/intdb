/**
 * Test Script: Structured Extraction POC
 *
 * Tests the new structured extraction approach using Anthropic's tool_use
 * for guaranteed structured output. Compares with regex extraction.
 *
 * Usage:
 *   npx tsx scripts/test-structured-extraction-poc.ts
 *   npx tsx scripts/test-structured-extraction-poc.ts --carrier maersk
 *   npx tsx scripts/test-structured-extraction-poc.ts --limit 10
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// =============================================================================
// SETUP
// =============================================================================

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// ZOD SCHEMAS (Inline for POC)
// =============================================================================

const UniversalShippingExtractionSchema = z.object({
  document_type: z
    .enum([
      'booking_confirmation',
      'booking_amendment',
      'bill_of_lading',
      'draft_bl',
      'arrival_notice',
      'shipping_instructions',
      'invoice',
      'vgm_confirmation',
      'customs_entry',
      'packing_list',
      'unknown',
    ])
    .describe('Detected document type'),

  booking_number: z.string().nullish().describe('Carrier booking reference'),
  bl_number: z.string().nullish().describe('Bill of Lading number'),
  container_numbers: z.array(z.string()).optional().default([]).describe('Container numbers'),

  carrier_name: z.string().nullish().describe('Carrier/shipping line name'),
  carrier_code: z.string().nullish().describe('Carrier SCAC code'),

  vessel_name: z.string().nullish().describe('Vessel name'),
  voyage_number: z.string().nullish().describe('Voyage number'),

  port_of_loading: z.string().nullish().describe('Port of loading name'),
  port_of_loading_code: z.string().nullish().describe('POL UN/LOCODE'),
  port_of_discharge: z.string().nullish().describe('Port of discharge name'),
  port_of_discharge_code: z.string().nullish().describe('POD UN/LOCODE'),
  place_of_receipt: z.string().nullish(),
  place_of_delivery: z.string().nullish(),

  etd: z.string().nullish().describe('ETD in YYYY-MM-DD format'),
  eta: z.string().nullish().describe('ETA in YYYY-MM-DD format'),
  si_cutoff: z.string().nullish().describe('SI cutoff date'),
  vgm_cutoff: z.string().nullish().describe('VGM cutoff date'),
  cargo_cutoff: z.string().nullish().describe('Cargo cutoff date'),

  shipper_name: z.string().nullish(),
  consignee_name: z.string().nullish(),
  notify_party_name: z.string().nullish(),

  commodity: z.string().nullish(),
  gross_weight_kg: z.union([z.number(), z.string()]).nullish(),
  volume_cbm: z.union([z.number(), z.string()]).nullish(),

  confidence: z.number().min(0).max(100).optional().default(50).describe('Extraction confidence 0-100'),
  extraction_notes: z.string().nullish().describe('Notes about extraction quality'),
});

type UniversalShippingExtraction = z.infer<typeof UniversalShippingExtractionSchema>;

const DocumentClassificationSchema = z.object({
  document_type: z.enum([
    'booking_confirmation',
    'booking_amendment',
    'booking_cancellation',
    'bill_of_lading',
    'draft_bl',
    'arrival_notice',
    'shipping_instructions',
    'si_confirmation',
    'vgm_confirmation',
    'vgm_reminder',
    'cutoff_advisory',
    'invoice',
    'packing_list',
    'unknown',
  ]).describe('Primary document type'),

  document_category: z.enum([
    'booking',
    'documentation',
    'transport',
    'customs',
    'financial',
    'notification',
    'unknown',
  ]).describe('Document category'),

  confidence: z.number().min(0).max(100),
  carrier_detected: z.string().nullable(),
  is_amendment: z.boolean(),
  classification_reasoning: z.string(),
});

// =============================================================================
// SIMPLE ZOD TO JSON SCHEMA CONVERTER
// =============================================================================

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // For this POC, we'll create a simplified JSON schema
  // In production, use zod-to-json-schema library

  const def = (schema as any)._def;

  if (def.typeName === 'ZodObject') {
    const shape = (schema as z.ZodObject<any>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodType);
      // Check if required - only document_type is truly required
      if (key === 'document_type') {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (def.typeName === 'ZodString') {
    return { type: ['string', 'null'], description: def.description };
  }

  if (def.typeName === 'ZodNumber') {
    return { type: ['number', 'null'], description: def.description };
  }

  if (def.typeName === 'ZodBoolean') {
    return { type: 'boolean', description: def.description };
  }

  if (def.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodToJsonSchema(def.type),
      description: def.description,
    };
  }

  if (def.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def.values,
      description: def.description,
    };
  }

  if (def.typeName === 'ZodNullable' || def.typeName === 'ZodOptional') {
    const inner = zodToJsonSchema(def.innerType);
    return { ...inner };
  }

  if (def.typeName === 'ZodDefault') {
    const inner = zodToJsonSchema(def.innerType);
    return { ...inner, default: def.defaultValue() };
  }

  if (def.typeName === 'ZodUnion') {
    // Handle union types like z.union([z.number(), z.string()])
    return { type: ['number', 'string', 'null'] };
  }

  return { type: ['string', 'null'] };
}

// =============================================================================
// EXTRACTION PROMPTS
// =============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are an expert shipping document analyzer specializing in freight forwarding documents.

Extract structured data from shipping documents with high accuracy.

RULES:
1. Only extract information EXPLICITLY stated in the document
2. Use null for any field where information is not found
3. Convert dates to ISO format (YYYY-MM-DD)
4. Container numbers: 4 letters + 7 digits (e.g., MAEU1234567)
5. Port codes: UN/LOCODE format (e.g., INMUN, USLAX)
6. Be conservative - prefer null over guessing

CARRIER PATTERNS:
- Maersk: Bookings start with 26XXXXXXX, containers MAEU/MSKU
- Hapag-Lloyd: Bookings HL-XXXXXXXX, containers HLCU
- CMA CGM: Bookings AMC/CMI prefix, containers CMAU
- COSCO: Containers CSQU/CCLU`;

const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert at classifying shipping documents.

Analyze document content and determine:
1. Document type (booking_confirmation, bill_of_lading, arrival_notice, etc.)
2. Document category
3. Carrier if detectable
4. Whether it's an amendment/update

Provide clear reasoning for your classification.`;

// =============================================================================
// STRUCTURED EXTRACTION FUNCTION
// =============================================================================

async function extractStructured(
  text: string,
  carrier?: string | null,
  subject?: string
): Promise<{
  success: boolean;
  data: UniversalShippingExtraction | null;
  confidence: number;
  tokensUsed: number;
  error?: string;
}> {
  const tool: Anthropic.Tool = {
    name: 'extract_shipping_data',
    description: 'Extract structured shipping data from the document',
    input_schema: zodToJsonSchema(UniversalShippingExtractionSchema) as Anthropic.Tool.InputSchema,
  };

  let contextText = '';
  if (subject) contextText += `Email Subject: ${subject}\n\n`;
  if (carrier) contextText += `Carrier: ${carrier}\n\n`;
  contextText += `Document Content:\n\n${text}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'extract_shipping_data' },
      messages: [{ role: 'user', content: contextText }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');

    if (!toolUse || toolUse.type !== 'tool_use') {
      return {
        success: false,
        data: null,
        confidence: 0,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        error: 'No tool_use response',
      };
    }

    const validationResult = UniversalShippingExtractionSchema.safeParse(toolUse.input);

    if (!validationResult.success) {
      return {
        success: false,
        data: null,
        confidence: 0,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        error: `Validation failed: ${validationResult.error.message}`,
      };
    }

    return {
      success: true,
      data: validationResult.data,
      confidence: validationResult.data.confidence,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      confidence: 0,
      tokensUsed: 0,
      error: (error as Error).message,
    };
  }
}

async function classifyDocument(
  text: string,
  carrier?: string | null,
  subject?: string
): Promise<{
  success: boolean;
  data: z.infer<typeof DocumentClassificationSchema> | null;
  tokensUsed: number;
  error?: string;
}> {
  const tool: Anthropic.Tool = {
    name: 'classify_document',
    description: 'Classify the shipping document type',
    input_schema: zodToJsonSchema(DocumentClassificationSchema) as Anthropic.Tool.InputSchema,
  };

  let contextText = '';
  if (subject) contextText += `Email Subject: ${subject}\n\n`;
  if (carrier) contextText += `Carrier: ${carrier}\n\n`;
  contextText += `Document Content:\n\n${text.slice(0, 3000)}`; // Limit for classification

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'classify_document' },
      messages: [{ role: 'user', content: contextText }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');

    if (!toolUse || toolUse.type !== 'tool_use') {
      return {
        success: false,
        data: null,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        error: 'No tool_use response',
      };
    }

    const validationResult = DocumentClassificationSchema.safeParse(toolUse.input);

    if (!validationResult.success) {
      return {
        success: false,
        data: null,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        error: `Validation failed: ${validationResult.error.message}`,
      };
    }

    return {
      success: true,
      data: validationResult.data,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      tokensUsed: 0,
      error: (error as Error).message,
    };
  }
}

// =============================================================================
// SIMPLE REGEX EXTRACTION (for comparison)
// =============================================================================

function extractWithRegex(subject: string, bodyText: string): Record<string, unknown> {
  const text = `${subject}\n${bodyText}`;

  // Booking number patterns
  const bookingPatterns = [
    /(?:booking|bkg)[\s#:]*([A-Z0-9]{8,12})/gi,
    /\b(26\d{7})\b/g, // Maersk
    /\b(HL-?\d{8})\b/gi, // Hapag
  ];

  let bookingNumber: string | null = null;
  for (const pattern of bookingPatterns) {
    const match = text.match(pattern);
    if (match) {
      bookingNumber = match[1] || match[0].replace(/[^A-Z0-9-]/gi, '');
      break;
    }
  }

  // Container numbers
  const containerPattern = /\b([A-Z]{4}\d{7})\b/g;
  const containers = [...new Set([...text.matchAll(containerPattern)].map((m) => m[1]))];

  // BL number
  const blPatterns = [
    /(?:b\/l|bl|bill of lading)[\s#:]*([A-Z0-9]{10,20})/gi,
    /\b([A-Z]{4}\d{10,12})\b/g,
  ];
  let blNumber: string | null = null;
  for (const pattern of blPatterns) {
    const match = text.match(pattern);
    if (match) {
      blNumber = match[1] || match[0];
      break;
    }
  }

  // ETD/ETA
  const etdMatch = text.match(/ETD[\s:]*(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i);
  const etaMatch = text.match(/ETA[\s:]*(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i);

  // Vessel
  const vesselMatch = text.match(/(?:vessel|m\/v|mv)[\s:]*([A-Za-z0-9\s]+?)(?:\s*voyage|\s*\n|$)/i);

  // Voyage
  const voyageMatch = text.match(/(?:voyage|voy)[\s#:]*([A-Z0-9]{4,10})/i);

  return {
    booking_number: bookingNumber,
    bl_number: blNumber,
    container_numbers: containers,
    etd: etdMatch?.[1] || null,
    eta: etaMatch?.[1] || null,
    vessel_name: vesselMatch?.[1]?.trim() || null,
    voyage_number: voyageMatch?.[1] || null,
  };
}

// =============================================================================
// TEST RUNNER
// =============================================================================

interface TestResult {
  emailId: string;
  subject: string;
  carrier: string | null;
  structured: {
    success: boolean;
    confidence: number;
    tokensUsed: number;
    data: UniversalShippingExtraction | null;
  };
  regex: Record<string, unknown>;
  classification?: {
    documentType: string;
    confidence: number;
    reasoning: string;
  };
}

async function testEmail(emailId: string): Promise<TestResult | null> {
  // Fetch email
  const { data: email, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email, true_sender_email')
    .eq('id', emailId)
    .single();

  if (error || !email) {
    console.error(`Failed to fetch email ${emailId}:`, error?.message);
    return null;
  }

  // Detect carrier from sender email
  const senderEmail = email.true_sender_email || email.sender_email || '';
  let carrier: string | null = null;
  if (senderEmail.includes('maersk') || senderEmail.includes('sealand')) carrier = 'maersk';
  else if (senderEmail.includes('hapag') || senderEmail.includes('hlag')) carrier = 'hapag-lloyd';
  else if (senderEmail.includes('cma-cgm') || senderEmail.includes('cmacgm')) carrier = 'cma-cgm';
  else if (senderEmail.includes('coscon') || senderEmail.includes('cosco')) carrier = 'cosco';
  else if (senderEmail.includes('msc.com')) carrier = 'msc';

  // Fetch PDF content
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', emailId)
    .eq('is_business_document', true);

  const pdfContent = attachments
    ?.map((a) => a.extracted_text)
    .filter(Boolean)
    .join('\n\n');

  const combinedText = [
    email.body_text || '',
    pdfContent || '',
  ].filter(Boolean).join('\n\n');

  if (combinedText.length < 100) {
    console.log(`  ⚠️  Skipping - content too short (${combinedText.length} chars)`);
    return null;
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📧 ${email.subject?.slice(0, 60)}...`);
  console.log(`   Carrier: ${carrier || 'unknown'} | Content: ${combinedText.length} chars`);
  console.log('─'.repeat(70));

  // Run structured extraction
  console.log('\n📊 Structured Extraction...');
  const structuredResult = await extractStructured(
    combinedText,
    carrier,
    email.subject
  );

  if (structuredResult.success) {
    console.log(`   ✅ Success | Confidence: ${structuredResult.confidence}% | Tokens: ${structuredResult.tokensUsed}`);
  } else {
    console.log(`   ❌ Failed: ${structuredResult.error}`);
  }

  // Run classification
  console.log('\n🏷️  Classification...');
  const classificationResult = await classifyDocument(
    combinedText,
    carrier,
    email.subject
  );

  if (classificationResult.success && classificationResult.data) {
    console.log(`   ✅ Type: ${classificationResult.data.document_type} (${classificationResult.data.confidence}%)`);
    console.log(`   📝 ${classificationResult.data.classification_reasoning.slice(0, 80)}...`);
  }

  // Run regex extraction
  console.log('\n🔍 Regex Extraction...');
  const regexResult = extractWithRegex(email.subject || '', email.body_text || '');

  // Compare key fields
  console.log('\n📋 Comparison:');
  const fields = ['booking_number', 'bl_number', 'vessel_name', 'voyage_number', 'etd', 'eta'];

  for (const field of fields) {
    const regexValue = regexResult[field];
    const structuredValue = structuredResult.data?.[field as keyof UniversalShippingExtraction];

    if (regexValue || structuredValue) {
      const match = regexValue === structuredValue ? '✓' :
                   (!regexValue && structuredValue) ? '➕' :
                   (regexValue && !structuredValue) ? '➖' : '≠';
      console.log(`   ${match} ${field}:`);
      if (regexValue) console.log(`      Regex: ${JSON.stringify(regexValue)}`);
      if (structuredValue) console.log(`      Structured: ${JSON.stringify(structuredValue)}`);
    }
  }

  // Show containers
  const regexContainers = regexResult.container_numbers as string[];
  const structuredContainers = structuredResult.data?.container_numbers || [];
  if (regexContainers.length > 0 || structuredContainers.length > 0) {
    console.log(`   📦 Containers:`);
    console.log(`      Regex: ${regexContainers.length > 0 ? regexContainers.join(', ') : 'none'}`);
    console.log(`      Structured: ${structuredContainers.length > 0 ? structuredContainers.join(', ') : 'none'}`);
  }

  // Show additional fields only from structured
  const additionalFields = ['shipper_name', 'consignee_name', 'commodity', 'si_cutoff', 'vgm_cutoff'];
  const additionalData = additionalFields
    .filter(f => structuredResult.data?.[f as keyof UniversalShippingExtraction])
    .map(f => `${f}: ${structuredResult.data?.[f as keyof UniversalShippingExtraction]}`);

  if (additionalData.length > 0) {
    console.log(`\n   ➕ Additional data from structured:`);
    for (const item of additionalData) {
      console.log(`      ${item}`);
    }
  }

  return {
    emailId,
    subject: email.subject || '',
    carrier: carrier,
    structured: {
      success: structuredResult.success,
      confidence: structuredResult.confidence,
      tokensUsed: structuredResult.tokensUsed,
      data: structuredResult.data,
    },
    regex: regexResult,
    classification: classificationResult.success && classificationResult.data ? {
      documentType: classificationResult.data.document_type,
      confidence: classificationResult.data.confidence,
      reasoning: classificationResult.data.classification_reasoning,
    } : undefined,
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const carrierFilter = args.includes('--carrier') ? args[args.indexOf('--carrier') + 1] : null;
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 5;

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           STRUCTURED EXTRACTION POC TEST                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n⚙️  Settings: carrier=${carrierFilter || 'all'}, limit=${limit}`);

  // Fetch test emails
  let query = supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email')
    .eq('email_direction', 'inbound')
    .not('body_text', 'is', null)
    .order('received_at', { ascending: false });

  if (carrierFilter) {
    // Filter by sender email domain for carrier
    const carrierDomains: Record<string, string[]> = {
      maersk: ['maersk', 'sealand'],
      hapag: ['hapag', 'hlag'],
      cma: ['cma-cgm', 'cmacgm'],
      cosco: ['coscon', 'cosco'],
      msc: ['msc.com'],
    };
    const domains = carrierDomains[carrierFilter.toLowerCase()] || [carrierFilter];
    query = query.or(domains.map(d => `sender_email.ilike.%${d}%`).join(','));
  }

  const { data: emails, error } = await query.limit(limit);

  if (error || !emails?.length) {
    console.error('❌ No emails found:', error?.message);
    return;
  }

  console.log(`\n📬 Found ${emails.length} emails to test\n`);

  // Run tests
  const results: TestResult[] = [];
  let totalTokens = 0;
  let successCount = 0;
  let totalConfidence = 0;

  for (const email of emails) {
    const result = await testEmail(email.id);
    if (result) {
      results.push(result);
      totalTokens += result.structured.tokensUsed;
      if (result.structured.success) {
        successCount++;
        totalConfidence += result.structured.confidence;
      }
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  // Print summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  console.log(`\n📊 Results:`);
  console.log(`   Emails tested: ${results.length}`);
  console.log(`   Successful extractions: ${successCount} (${Math.round((successCount / results.length) * 100)}%)`);
  console.log(`   Average confidence: ${successCount > 0 ? Math.round(totalConfidence / successCount) : 0}%`);

  console.log(`\n💰 Cost:`);
  console.log(`   Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`   Estimated cost: $${(totalTokens * 0.00025 / 1000).toFixed(4)} (Haiku pricing)`);

  // Classification breakdown
  const classificationCounts = results.reduce((acc, r) => {
    const type = r.classification?.documentType || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`\n🏷️  Document Types Detected:`);
  for (const [type, count] of Object.entries(classificationCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type}: ${count}`);
  }

  // Fields found only by structured extraction
  const structuredOnlyFields: Record<string, number> = {};
  for (const result of results) {
    if (!result.structured.data) continue;

    const structuredFields = ['shipper_name', 'consignee_name', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'commodity'];
    for (const field of structuredFields) {
      if (result.structured.data[field as keyof UniversalShippingExtraction]) {
        structuredOnlyFields[field] = (structuredOnlyFields[field] || 0) + 1;
      }
    }
  }

  if (Object.keys(structuredOnlyFields).length > 0) {
    console.log(`\n➕ Additional data captured by structured extraction:`);
    for (const [field, count] of Object.entries(structuredOnlyFields).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${field}: found in ${count} emails`);
    }
  }

  console.log('\n✅ POC test complete!');
}

main().catch(console.error);
