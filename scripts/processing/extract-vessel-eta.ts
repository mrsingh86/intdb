/**
 * Re-extract Vessel ETA from Booking Confirmations
 *
 * Focus on OCEAN VESSEL ETA (not inland/ICD dates)
 * Only update emails that:
 * 1. Have ETD but no ETA
 * 2. Are booking confirmations or arrival notices
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface VesselSchedule {
  vessel_name?: string;
  load_port?: string;
  discharge_port?: string;
  vessel_etd?: string;
  vessel_eta?: string;
  confidence: number;
}

async function extractVesselETA(email: any): Promise<VesselSchedule | null> {
  const content = email.body_text || '';
  const subject = email.subject || '';

  const prompt = `Extract OCEAN VESSEL schedule from this shipping email.

Subject: ${subject}
Email Content:
${content.substring(0, 4000)}

IMPORTANT: Extract the OCEAN VESSEL dates, NOT inland/rail dates.

Look for patterns like:
- "FromToByETDETA" table rows with "Vessel" as the transport mode
- "Vessel: [name]" followed by ETD/ETA dates
- "ETA: [port] [date]" or "[port] ETA: [date]"

RULES:
1. ONLY extract dates for OCEAN vessel legs (mode = "Vessel" or "Sea")
2. IGNORE dates for Rail, Truck, or ICD movements
3. ETD = when vessel DEPARTS from load port
4. ETA = when vessel ARRIVES at discharge port
5. Transit time should be 15-60 days for most international routes

Return JSON:
{
  "vessel_name": "vessel name or null",
  "load_port": "port of loading (sea port, not ICD)",
  "discharge_port": "port of discharge (sea port)",
  "vessel_etd": "YYYY-MM-DD or null",
  "vessel_eta": "YYYY-MM-DD or null",
  "confidence": 0-100
}

If you cannot find valid OCEAN vessel dates, return null for those fields.`;

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseContent = response.content[0];
    if (responseContent.type === 'text') {
      const jsonMatch = responseContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as VesselSchedule;

        // Validate transit time
        if (result.vessel_etd && result.vessel_eta) {
          const etd = new Date(result.vessel_etd);
          const eta = new Date(result.vessel_eta);
          const transitDays = (eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24);

          if (transitDays < 10 || transitDays > 90) {
            console.log(`    ⚠️ Invalid transit: ${transitDays.toFixed(0)} days - skipping ETA`);
            result.vessel_eta = undefined;
            result.confidence = Math.min(result.confidence, 30);
          } else {
            console.log(`    ✓ Valid transit: ${transitDays.toFixed(0)} days`);
          }
        }

        return result;
      }
    }
  } catch (error: any) {
    console.error(`  Error:`, error.message);
  }

  return null;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         RE-EXTRACT VESSEL ETA FROM BOOKING CONFIRMATIONS          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get emails that have ETD entity but no ETA entity
  const { data: etdEntities } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'etd');

  const { data: etaEntities } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'eta');

  const emailsWithEtd = new Set(etdEntities?.map(e => e.email_id) || []);
  const emailsWithEta = new Set(etaEntities?.map(e => e.email_id) || []);

  // Find emails with ETD but no ETA
  const emailsNeedingEta = [...emailsWithEtd].filter(id => !emailsWithEta.has(id));

  console.log(`Emails with ETD: ${emailsWithEtd.size}`);
  console.log(`Emails with ETA: ${emailsWithEta.size}`);
  console.log(`Emails needing ETA: ${emailsNeedingEta.length}\n`);

  if (emailsNeedingEta.length === 0) {
    console.log('No emails need ETA extraction.');
    return;
  }

  // Get email content
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .in('id', emailsNeedingEta);

  if (!emails || emails.length === 0) {
    console.log('Could not fetch emails.');
    return;
  }

  let extracted = 0;
  let failed = 0;

  for (const email of emails) {
    console.log(`\n[${extracted + failed + 1}/${emails.length}] ${email.subject?.substring(0, 60)}`);

    const schedule = await extractVesselETA(email);

    if (schedule && schedule.vessel_eta) {
      console.log(`    Vessel: ${schedule.vessel_name || '-'}`);
      console.log(`    Route: ${schedule.load_port} → ${schedule.discharge_port}`);
      console.log(`    ETD: ${schedule.vessel_etd}`);
      console.log(`    ETA: ${schedule.vessel_eta}`);
      console.log(`    Confidence: ${schedule.confidence}%`);

      // Insert ETA entity
      const { error: insertError } = await supabase
        .from('entity_extractions')
        .insert({
          email_id: email.id,
          entity_type: 'eta',
          entity_value: schedule.vessel_eta,
          confidence_score: schedule.confidence,
          extraction_method: 'claude-haiku-vessel-eta-v2',
          is_verified: false
        });

      if (insertError) {
        console.log(`    ❌ Insert failed: ${insertError.message}`);
        failed++;
      } else {
        console.log(`    ✓ ETA entity created`);
        extracted++;

        // Also update the shipment if there's one linked
        const { data: existingShipments } = await supabase
          .from('shipments')
          .select('id, booking_number')
          .eq('created_from_email_id', email.id);

        if (existingShipments && existingShipments.length > 0) {
          for (const shipment of existingShipments) {
            await supabase
              .from('shipments')
              .update({ eta: schedule.vessel_eta })
              .eq('id', shipment.id);
            console.log(`    ✓ Updated shipment ${shipment.booking_number}`);
          }
        }
      }
    } else {
      console.log(`    No valid vessel ETA found`);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 600));
  }

  console.log('\n════════════════════════════════════════════════════');
  console.log(`✅ ETA extracted: ${extracted}`);
  console.log(`⏭️ Skipped/failed: ${failed}`);
}

main().catch(console.error);
