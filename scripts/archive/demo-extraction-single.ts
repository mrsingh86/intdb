/**
 * Demo Script: Single Email Extraction Demo
 *
 * Shows raw email/attachment content alongside structured extraction results.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// SAMPLE DATA - Hapag-Lloyd Booking Confirmation
// =============================================================================

const SAMPLE_EMAIL = {
  subject: "RE: BOOKING REF: 37860708  //  FOR 2*20'GP FROM HAZIRA TO HOUSTON //",
  sender: "tarun.goel@swl.in",
  body: `Dear Sir,

Revised CRO already shared as per attacehd mail..

Thanks & Regards,
Tarun Goel
Sr. Executive  - Operation & Documentation

Note : We are pleased to announce the launch of our new in-house customs
clearance facility based right here in the Delhi/NCR region.

Mobile: +91 8439391205, Tel No: 0120 - 4728019
Email: tarun.goel@swl.in, W: WWW.SWL.IN

9th Floor, A - 915, Logix Cyber Park, Plot No. C-28 & 29,
Sector 62, Noida, Gautambudhha Nagar, Uttar Pradesh - 201309`,
};

const SAMPLE_PDF_TEXT = `Page 1 of 3
BOBC0201-060TB
Hapag-Lloyd Aktiengesellschaft
Our Reference:37860708
Submit your VGM
HAPAG-LLOYD INDIA PVT. LTD.
501,5TH FLOOR SATELLITE GAZEBO,, B-WING,GURU HARGOVINDJI MARG, ANDHERI(EAST),
MUMBAI 400093, INDIA (AS AGENT)
Chairman of the Supervisory Board: Michael Behrendt
Executive Board: Rolf Habben Jansen (CEO), Donya-Florence Amer, Dheeraj Bhatia, Mark Frese, Dr. Maximilian Rothkopf
Registered Office: Hamburg, Company Register: Amtsgericht Hamburg HRB 97937
Received from:
SAFEWATER LINES INDIA PRIVATE
LIMITED
9TH FLOOR, A-915, LOGIX CYBER PARK
PLOT NO.C 28 AND 29,SECTOR 62,NOIDA
NOIDA 201309, INDIA
Name
NIRMAL NEGI
Tel.9811790781
E-MailTARUN.GOEL@SWL.IN
HL Booking Contact:
NameHAPAG-LLOYD INDIA PVT. LTD.
Tel.
Fax
E-MailIndia@service.hlag.com
EN
Booking Confirmation
Date of Issue:09-Jan-202606:14:33
- 1ST UPDATE
Our Reference:
37860708
Booking Date:07-Jan-2026
Contract No.:S25MIN008
BL/SWB No(s).:HLCUBO1260164692
Export:FCL/ Merchant's Haulage (CY)
Import:FCL/ Merchant's Haulage (CY)
DGTemp.OOGSOW
Summary:1x22GP
Export terminal delivery address
ADANI HAZIRA PORT PVT. LTD.
AT & PO HAZIRA, CHORYASHI
SURAT ,GUJARAT, INDIA
GUJARAT 394270
GUJARAT, INDIA
Export empty pick up depot(s)
HAZIRA CONTAINER
HAZIRA CONTAINER YARD LLP
NEXT TO ADANI WILMAR, NEAR SEABIRD
SUVALI VILLAGE, TAL CHORYASI
SURAT 394510
GUJARAT, INDIA
FromToByETDETA
HAZIRA
ADANI HAZIRA PORT
(INHZA)
MUNDRA
ACMTPL
(INMUN)
Vessel
SSL GUJARAT
DP Voyage: 745617
Voy. No: 192
Ext. Voy: 192
IMO No: 9137533
Call Sign: AWJM
16-Jan-2026
02:00
17-Jan-2026
02:00
MUNDRA
MUNDRA INTERNATIONAL
(INMUN)
TANGER MED
APMT TC4
(MAPTM)
Vessel
A.P. MOLLER
DP Voyage: 674995
Voy. No: 604W
IMO No: 9948803
Call Sign: OZTM2
Flag: DENMARK
28-Jan-2026
14:00
28-Feb-2026
09:00
TANGER MED
APMT TC4
(MAPTM)
HOUSTON, TX
BARBOURS CUT TERMINA
(USHOU)
Vessel
JAMAICA EXPRESS
DP Voyage: 677387
Voy. No: 609W
IMO No: 9686912
Call Sign: V7IL5
Flag: MARSHALL ISLANDS (US)
05-Mar-2026
23:00
27-Mar-2026
15:00

Page 2 of 3
BOBC0201-060TB
Hapag-Lloyd Aktiengesellschaft
Our Reference:37860708
Submit your VGM
Import terminal pick up address
BARBOURS CUT TERMINAL
1515 E BARBOURS CUT BLVD
LA PORTE, TX 77571
USA
DeadlineLocationDate / Time (local)Required Action
Shipping instruction closing
HAZIRA
(INHZA)
13-Jan-2026
02:00
Provide your final BL/SWB instructions
VGM cut-off
HAZIRA
(INHZA)
14-Jan-2026
02:00
Provide verified container gross weight
(VGM)
Earliest container delivery date
HAZIRA
(INHZA)
14-Jan-2026
02:00
First possible delivery of containers at
the export terminal
FCL delivery cut-off
HAZIRA
(INHZA)
14-Jan-2026
02:00
Last possible delivery of regular
containers at the export terminal
Estimated time of arrival
HAZIRA
(INHZA)
15-Jan-2026
02:00
For information
No.TypeContainer no.SOWEmpty pick up date/timeEmpty pick up depotAdd. Info
122GPN09-Jan-2026HAZIRA CONTAINER
Container Type
20' X 8' X 8'6" GENERAL PURPOSE CONT.
Commodity
Description: GLYCINE HS Code: 29 22 49 Gross Weight: 21000.0 KGM
Customs Details

According to shipment routing, the following customs requirements are relevant:

Direct: USA (AMS/ISF)

Hapag-Lloyd AG SCAC code: HLCU

This booking confirmation is subject to receiving of all relevant bill of lading / sea waybill data from the shipper in due time respectively according
to local documentation closing dates/times.
Remarks


*** FIO Charges remark ***
We would once again inform you weight deviation charge is applicable
to export shipments, pls refer below link for more details`;

// =============================================================================
// SCHEMA
// =============================================================================

const UniversalShippingExtractionSchema = z.object({
  document_type: z.enum([
    'booking_confirmation', 'booking_amendment', 'bill_of_lading', 'draft_bl',
    'arrival_notice', 'shipping_instructions', 'invoice', 'vgm_confirmation',
    'customs_entry', 'packing_list', 'unknown',
  ]),
  booking_number: z.string().nullish(),
  bl_number: z.string().nullish(),
  container_numbers: z.array(z.string()).optional().default([]),
  carrier_name: z.string().nullish(),
  carrier_code: z.string().nullish(),
  vessel_name: z.string().nullish(),
  voyage_number: z.string().nullish(),
  port_of_loading: z.string().nullish(),
  port_of_loading_code: z.string().nullish(),
  port_of_discharge: z.string().nullish(),
  port_of_discharge_code: z.string().nullish(),
  place_of_receipt: z.string().nullish(),
  place_of_delivery: z.string().nullish(),
  etd: z.string().nullish(),
  eta: z.string().nullish(),
  si_cutoff: z.string().nullish(),
  vgm_cutoff: z.string().nullish(),
  cargo_cutoff: z.string().nullish(),
  shipper_name: z.string().nullish(),
  consignee_name: z.string().nullish(),
  notify_party_name: z.string().nullish(),
  commodity: z.string().nullish(),
  hs_code: z.string().nullish(),
  gross_weight_kg: z.union([z.number(), z.string()]).nullish(),
  volume_cbm: z.union([z.number(), z.string()]).nullish(),
  confidence: z.number().min(0).max(100).optional().default(50),
  extraction_notes: z.string().nullish(),
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
    return { type: 'object', properties, required: ['document_type'] };
  }
  if (def.typeName === 'ZodString') return { type: ['string', 'null'], description: def.description };
  if (def.typeName === 'ZodNumber') return { type: ['number', 'null'], description: def.description };
  if (def.typeName === 'ZodBoolean') return { type: 'boolean', description: def.description };
  if (def.typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) };
  if (def.typeName === 'ZodEnum') return { type: 'string', enum: def.values };
  if (def.typeName === 'ZodNullable' || def.typeName === 'ZodOptional') return zodToJsonSchema(def.innerType);
  if (def.typeName === 'ZodDefault') return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };
  if (def.typeName === 'ZodUnion') return { type: ['number', 'string', 'null'] };
  return { type: ['string', 'null'] };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              STRUCTURED EXTRACTION DEMO - Single Email                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  // ==========================================================================
  // SECTION 1: RAW INPUT
  // ==========================================================================

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📧 RAW EMAIL                                                                │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  console.log(`\n  Subject: ${SAMPLE_EMAIL.subject}`);
  console.log(`  From: ${SAMPLE_EMAIL.sender}`);
  console.log(`\n  Body:`);
  console.log('  ' + '─'.repeat(74));
  console.log(SAMPLE_EMAIL.body.split('\n').map(l => '  │ ' + l).join('\n'));
  console.log('  ' + '─'.repeat(74));

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📎 PDF ATTACHMENT (Extracted Text - First 2500 chars)                       │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');
  console.log('\n  Filename: HL-37860708 MAPTM BC 1ST UPDATE.PDF');
  console.log('  ' + '─'.repeat(74));
  console.log(SAMPLE_PDF_TEXT.slice(0, 2500).split('\n').map(l => '  │ ' + l.slice(0, 70)).join('\n'));
  console.log('  │ ...');
  console.log('  ' + '─'.repeat(74));

  // ==========================================================================
  // SECTION 2: STRUCTURED EXTRACTION
  // ==========================================================================

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  🤖 RUNNING STRUCTURED EXTRACTION...                                         │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  const combinedText = `Email Subject: ${SAMPLE_EMAIL.subject}\n\nEmail Body:\n${SAMPLE_EMAIL.body}\n\nPDF Attachment Content:\n${SAMPLE_PDF_TEXT}`;

  const tool: Anthropic.Tool = {
    name: 'extract_shipping_data',
    description: 'Extract structured shipping data from the document',
    input_schema: zodToJsonSchema(UniversalShippingExtractionSchema) as Anthropic.Tool.InputSchema,
  };

  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are an expert shipping document analyzer for Hapag-Lloyd booking confirmations.

EXTRACT these fields from the document:
- booking_number: Look for "Our Reference:" (e.g., 37860708)
- bl_number: Look for "BL/SWB No(s).:" (e.g., HLCUBO1260164692)
- carrier_name: Hapag-Lloyd
- carrier_code: HLCU
- vessel_name: Look for "Vessel" entries (e.g., SSL GUJARAT, A.P. MOLLER, JAMAICA EXPRESS)
- voyage_number: Look for "Voy. No:" (e.g., 192, 604W, 609W)
- port_of_loading: First port in route (HAZIRA)
- port_of_loading_code: INHZA
- port_of_discharge: Final destination port (HOUSTON, TX)
- port_of_discharge_code: USHOU
- etd: First departure date in route (convert to YYYY-MM-DD)
- eta: Final arrival date (convert to YYYY-MM-DD)
- si_cutoff: "Shipping instruction closing" date (convert to YYYY-MM-DD)
- vgm_cutoff: "VGM cut-off" date (convert to YYYY-MM-DD)
- cargo_cutoff: "FCL delivery cut-off" date (convert to YYYY-MM-DD)
- shipper_name: "Received from:" company name
- commodity: Description field
- hs_code: HS Code value
- gross_weight_kg: Gross Weight value (number only)

RULES:
1. Extract exactly what you see - no guessing
2. Convert ALL dates to YYYY-MM-DD format
3. For multi-leg routes, use FIRST departure as ETD and LAST arrival as ETA
4. Set confidence to 85+ if you found most key fields`,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extract_shipping_data' },
    messages: [{ role: 'user', content: combinedText }],
  });

  const elapsed = Date.now() - startTime;
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  console.log(`\n  ⏱️  Time: ${elapsed}ms | Tokens: ${tokensUsed} | Cost: ~$${(tokensUsed * 0.00025 / 1000).toFixed(5)}`);

  if (!toolUse || toolUse.type !== 'tool_use') {
    console.log('\n  ❌ No structured output received');
    return;
  }

  const validationResult = UniversalShippingExtractionSchema.safeParse(toolUse.input);

  if (!validationResult.success) {
    console.log('\n  ❌ Validation failed:', validationResult.error.message);
    return;
  }

  const extracted = validationResult.data;

  // ==========================================================================
  // SECTION 3: EXTRACTION RESULTS
  // ==========================================================================

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  ✅ EXTRACTION RESULTS                                                       │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  console.log(`\n  📋 Document Type: ${extracted.document_type}`);
  console.log(`  🎯 Confidence: ${extracted.confidence}%`);

  console.log('\n  ─── BOOKING DETAILS ───────────────────────────────────────────────────────');
  console.log(`  │ Booking Number:    ${extracted.booking_number || '—'}`);
  console.log(`  │ BL Number:         ${extracted.bl_number || '—'}`);
  console.log(`  │ Carrier:           ${extracted.carrier_name || '—'} (${extracted.carrier_code || '—'})`);

  console.log('\n  ─── ROUTE ─────────────────────────────────────────────────────────────────');
  console.log(`  │ POL:               ${extracted.port_of_loading || '—'} (${extracted.port_of_loading_code || '—'})`);
  console.log(`  │ POD:               ${extracted.port_of_discharge || '—'} (${extracted.port_of_discharge_code || '—'})`);
  console.log(`  │ Place of Receipt:  ${extracted.place_of_receipt || '—'}`);
  console.log(`  │ Place of Delivery: ${extracted.place_of_delivery || '—'}`);

  console.log('\n  ─── VESSEL/VOYAGE ─────────────────────────────────────────────────────────');
  console.log(`  │ Vessel:            ${extracted.vessel_name || '—'}`);
  console.log(`  │ Voyage:            ${extracted.voyage_number || '—'}`);

  console.log('\n  ─── DATES ─────────────────────────────────────────────────────────────────');
  console.log(`  │ ETD:               ${extracted.etd || '—'}`);
  console.log(`  │ ETA:               ${extracted.eta || '—'}`);
  console.log(`  │ SI Cutoff:         ${extracted.si_cutoff || '—'}`);
  console.log(`  │ VGM Cutoff:        ${extracted.vgm_cutoff || '—'}`);
  console.log(`  │ Cargo Cutoff:      ${extracted.cargo_cutoff || '—'}`);

  console.log('\n  ─── PARTIES ───────────────────────────────────────────────────────────────');
  console.log(`  │ Shipper:           ${extracted.shipper_name || '—'}`);
  console.log(`  │ Consignee:         ${extracted.consignee_name || '—'}`);
  console.log(`  │ Notify Party:      ${extracted.notify_party_name || '—'}`);

  console.log('\n  ─── CARGO ─────────────────────────────────────────────────────────────────');
  console.log(`  │ Commodity:         ${extracted.commodity || '—'}`);
  console.log(`  │ HS Code:           ${extracted.hs_code || '—'}`);
  console.log(`  │ Gross Weight:      ${extracted.gross_weight_kg ? extracted.gross_weight_kg + ' KG' : '—'}`);
  console.log(`  │ Volume:            ${extracted.volume_cbm ? extracted.volume_cbm + ' CBM' : '—'}`);

  console.log('\n  ─── CONTAINERS ────────────────────────────────────────────────────────────');
  if (extracted.container_numbers.length > 0) {
    extracted.container_numbers.forEach((c, i) => console.log(`  │ [${i + 1}] ${c}`));
  } else {
    console.log('  │ (No container numbers extracted)');
  }

  if (extracted.extraction_notes) {
    console.log('\n  ─── NOTES ─────────────────────────────────────────────────────────────────');
    console.log(`  │ ${extracted.extraction_notes}`);
  }

  // ==========================================================================
  // SECTION 4: RAW JSON
  // ==========================================================================

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📦 RAW JSON OUTPUT                                                          │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  // Filter out null values for cleaner output
  const cleanData = Object.fromEntries(
    Object.entries(extracted).filter(([_, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
  );
  console.log('\n' + JSON.stringify(cleanData, null, 2).split('\n').map(l => '  ' + l).join('\n'));

  console.log('\n\n✅ Demo complete!\n');
}

main().catch(console.error);
