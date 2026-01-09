/**
 * Demo Script: COSCO & CMA CGM Email Extraction Demo
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// SAMPLE DATA - CMA CGM Booking Confirmation
// =============================================================================

const CMA_CGM_EMAIL = {
  subject: "CMA CGM - Booking confirmation available – EID0923290 -  - 0INLRW1MA  - INDA1 to USOMA",
  sender: "'CMA CGM Website' via pricing <pricing@intoglo.com>",
  pdf_filename: "BKGCONF_EID0923290.pdf",
  pdf_text: `09-JAN-26 17:00
1
PFR0717_001 v5.157
Booking Confirmation
Run
Page of 3
EID0923290
DHANDARI KALAN, PB (LUDHIANA)
MUNDRA
NORFOLK, VA
OMAHA, NE
08-JAN-26
ADANI CMA CGM CT4
21-JAN-2026 01:30
19-JAN-2026 11:00
25-FEB-2026 07:30
1 x 20'STWashers of iron or steel (excl
Rail
 2000022230
CMA CGM Agencies (India) Pvt Ltd
Sachin Kumar
LINER PDA
25-4659
N
N
N
N
NOIDA
GAUTAM BUDDHA NAGAR
GAUSHALA ROAD
2 UNIT NO 101 BPTP CAPITAL CITY
INTOGLO PVT LTD:0007261403 001
KGMKGM
INTOGLO PVT LTD
Singh Mrigank
PLOT 72 B 2 106
MILAN VIHAR APARTMENTS PATPARGANJ
INDRAPRASTHA EXTENSION
NEW DELHI
/
Dhandari Kalan, Pb (Ludhiana)
18-JAN-2026 17:03
Phone:
Fax:
Contact:
Attn:
Booking Number: Bkg Pty Ref:
Booking Date:
Shipper:
Vessel/Voyage:
Connecting Vessel / Voyage:
Receipt:
Alternate Base Port:
Feeder Vessel/Voyage:
Ramp Cut-Off Date/Time:
Port Of Loading:
Loading Terminal:
Transhipment:
Port Of Discharge:
Final Place Of Delivery:
(All times are in local time)
Terminal Cut-Off::
ETD:
ETA:
ETA:
Remarks:
Merchant Haulage By:
Eqp Available Date: FromTo - :
Quantity:
Net Weight:
HS Commodity:
Gross Weight:
Quote:
HAZ:
FUM:
Reefer:
OverSized Cargo:
Service Contract:
Icd Dhandari KalanAlternate Base Pool:
ETD:
CMA CGM VERDI / 0INLRW1MA
Container Number:
INTOGLO PVT LTD:0007261403 001Forwarder:
SCAC Code:
CMDU
B/L Number:
EID0923290
N
Flexitank:
VGM Cut-Off Date/Time: 19-JAN-2026 04:00
FPD ETA:
CHECK TERMINAL
Earliest Receiving Date/Time:
Customer Service:
EU Commodity Status:
09-JAN-26
19-JAN-26`,
};

// =============================================================================
// SAMPLE DATA - COSCO Booking Confirmation
// =============================================================================

const COSCO_EMAIL = {
  subject: "Cosco Shipping Line Booking Confirmation - COSU6441804980 / Booking Office: BOM / POL: NVA // IPE-QET-024 W",
  sender: "PLEASE-No-Reply-IRIS-4 via Operations Intoglo <ops@intoglo.com>",
  pdf_filename: "6441804980.pdf",
  pdf_text: `COSU6441804980
DATE: 09 Jan 2026 15:44(IST)
Booking Confirmation
FROM: COSCO SHIPPING LINES (INDIA) PRIVATE LIMITED
CONTACT NUMBER:
BOOKING REMARK

- Subject to availability of Containers/FOOD GRADE CONTAINERS
The validity of the Booking shall be until the empty pick up date mentioned in the Booking confirmation.
Please plan your shipment and pick up container as per Vessel final arrival ETA, In case container early or late arrived at port then any
DET/DEM/GR or incurred dummy charges will be on customer account only.
Cut-off yet not confirm. Kindly check with respective CS for the gate opening and cut off details prior movement of your container to the
port to avoid charges.
Next vessel NOT available due to Blank sailings & port omissions, pls plan as per original schedule.
Invoicing party will be as per the Load Port or the Party mentioned in the forwarder column, if invoice to be raised on the Shipper name,
mention the request in REMARKS column while filing the SI, failing which invoice will be raised by default on the forwarder name."
BOOKING NUMBER: COSU6441804980
RATE AGREEMENT REFERENCE: SEN25678 - (SERVICE CONTRACT)
EXTERNAL REFERENCE INFORMATION
File Identifier: FWK2-2026010908503763-67
Cargosmart Reference  Number: CC4693375258
PARTIES INFORMATION
BOOKING PARTY: INTOGLO PRIVATE LIMITED
FORWARDER: INTOGLO PRIVATE LIMITED
SHIPPER: INTOGLO PRIVATE LIMITED
ROUTE INFORMATION
TOTAL BOOKING CONTAINER
QTY SIZE/TYPE:
1 X 40' Hi-Cube Container
PLACE OF RECEIPT: Nhava Sheva,Maharashtra, IndiaLTD: 18 Jan 2026 13:00(IST)
PORT OF LOADING: Nhava Sheva / Nhava Sheva  JNPTETA:  17 Jan 2026
INTENDED VESSEL/VOYAGE: CMA CGM VERDI 0INLRW1MAETD: 18 Jan 2026
SERVICE CODE: IPEVESSEL FLAG: Malta
PORT OF DISCHARGE: New York / Port Liberty New York
LLC
ETA:  18 Feb 2026
FINAL DESTINATION: New York,New York, New York,
United States
ETA:  20 Feb 2026
ESTIMATED CARGO AVAILABILITY AT DESTINATION HUB: 20 Feb 2026 06:00
INTENDED VGM CUT-OFF:  INTENDED FCL CY CUT-OFF: 16 Jan 2026 12:00
INTENDED SI CUT-OFF: 15 Jan 2026 05:00(IST)INTENDED ESI CUT-OFF: 15 Jan 2026 05:00(IST)
LATE AND/OR INCOMPLETE SHIPPING INSTRUCTION SUBMISSION MAY RESULT IN CONTAINER(S) SHORT SHIPMENT AND LATE SI SUBMISSION CHARGES
CARGO INFORMATION
CARGO NATURE: General
CARGO DESCRIPTION: PAPER BAGS
OUTBOUND TRAFFIC TERM: Container YardINBOUND TRAFFIC TERM: Container Yard
BOOKING QTY SIZE/TYPE: 1 X 40' Hi-Cube Container
SOC INDICATOR: N
CARGO WEIGHT: 16000 KGTRAFFIC MODE: FCL / FCL
EMPTY PICK UP LOCATION:  FULL RETURN LOCATION:
Keavy Global Logistic Yard.Nhava Sheva  JNPT
EMPTY PICK UP ADDRESS: C/O  Virgo, Nh-4b Near Toll
Naka. Opposite  Bharat Yard
Village  Jasai Taluka-Uran, Dist-
Raigad Maharastra  400702
FULL RETURN ADDRESS: Jawaharlal Nehru Port Trust,
Administrative Bldg, Sheva,
Mumbai 400707
EMPTY PICK UP DATE/TIME: 13 Jan 2026 08:48(IST)`,
};

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
  commodity: z.string().nullish(),
  hs_code: z.string().nullish(),
  gross_weight_kg: z.union([z.number(), z.string()]).nullish(),
  container_quantity: z.number().nullish(),
  container_type: z.string().nullish(),
  service_contract: z.string().nullish(),
  confidence: z.number().min(0).max(100).optional().default(50),
  extraction_notes: z.string().nullish(),
});

type ExtractionResult = z.infer<typeof UniversalShippingExtractionSchema>;

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
// EXTRACTION FUNCTION
// =============================================================================

async function extractBooking(
  carrierName: string,
  subject: string,
  pdfText: string
): Promise<{ result: ExtractionResult | null; tokens: number; timeMs: number; error?: string }> {
  const tool: Anthropic.Tool = {
    name: 'extract_shipping_data',
    description: 'Extract structured shipping data from the document',
    input_schema: zodToJsonSchema(UniversalShippingExtractionSchema) as Anthropic.Tool.InputSchema,
  };

  const combinedText = `Email Subject: ${subject}\n\nPDF Content:\n${pdfText}`;

  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are an expert shipping document analyzer for ${carrierName} booking confirmations.

EXTRACT these fields:
- document_type: "booking_confirmation" for confirmed bookings
- booking_number: The main booking reference number
- carrier_name: ${carrierName}
- carrier_code: SCAC code (CMDU for CMA CGM, COSU for COSCO)
- vessel_name: Vessel name
- voyage_number: Voyage number/code
- port_of_loading: Load port name
- port_of_loading_code: UN/LOCODE if available
- port_of_discharge: Discharge port name
- port_of_discharge_code: UN/LOCODE if available
- place_of_receipt: Origin location (inland)
- place_of_delivery: Final destination (inland)
- etd: ETD date (YYYY-MM-DD format)
- eta: ETA at discharge port (YYYY-MM-DD format)
- si_cutoff: SI cutoff date (YYYY-MM-DD format)
- vgm_cutoff: VGM cutoff date (YYYY-MM-DD format)
- cargo_cutoff: Terminal/FCL cutoff date (YYYY-MM-DD format)
- shipper_name: Shipper/booking party name
- commodity: Cargo description
- gross_weight_kg: Weight in KG (number only)
- container_quantity: Number of containers
- container_type: Container size/type (e.g., "40' Hi-Cube", "20' Standard")
- service_contract: Contract/agreement reference

RULES:
1. Extract exactly what's in the document
2. Convert ALL dates to YYYY-MM-DD format
3. Set confidence 85+ if most fields found`,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'extract_shipping_data' },
      messages: [{ role: 'user', content: combinedText }],
    });

    const elapsed = Date.now() - startTime;
    const toolUse = response.content.find((block) => block.type === 'tool_use');
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    if (!toolUse || toolUse.type !== 'tool_use') {
      return { result: null, tokens: tokensUsed, timeMs: elapsed, error: 'No tool_use response' };
    }

    const validationResult = UniversalShippingExtractionSchema.safeParse(toolUse.input);

    if (!validationResult.success) {
      return { result: null, tokens: tokensUsed, timeMs: elapsed, error: validationResult.error.message };
    }

    return { result: validationResult.data, tokens: tokensUsed, timeMs: elapsed };
  } catch (error) {
    return { result: null, tokens: 0, timeMs: Date.now() - startTime, error: (error as Error).message };
  }
}

function printExtractionResult(carrier: string, result: ExtractionResult) {
  console.log(`\n  📋 Document Type: ${result.document_type}`);
  console.log(`  🎯 Confidence: ${result.confidence}%`);

  console.log('\n  ─── BOOKING DETAILS ───────────────────────────────────────────────────────');
  console.log(`  │ Booking Number:    ${result.booking_number || '—'}`);
  console.log(`  │ BL Number:         ${result.bl_number || '—'}`);
  console.log(`  │ Carrier:           ${result.carrier_name || '—'} (${result.carrier_code || '—'})`);
  console.log(`  │ Service Contract:  ${result.service_contract || '—'}`);

  console.log('\n  ─── ROUTE ─────────────────────────────────────────────────────────────────');
  console.log(`  │ Place of Receipt:  ${result.place_of_receipt || '—'}`);
  console.log(`  │ POL:               ${result.port_of_loading || '—'} (${result.port_of_loading_code || '—'})`);
  console.log(`  │ POD:               ${result.port_of_discharge || '—'} (${result.port_of_discharge_code || '—'})`);
  console.log(`  │ Place of Delivery: ${result.place_of_delivery || '—'}`);

  console.log('\n  ─── VESSEL/VOYAGE ─────────────────────────────────────────────────────────');
  console.log(`  │ Vessel:            ${result.vessel_name || '—'}`);
  console.log(`  │ Voyage:            ${result.voyage_number || '—'}`);

  console.log('\n  ─── DATES ─────────────────────────────────────────────────────────────────');
  console.log(`  │ ETD:               ${result.etd || '—'}`);
  console.log(`  │ ETA:               ${result.eta || '—'}`);
  console.log(`  │ SI Cutoff:         ${result.si_cutoff || '—'}`);
  console.log(`  │ VGM Cutoff:        ${result.vgm_cutoff || '—'}`);
  console.log(`  │ Cargo Cutoff:      ${result.cargo_cutoff || '—'}`);

  console.log('\n  ─── CARGO ─────────────────────────────────────────────────────────────────');
  console.log(`  │ Shipper:           ${result.shipper_name || '—'}`);
  console.log(`  │ Commodity:         ${result.commodity || '—'}`);
  console.log(`  │ Gross Weight:      ${result.gross_weight_kg ? result.gross_weight_kg + ' KG' : '—'}`);
  console.log(`  │ Container:         ${result.container_quantity || '—'} x ${result.container_type || '—'}`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         STRUCTURED EXTRACTION DEMO - CMA CGM & COSCO                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  // ==========================================================================
  // CMA CGM EXTRACTION
  // ==========================================================================

  console.log('\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📧 CMA CGM BOOKING CONFIRMATION                                             │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  console.log(`\n  Subject: ${CMA_CGM_EMAIL.subject}`);
  console.log(`  Attachment: ${CMA_CGM_EMAIL.pdf_filename}`);
  console.log('\n  PDF Preview:');
  console.log('  ' + '─'.repeat(74));
  console.log(CMA_CGM_EMAIL.pdf_text.slice(0, 1200).split('\n').slice(0, 25).map(l => '  │ ' + l.slice(0, 70)).join('\n'));
  console.log('  │ ...');
  console.log('  ' + '─'.repeat(74));

  console.log('\n  🤖 Extracting...');
  const cmaResult = await extractBooking('CMA CGM', CMA_CGM_EMAIL.subject, CMA_CGM_EMAIL.pdf_text);

  if (cmaResult.result) {
    console.log(`  ✅ Success | Time: ${cmaResult.timeMs}ms | Tokens: ${cmaResult.tokens}`);
    printExtractionResult('CMA CGM', cmaResult.result);
  } else {
    console.log(`  ❌ Failed: ${cmaResult.error}`);
  }

  // ==========================================================================
  // COSCO EXTRACTION
  // ==========================================================================

  console.log('\n\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📧 COSCO BOOKING CONFIRMATION                                               │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  console.log(`\n  Subject: ${COSCO_EMAIL.subject}`);
  console.log(`  Attachment: ${COSCO_EMAIL.pdf_filename}`);
  console.log('\n  PDF Preview:');
  console.log('  ' + '─'.repeat(74));
  console.log(COSCO_EMAIL.pdf_text.slice(0, 1500).split('\n').slice(0, 30).map(l => '  │ ' + l.slice(0, 70)).join('\n'));
  console.log('  │ ...');
  console.log('  ' + '─'.repeat(74));

  console.log('\n  🤖 Extracting...');
  const coscoResult = await extractBooking('COSCO', COSCO_EMAIL.subject, COSCO_EMAIL.pdf_text);

  if (coscoResult.result) {
    console.log(`  ✅ Success | Time: ${coscoResult.timeMs}ms | Tokens: ${coscoResult.tokens}`);
    printExtractionResult('COSCO', coscoResult.result);
  } else {
    console.log(`  ❌ Failed: ${coscoResult.error}`);
  }

  // ==========================================================================
  // COMPARISON SUMMARY
  // ==========================================================================

  console.log('\n\n');
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  📊 COMPARISON SUMMARY                                                       │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  console.log('\n  ┌─────────────────────┬───────────────────────────┬───────────────────────────┐');
  console.log('  │ Field               │ CMA CGM                   │ COSCO                     │');
  console.log('  ├─────────────────────┼───────────────────────────┼───────────────────────────┤');

  const fields: [string, keyof ExtractionResult][] = [
    ['Booking #', 'booking_number'],
    ['Carrier', 'carrier_name'],
    ['Vessel', 'vessel_name'],
    ['Voyage', 'voyage_number'],
    ['POL', 'port_of_loading'],
    ['POD', 'port_of_discharge'],
    ['ETD', 'etd'],
    ['ETA', 'eta'],
    ['SI Cutoff', 'si_cutoff'],
    ['VGM Cutoff', 'vgm_cutoff'],
    ['Cargo Cutoff', 'cargo_cutoff'],
    ['Commodity', 'commodity'],
    ['Weight (KG)', 'gross_weight_kg'],
    ['Container', 'container_type'],
    ['Confidence', 'confidence'],
  ];

  for (const [label, key] of fields) {
    const cmaVal = cmaResult.result?.[key] ?? '—';
    const coscoVal = coscoResult.result?.[key] ?? '—';
    const cmaStr = String(cmaVal).slice(0, 23).padEnd(25);
    const coscoStr = String(coscoVal).slice(0, 23).padEnd(25);
    console.log(`  │ ${label.padEnd(19)} │ ${cmaStr} │ ${coscoStr} │`);
  }

  console.log('  └─────────────────────┴───────────────────────────┴───────────────────────────┘');

  console.log('\n  📈 Performance:');
  console.log(`     CMA CGM: ${cmaResult.timeMs}ms, ${cmaResult.tokens} tokens`);
  console.log(`     COSCO:   ${coscoResult.timeMs}ms, ${coscoResult.tokens} tokens`);
  console.log(`     Total:   ${cmaResult.timeMs + coscoResult.timeMs}ms, ${cmaResult.tokens + coscoResult.tokens} tokens`);

  console.log('\n\n✅ Demo complete!\n');
}

main().catch(console.error);
