/**
 * Reprocess two emails with updated AI prompt
 * Uses data already stored in chronicle table
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const anthropic = new Anthropic();

// The two emails to reprocess
const EMAILS_TO_REPROCESS = [
  { gmailMessageId: '19ba2a325ce913a1', bookingNumber: '37860708' },
  { gmailMessageId: '19b9c27b9d84352e', bookingNumber: 'BRDG00217900' },
];

// Simplified tool schema for ETA/ETD extraction
const TOOL_SCHEMA: Anthropic.Tool = {
  name: 'extract_shipping_dates',
  description: 'Extract shipping dates and port information',
  input_schema: {
    type: 'object' as const,
    properties: {
      pod_location: { type: 'string', description: 'Port of Discharge (FINAL DESTINATION) - UN/LOCODE' },
      etd: { type: 'string', description: 'ETD from Port of Loading YYYY-MM-DD' },
      eta: { type: 'string', description: 'ETA at FINAL DESTINATION (POD) YYYY-MM-DD - look for POD ETA, DEL ETA' },
      document_type: { type: 'string', description: 'Document type' },
    },
    required: ['pod_location', 'etd', 'eta', 'document_type'],
  },
};

const SYSTEM_PROMPT = `You are an experienced freight forwarder analyzing shipping documents.

CRITICAL RULES FOR MULTI-LEG VOYAGES:

Many shipments have multiple legs with transshipment:
- Pre-Carrier (Feeder): POL → Transshipment Port
- Trunk Vessel (Mother): Transshipment → Another TS or POD
- Post-Carrier: Last TS → Final POD

ALWAYS extract dates for FINAL DESTINATION, not transshipment ports:

For ETD: Extract the departure date from Port of Loading (POL) - the FIRST vessel departure

For ETA: Look for these labels for FINAL DESTINATION arrival:
- "POD ETA", "POD / DEL ETA", "Delivery ETA", "Destination ETA"
- "Final ETA", "ETA at POD"
- The ETA shown next to "Port of Discharging" or "Place of Delivery"

IGNORE these transshipment dates:
- "Pre-Carrier ETA/ETD" - this is feeder to transshipment
- "Trunk Vessel ETA/ETD" at transshipment port
- Any ETA to intermediate T/S ports (Nhava Sheva, Singapore, Colombo, etc.)

VALIDATION:
- International ocean freight typically takes 14-45 days
- India → USA = ~30-40 days, India → Europe = ~20-30 days
- If calculated transit < 14 days = you extracted a transshipment date, find the correct one

For POD: Extract the FINAL destination port (Port of Discharge/Discharging), NOT transshipment ports.

All dates must be YYYY-MM-DD format.`;

async function main() {
  for (const email of EMAILS_TO_REPROCESS) {
    console.log('\n' + '═'.repeat(70));
    console.log(`Reprocessing: ${email.bookingNumber}`);
    console.log('═'.repeat(70));

    // Get current chronicle record (has all the data we need)
    const { data: chronicle } = await supabase
      .from('chronicle')
      .select('*')
      .eq('gmail_message_id', email.gmailMessageId)
      .single();

    if (!chronicle) {
      console.log('Chronicle record not found');
      continue;
    }

    console.log('\n--- BEFORE ---');
    console.log('POD:', chronicle.pod_location);
    console.log('ETD:', chronicle.etd);
    console.log('ETA:', chronicle.eta);

    // Get attachment text from chronicle.attachments (stored as JSON string or array)
    let attachmentText = '';
    if (chronicle.attachments) {
      let attachments: any[];
      if (typeof chronicle.attachments === 'string') {
        attachments = JSON.parse(chronicle.attachments);
      } else {
        attachments = chronicle.attachments as any[];
      }
      for (const a of attachments) {
        if (a.extractedText) {
          attachmentText += `\n--- ${a.filename} ---\n${a.extractedText}\n`;
        }
      }
    }

    console.log('\nAttachment text length:', attachmentText.length);

    if (attachmentText.length === 0) {
      console.log('⚠️ No attachment text found - skipping');
      continue;
    }

    // Build prompt
    const userPrompt = `${SYSTEM_PROMPT}

=== SUBJECT LINE ===
${chronicle.subject || ''}

=== EMAIL BODY ===
${chronicle.body_preview || ''}

=== ATTACHMENTS ===
${attachmentText}`;

    // Run AI analysis
    console.log('\nRunning AI analysis with updated prompt...');
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 2048,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'extract_shipping_dates' },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      console.log('No tool use in AI response');
      continue;
    }

    const analysis = toolUse.input as any;

    console.log('\n--- AFTER (New Extraction) ---');
    console.log('POD:', analysis.pod_location);
    console.log('ETD:', analysis.etd);
    console.log('ETA:', analysis.eta);
    console.log('Document Type:', analysis.document_type);

    // Update chronicle record
    const { error: chronicleError } = await supabase
      .from('chronicle')
      .update({
        pod_location: analysis.pod_location,
        etd: analysis.etd,
        eta: analysis.eta,
      })
      .eq('gmail_message_id', email.gmailMessageId);

    if (chronicleError) {
      console.log('Error updating chronicle:', chronicleError);
      continue;
    }

    console.log('✅ Chronicle updated');

    // Update shipment if ETA is valid (transit >= 14 days)
    const etd = analysis.etd ? new Date(analysis.etd) : null;
    const eta = analysis.eta ? new Date(analysis.eta) : null;

    if (etd && eta) {
      const transitDays = Math.floor((eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24));
      console.log('\nTransit days:', transitDays);

      if (transitDays >= 14) {
        console.log('✅ Valid transit time - updating shipment');

        const { error: shipmentError } = await supabase
          .from('shipments')
          .update({
            port_of_discharge: analysis.pod_location,
            eta: analysis.eta,
          })
          .eq('booking_number', email.bookingNumber);

        if (shipmentError) {
          console.log('Error updating shipment:', shipmentError);
        } else {
          console.log('✅ Shipment updated');
        }
      } else {
        console.log('⚠️ Transit time < 14 days - not updating shipment ETA');
      }
    } else {
      console.log('\n⚠️ Missing ETD or ETA - cannot validate transit time');
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('Done!');
}

main().catch(console.error);
