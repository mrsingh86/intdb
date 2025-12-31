/**
 * Re-extract Vessel ETA using API endpoints
 */

import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
const API_BASE = 'http://localhost:3000';

async function extractVesselETA(email: any): Promise<any> {
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
- Dates in format DD-MMM-YYYY like "31-Jan-2026"

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
        return JSON.parse(jsonMatch[0]);
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

  // Fetch emails via API
  const response = await fetch(`${API_BASE}/api/emails?limit=100`);
  const data = await response.json();

  if (!data.emails) {
    console.log('Failed to fetch emails');
    return;
  }

  // Find emails with ETD but no ETA
  const emailsNeedingEta = data.emails.filter((e: any) => {
    const hasEtd = (e.entities || []).some((ent: any) => ent.entity_type === 'etd');
    const hasEta = (e.entities || []).some((ent: any) => ent.entity_type === 'eta');
    return hasEtd && !hasEta;
  });

  console.log(`Total emails: ${data.emails.length}`);
  console.log(`Emails with ETD but no ETA: ${emailsNeedingEta.length}\n`);

  if (emailsNeedingEta.length === 0) {
    console.log('No emails need ETA extraction.');
    return;
  }

  let extracted = 0;
  let failed = 0;

  for (const email of emailsNeedingEta) {
    console.log(`\n[${extracted + failed + 1}/${emailsNeedingEta.length}] ${email.subject?.substring(0, 60)}`);

    // Get current ETD
    const currentEtd = (email.entities || []).find((e: any) => e.entity_type === 'etd');
    console.log(`  Current ETD: ${currentEtd?.entity_value || '-'}`);

    const schedule = await extractVesselETA(email);

    if (schedule && schedule.vessel_eta) {
      // Validate transit time
      if (schedule.vessel_etd) {
        const etd = new Date(schedule.vessel_etd);
        const eta = new Date(schedule.vessel_eta);
        const transitDays = (eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24);

        console.log(`  Extracted: ETD=${schedule.vessel_etd}, ETA=${schedule.vessel_eta}`);
        console.log(`  Transit: ${transitDays.toFixed(0)} days`);

        if (transitDays < 10 || transitDays > 90) {
          console.log(`  ⚠️ Invalid transit time - skipping`);
          failed++;
          continue;
        }
      }

      console.log(`  Vessel: ${schedule.vessel_name || '-'}`);
      console.log(`  Route: ${schedule.load_port} → ${schedule.discharge_port}`);
      console.log(`  Confidence: ${schedule.confidence}%`);

      // Create ETA entity directly in database
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

      if (!insertError) {
        console.log(`  ✓ ETA entity created`);
        extracted++;

        // Also update linked shipment
        const { data: shipments } = await supabase
          .from('shipments')
          .select('id, booking_number')
          .eq('created_from_email_id', email.id);

        if (shipments && shipments.length > 0) {
          for (const shipment of shipments) {
            await supabase
              .from('shipments')
              .update({ eta: schedule.vessel_eta })
              .eq('id', shipment.id);
            console.log(`  ✓ Updated shipment ${shipment.booking_number}`);
          }
        }
      } else {
        console.log(`  ❌ Failed: ${insertError.message}`);
        failed++;
      }
    } else {
      console.log(`  No valid vessel ETA found`);
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
