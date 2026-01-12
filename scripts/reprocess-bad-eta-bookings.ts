/**
 * Reprocess booking confirmations with suspicious ETA data
 *
 * Finds all booking confirmations where:
 * - ETA is before ETD (impossible)
 * - Transit time < 14 days (likely transshipment date)
 *
 * Uses updated AI prompt to extract correct final destination ETA
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
    },
    required: ['pod_location', 'etd', 'eta'],
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
- The LAST leg's ETA in a multi-leg voyage table
- The ETA shown next to "Port of Discharging" or "Place of Delivery"

IGNORE these transshipment dates:
- "Pre-Carrier ETA/ETD" - this is feeder to transshipment
- "Trunk Vessel ETA/ETD" at transshipment port
- Any ETA to intermediate T/S ports (Nhava Sheva, Singapore, Colombo, Mundra, etc.)

VALIDATION:
- International ocean freight typically takes 14-45 days
- India → USA = ~30-40 days, India → Europe = ~20-30 days
- If calculated transit < 14 days = you extracted a transshipment date, find the correct one

For POD: Extract the FINAL destination port (Port of Discharge/Discharging), NOT transshipment ports.
Look at the LAST row in voyage tables for the final destination.

All dates must be YYYY-MM-DD format.`;

interface BadEtaRecord {
  gmail_message_id: string;
  booking_number: string;
  etd: string;
  eta: string;
  pod_location: string | null;
  transit_days: number;
}

async function main() {
  console.log('Finding booking confirmations with suspicious ETA data...\n');

  // Find all booking confirmations with bad ETA
  const { data: badRecords, error } = await supabase
    .from('chronicle')
    .select(`
      gmail_message_id,
      shipment_id,
      etd,
      eta,
      pod_location,
      subject,
      body_preview,
      attachments
    `)
    .eq('document_type', 'booking_confirmation')
    .not('etd', 'is', null)
    .not('eta', 'is', null)
    .not('attachments', 'is', null);

  if (error) {
    console.error('Error fetching records:', error);
    return;
  }

  // Filter to only those with suspicious transit times
  const suspiciousRecords = badRecords.filter(r => {
    const etd = new Date(r.etd);
    const eta = new Date(r.eta);
    const transitDays = Math.floor((eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24));
    return transitDays < 14;
  });

  console.log(`Found ${suspiciousRecords.length} booking confirmations with transit < 14 days\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of suspiciousRecords) {
    processed++;

    // Get booking number from shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('booking_number')
      .eq('id', record.shipment_id)
      .single();

    const bookingNumber = shipment?.booking_number || 'Unknown';

    console.log(`\n[${processed}/${suspiciousRecords.length}] Processing: ${bookingNumber}`);
    console.log(`  Current: ETD ${record.etd} → ETA ${record.eta} (${record.pod_location})`);

    // Get attachment text
    let attachmentText = '';
    if (record.attachments) {
      let attachments: any[];
      if (typeof record.attachments === 'string') {
        attachments = JSON.parse(record.attachments);
      } else {
        attachments = record.attachments as any[];
      }
      for (const a of attachments) {
        if (a.extractedText) {
          attachmentText += `\n--- ${a.filename} ---\n${a.extractedText}\n`;
        }
      }
    }

    if (attachmentText.length === 0) {
      console.log('  ⚠️ No attachment text - skipping');
      skipped++;
      continue;
    }

    // Build prompt
    const userPrompt = `${SYSTEM_PROMPT}

=== SUBJECT LINE ===
${record.subject || ''}

=== EMAIL BODY ===
${record.body_preview || ''}

=== ATTACHMENTS ===
${attachmentText.substring(0, 15000)}`; // Limit to avoid token limits

    try {
      // Run AI analysis
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1024,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: 'extract_shipping_dates' },
        messages: [{ role: 'user', content: userPrompt }],
      });

      const toolUse = response.content.find((c) => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        console.log('  ❌ No tool use in response');
        failed++;
        continue;
      }

      const analysis = toolUse.input as any;

      // Validate new extraction
      const newEtd = analysis.etd ? new Date(analysis.etd) : null;
      const newEta = analysis.eta ? new Date(analysis.eta) : null;

      if (!newEtd || !newEta) {
        console.log(`  ⚠️ Missing dates in extraction - skipping`);
        skipped++;
        continue;
      }

      const newTransitDays = Math.floor((newEta.getTime() - newEtd.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`  New: ETD ${analysis.etd} → ETA ${analysis.eta} (${analysis.pod_location}) - ${newTransitDays} days`);

      if (newTransitDays < 14) {
        console.log(`  ⚠️ Still < 14 days transit - AI couldn't find correct ETA`);
        skipped++;
        continue;
      }

      // Update chronicle record
      const { error: chronicleError } = await supabase
        .from('chronicle')
        .update({
          pod_location: analysis.pod_location,
          etd: analysis.etd,
          eta: analysis.eta,
        })
        .eq('gmail_message_id', record.gmail_message_id);

      if (chronicleError) {
        console.log(`  ❌ Chronicle update failed: ${chronicleError.message}`);
        failed++;
        continue;
      }

      // Update shipment
      if (record.shipment_id) {
        const { error: shipmentError } = await supabase
          .from('shipments')
          .update({
            port_of_discharge: analysis.pod_location,
            eta: analysis.eta,
          })
          .eq('id', record.shipment_id);

        if (shipmentError) {
          console.log(`  ⚠️ Shipment update failed: ${shipmentError.message}`);
        }
      }

      console.log(`  ✅ Updated`);
      updated++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err: any) {
      console.log(`  ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
