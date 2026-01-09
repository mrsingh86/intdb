/**
 * Chronicle Demo - Single Email Test
 *
 * Tests the chronicle system with a single email to verify AI extraction.
 * Does not save to database - just shows what would be extracted.
 *
 * Usage:
 *   npx ts-node scripts/demo-chronicle-single.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import Anthropic from '@anthropic-ai/sdk';
import { analyzeShippingCommunicationSchema, ShippingAnalysis } from '../lib/chronicle/types';

// ============================================================================
// TEST DATA
// ============================================================================

const TEST_EMAIL = {
  subject: 'Re: BKG 263847291 - SOB CONFIRMATION // NHAVA SHEVA TO NEWARK // Invoice attached',
  body: `Hi Team,

Please find attached the invoice for the freight charges.

Also, kindly arrange the VGM submission by Jan 15, 2026.

Let me know if you need anything else.

Best regards,
Operations Team`,
  attachment: `
BOOKING CONFIRMATION
====================

Booking Number: 263847291
Carrier: MAERSK LINE

Shipper: INTOGLO LOGISTICS PVT LTD
Consignee: ABC CORP, NEW YORK

Port of Loading: INNSA (Nhava Sheva)
Port of Discharge: USNYC (Newark)

Vessel: EVER GIVEN
Voyage: 2601W

ETD: 2026-01-20
ETA: 2026-02-15

Container: MRKU1234567 (40HC)

VGM Cutoff: 2026-01-15
SI Cutoff: 2026-01-14

FREIGHT CHARGES
===============
Ocean Freight: USD 2,500.00
BAF: USD 150.00
Total: USD 2,650.00
`,
};

// ============================================================================
// AI ANALYSIS
// ============================================================================

async function analyzeEmail(): Promise<ShippingAnalysis> {
  const anthropic = new Anthropic();

  const prompt = `Analyze this shipping/freight email. Extract information from the correct source:

- IDENTIFIERS (booking#, BL#, HBL#, container#): Look in SUBJECT LINE first (most reliable), then body, then attachment
- DOCUMENT DETAILS (vessel, ports, dates): Look in ATTACHMENT content
- ACTIONS & SENTIMENT: Look in EMAIL BODY

=== SUBJECT LINE ===
${TEST_EMAIL.subject}

=== EMAIL BODY ===
${TEST_EMAIL.body}

=== ATTACHMENT: Booking_Confirmation.pdf ===
${TEST_EMAIL.attachment}

IMPORTANT RULES:
1. Subject line is most reliable for identifiers (booking/BL/HBL numbers)
2. Body may discuss different topic than subject (e.g., subject about booking, body asks for action)
3. Attachment may be different document than subject mentions
4. Extract dates in YYYY-MM-DD format
5. For has_action: true only if someone needs to DO something
`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-latest',
    max_tokens: 1024,
    tools: [
      {
        name: 'analyze_shipping_communication',
        description: 'Analyze shipping email for classification and extraction',
        input_schema: {
          type: 'object',
          properties: {
            booking_number: { type: 'string', nullable: true },
            mbl_number: { type: 'string', nullable: true },
            hbl_number: { type: 'string', nullable: true },
            container_numbers: { type: 'array', items: { type: 'string' } },
            identifier_source: { type: 'string', enum: ['subject', 'body', 'attachment'] },
            document_type: {
              type: 'string',
              enum: [
                'booking_confirmation', 'booking_amendment', 'shipping_instructions',
                'si_confirmation', 'draft_bl', 'final_bl', 'telex_release',
                'arrival_notice', 'delivery_order', 'invoice', 'debit_note',
                'credit_note', 'payment_receipt', 'vgm_confirmation',
                'customs_entry', 'isf_filing', 'pod_proof_of_delivery',
                'gate_pass', 'container_release', 'general_correspondence', 'unknown',
              ],
            },
            from_party: {
              type: 'string',
              enum: ['carrier', 'customer', 'broker', 'trucker', 'terminal', 'intoglo', 'unknown'],
            },
            vessel_name: { type: 'string', nullable: true },
            voyage_number: { type: 'string', nullable: true },
            port_of_loading: { type: 'string', nullable: true },
            port_of_discharge: { type: 'string', nullable: true },
            etd: { type: 'string', nullable: true },
            eta: { type: 'string', nullable: true },
            message_type: {
              type: 'string',
              enum: [
                'confirmation', 'request', 'update', 'action_required',
                'issue_reported', 'acknowledgement', 'query', 'escalation', 'general',
              ],
            },
            sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'urgent'] },
            summary: { type: 'string', maxLength: 100 },
            has_action: { type: 'boolean' },
            action_description: { type: 'string', nullable: true },
            action_owner: { type: 'string', enum: ['operations', 'customer', 'carrier', 'broker'], nullable: true },
            action_deadline: { type: 'string', nullable: true },
          },
          required: ['identifier_source', 'document_type', 'from_party', 'message_type', 'sentiment', 'summary', 'has_action'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'analyze_shipping_communication' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('No tool use in response');
  }

  return analyzeShippingCommunicationSchema.parse(toolUse.input);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('CHRONICLE DEMO - Single Email Analysis');
  console.log('='.repeat(70));

  console.log('\n📧 INPUT EMAIL:');
  console.log('-'.repeat(70));
  console.log(`Subject: ${TEST_EMAIL.subject}`);
  console.log(`\nBody:\n${TEST_EMAIL.body}`);
  console.log(`\nAttachment (excerpt):\n${TEST_EMAIL.attachment.substring(0, 500)}...`);

  console.log('\n\n🤖 AI ANALYSIS:');
  console.log('-'.repeat(70));

  const startTime = Date.now();
  const analysis = await analyzeEmail();
  const duration = Date.now() - startTime;

  console.log('\n📋 IDENTIFIERS (from subject):');
  console.log(`  Booking Number: ${analysis.booking_number || '(none)'}`);
  console.log(`  MBL Number: ${analysis.mbl_number || '(none)'}`);
  console.log(`  HBL Number: ${analysis.hbl_number || '(none)'}`);
  console.log(`  Container Numbers: ${analysis.container_numbers?.join(', ') || '(none)'}`);
  console.log(`  Source: ${analysis.identifier_source}`);

  console.log('\n📦 CLASSIFICATION:');
  console.log(`  Document Type: ${analysis.document_type}`);
  console.log(`  From Party: ${analysis.from_party}`);
  console.log(`  Message Type: ${analysis.message_type}`);
  console.log(`  Sentiment: ${analysis.sentiment}`);

  console.log('\n🚢 LOGISTICS DETAILS (from attachment):');
  console.log(`  Vessel: ${analysis.vessel_name || '(none)'}`);
  console.log(`  Voyage: ${analysis.voyage_number || '(none)'}`);
  console.log(`  POL: ${analysis.port_of_loading || '(none)'}`);
  console.log(`  POD: ${analysis.port_of_discharge || '(none)'}`);
  console.log(`  ETD: ${analysis.etd || '(none)'}`);
  console.log(`  ETA: ${analysis.eta || '(none)'}`);

  console.log('\n💡 INTELLIGENCE (from body):');
  console.log(`  Summary: ${analysis.summary}`);
  console.log(`  Has Action: ${analysis.has_action}`);
  if (analysis.has_action) {
    console.log(`  Action: ${analysis.action_description}`);
    console.log(`  Owner: ${analysis.action_owner}`);
    console.log(`  Deadline: ${analysis.action_deadline || '(not specified)'}`);
  }

  console.log('\n📊 METADATA:');
  console.log(`  Processing Time: ${duration}ms`);
  console.log(`  Estimated Cost: $${(0.001).toFixed(4)}`);

  console.log('\n' + '='.repeat(70));
  console.log('Full AI Response:');
  console.log(JSON.stringify(analysis, null, 2));
}

main().catch(console.error);
