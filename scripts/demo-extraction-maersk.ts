/**
 * Demo Script: Maersk Email Extraction Demo
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// SAMPLE DATA - Maersk Booking Amendment
// =============================================================================

const SAMPLE_EMAIL = {
  subject: "Booking Amendment : 263814897",
  sender: "maerskcustomerservice via Operations Intoglo <ops@intoglo.com>",
  body: "(Email body was empty - all content in PDF attachment)",
};

const SAMPLE_PDF_TEXT = `BOOKING AMENDMENT
2026-01-09 11:25 UTC
Booking No.:
263814897
Print Date:
Booked by Party:
INTOGLO PRIVATE LIMITED.
Service Mode:
CY/CY
 TEAM CONTACT
From:
Gurgaon,HARYANA,India
Contact Name:
Booked by Ref. No:To:
Toronto,Ontario,Canada
Customer Cargo:
Service Contract:
299973976
Price Owner:
Business Unit:
Maersk India (New Delhi)
INTOGLO PRIVATE LIMITED.
Commodity Description:
Named Account Customer:
Autoparts, car parts, vehicle parts, motorcycle
Allocation week: AllocationWeek-2026/4-VesselName-CORNELIA MAERSK-546
Block space plus
We request you to review the specific parameters, viz. Service Contract, Price Owner, Named account customer and Commodity
description. In case there are any changes required to these parameters, please send us a request before any containers(s) are picked
NFTP – New Finance & Tax Platform: Use the below link for a Step-by-Step guide to "Paid to Release" and "Delivery Option" on Maersk.com
https://www.maersk.com/news/articles/2023/10/20/step-by-step-guide-for-paid-to-release-and-delivery-option-on-maersk
Step-by-Step guide for "Paid to Release" and "Delivery Option" on Maersk.com
As per our earlier communication, effective 7 November 2023, we are introducing two new online solutions, providing users with a more streamlined
experience when navigating the payment remittance
Thank you for placing your booking with Maersk A/S, as Carrier
Price Calculation Date: 2026-01-21
The rates and other applicable charges on your shipment will be invoiced based on Price Calculation Date (PCD)
For Non-FMC shipments, PCD is the Estimated Time of Departure (ETD) of the first vessel in the latest booking confirmation issued upon customer
request.
For FMC shipments, PCD is the date on which Maersk Line A/S or one of its authorised agent(s) takes possession of the last container listed on the
transport document.
Note: FMC regulated trades are shipments exiting or entering a port in the United States, Guam, US Virgin Islands, American Samoa or Puerto Rico
(US).
Equipment
QuantitySize/Type/Height(ft.in)CollapsibleSub. EquipGross WeightPack. Qty/KindCargo Volume
1
20 DRY
8 620000.000 KGS23 PACKAGE
Intended Transport Plan
FromToModeVesselVoy No.ETDETA
Gateway Rail freight Pvt
Ltd,Gurgao
PIPAVAV TERMINAL
RR
2026-01-152026-01-18
PIPAVAV TERMINALNewark - Maher Terminal
MVS
CORNELIA MAERSK(DK)603W2026-01-212026-02-24
Newark - Maher TerminalSEAPORT INTERMODAL
ETOBICOKE
TRK
2026-02-262026-02-27
Load Itinerary
TypeLocationRelease DateFromToReturn DateTimeLoad Ref.
Empty Container
Depot
Gateway Rail freight Pvt Ltd,Gurgao
Gateway Rail freight Pvt Ltd,Gurgao
Inland Container Depot Opp W
Cabin
Gurgaon, 06
2026-01-0714:04
Return Equip
Delivery Terminal
Gateway Rail freight Pvt Ltd,Gurgao
Gateway Rail freight Pvt Ltd,Gurgao
Inland Container Depot Opp W
Cabin
Gurgaon, 06
The Merchant(s) warrant and represent that this shipment and/or Goods will comply at all times with European Union, United States and United Nations sanctions and export control laws (Sanctions
Laws), and that this shipment and/or Goods does not involve, whether directly or indirectly, any entity or person identified, or owned or controlled by any such entity or person identified, on the U.S.
Treasury Departments Office of Foreign Asset Control (OFAC) list of Specially Designated Nationals and Blocked Persons, or any other similar list maintained by the European Union, or as promulgated by
the United Nations Security Council (Designated Person).  Without limiting the foregoing in any way whatsoever, the Merchant(s) warrant and represent that this shipment and/or Goods in no way
This document is subject to following:
This booking and carriage are subject to the Maersk Terms and Conditions of Carriage which are available upon request from the carrier or his representatives and are furthermore accessible on the
Maersk website "<http://www.maersk.com>" under "Terms and conditions" or the same can be checked in "https://terms.maersk.com/"
- The shipment is subject to tariff rates unless a correct and applicable service contract number is available
- The carrier's right to substitute the named and/or performing vessel(s) with another vessel or vessels at any time.
- Arrival, berthing, departure and transit times are estimated and given without guarantee and subject to change without prior notice
- All dates/times are given as reasonable estimates only and subject to change without prior notice.
Shipments destined for or carried/transhipped via the USA:
- This document is given subject to the customer providing the correct cargo description in accordance with U.S. law, including U.S. Customs requirements as described in Customs Rules and Regulations,
19 CFR Parts 4, 113 and 178 of October 31, 2002
Page
1/2`;

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
  container_quantity: z.number().nullish(),
  container_type: z.string().nullish(),
  service_contract: z.string().nullish(),
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
  console.log('║              STRUCTURED EXTRACTION DEMO - Maersk Booking                     ║');
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
  console.log(`\n  Body: ${SAMPLE_EMAIL.body}`);

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📎 PDF ATTACHMENT (Extracted Text)                                          │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');
  console.log('\n  Filename: DB_aabhghjfhjba0x0B2A.pdf');
  console.log('  ' + '─'.repeat(74));
  console.log(SAMPLE_PDF_TEXT.slice(0, 2800).split('\n').map(l => '  │ ' + l.slice(0, 72)).join('\n'));
  console.log('  │ ...');
  console.log('  ' + '─'.repeat(74));

  // ==========================================================================
  // SECTION 2: STRUCTURED EXTRACTION
  // ==========================================================================

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  🤖 RUNNING STRUCTURED EXTRACTION...                                         │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  const combinedText = `Email Subject: ${SAMPLE_EMAIL.subject}\n\nPDF Attachment Content:\n${SAMPLE_PDF_TEXT}`;

  const tool: Anthropic.Tool = {
    name: 'extract_shipping_data',
    description: 'Extract structured shipping data from the document',
    input_schema: zodToJsonSchema(UniversalShippingExtractionSchema) as Anthropic.Tool.InputSchema,
  };

  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are an expert shipping document analyzer for Maersk booking documents.

EXTRACT these fields from the document:
- document_type: "booking_amendment" if it says BOOKING AMENDMENT, "booking_confirmation" otherwise
- booking_number: Look for "Booking No.:" (e.g., 263814897)
- carrier_name: Maersk
- carrier_code: MAEU
- vessel_name: Look in "Intended Transport Plan" for vessel name (e.g., CORNELIA MAERSK)
- voyage_number: Look for "Voy No." (e.g., 603W)
- port_of_loading: First sea port in transport plan (e.g., PIPAVAV TERMINAL)
- port_of_discharge: Final sea port before inland delivery (e.g., Newark - Maher Terminal)
- place_of_receipt: Origin city (e.g., Gurgaon, HARYANA, India)
- place_of_delivery: Final destination city (e.g., Toronto, Ontario, Canada)
- etd: Sea vessel ETD date (convert to YYYY-MM-DD)
- eta: Sea vessel ETA date (convert to YYYY-MM-DD)
- shipper_name: "Booked by Party:" value
- commodity: "Commodity Description:" value
- gross_weight_kg: Look in Equipment table for "Gross Weight" (number only, in KG)
- container_quantity: Number of containers from Equipment table
- container_type: Container type (e.g., "20 DRY")
- service_contract: Contract number

RULES:
1. Extract exactly what you see in the document
2. Convert ALL dates to YYYY-MM-DD format
3. For multi-leg routes with inland + sea + inland, extract SEA LEG dates for ETD/ETA
4. Set confidence to 85+ if you found most key fields`,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extract_shipping_data' },
    messages: [{ role: 'user', content: combinedText }],
  });

  const elapsed = Date.now() - startTime;
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  console.log(`\n  ⏱️  Time: ${elapsed}ms | Tokens: ${tokensUsed} | Cost: ~$${(tokensUsed * 0.003 / 1000).toFixed(5)}`);

  if (!toolUse || toolUse.type !== 'tool_use') {
    console.log('\n  ❌ No structured output received');
    return;
  }

  const validationResult = UniversalShippingExtractionSchema.safeParse(toolUse.input);

  if (!validationResult.success) {
    console.log('\n  ❌ Validation failed:', validationResult.error.message);
    console.log('\n  Raw output:', JSON.stringify(toolUse.input, null, 2));
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
  console.log(`  │ Service Contract:  ${extracted.service_contract || '—'}`);

  console.log('\n  ─── ROUTE ─────────────────────────────────────────────────────────────────');
  console.log(`  │ Place of Receipt:  ${extracted.place_of_receipt || '—'}`);
  console.log(`  │ POL:               ${extracted.port_of_loading || '—'} (${extracted.port_of_loading_code || '—'})`);
  console.log(`  │ POD:               ${extracted.port_of_discharge || '—'} (${extracted.port_of_discharge_code || '—'})`);
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

  console.log('\n  ─── CARGO ─────────────────────────────────────────────────────────────────');
  console.log(`  │ Commodity:         ${extracted.commodity || '—'}`);
  console.log(`  │ Gross Weight:      ${extracted.gross_weight_kg ? extracted.gross_weight_kg + ' KG' : '—'}`);
  console.log(`  │ Container Qty:     ${extracted.container_quantity || '—'}`);
  console.log(`  │ Container Type:    ${extracted.container_type || '—'}`);

  console.log('\n  ─── CONTAINERS ────────────────────────────────────────────────────────────');
  if (extracted.container_numbers && extracted.container_numbers.length > 0) {
    extracted.container_numbers.forEach((c, i) => console.log(`  │ [${i + 1}] ${c}`));
  } else {
    console.log('  │ (No container numbers in document yet - this is a booking amendment)');
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

  const cleanData = Object.fromEntries(
    Object.entries(extracted).filter(([_, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
  );
  console.log('\n' + JSON.stringify(cleanData, null, 2).split('\n').map(l => '  ' + l).join('\n'));

  console.log('\n\n✅ Demo complete!\n');
}

main().catch(console.error);
