/**
 * Fix ETD/ETA Extraction
 *
 * Problem: AI is confusing:
 * - Cargo cutoff dates with ETD
 * - ICD arrival dates with ETA
 * - Vessel ETD/ETA are getting wrong values
 *
 * Solution: Re-extract with clearer prompts that distinguish:
 * - VESSEL ETD: When the ocean vessel departs from the LOAD PORT
 * - VESSEL ETA: When the ocean vessel arrives at the DISCHARGE PORT
 * - Ignore inland/ICD dates for ETD/ETA (those are cargo cutoffs)
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface VesselDateExtraction {
  vessel_name?: string;
  voyage_number?: string;
  load_port?: string;
  discharge_port?: string;
  vessel_etd?: string;  // When vessel leaves load port
  vessel_eta?: string;  // When vessel arrives at discharge port
  confidence: number;
}

async function extractVesselDates(email: any): Promise<VesselDateExtraction | null> {
  const content = email.body_text || '';

  // Look for vessel/schedule sections
  const vesselIdx = content.toLowerCase().indexOf('vessel');
  const scheduleIdx = content.toLowerCase().indexOf('schedule');
  const voyageIdx = content.toLowerCase().indexOf('voyage');

  const relevantSection = content.substring(0, 5000);

  const prompt = `Extract VESSEL SCHEDULE information from this shipping email.

Subject: ${email.subject}
Content:
${relevantSection}

IMPORTANT DEFINITIONS:
- VESSEL ETD (Estimated Time of Departure): The date/time when the OCEAN VESSEL departs from the LOAD PORT
- VESSEL ETA (Estimated Time of Arrival): The date/time when the OCEAN VESSEL arrives at the DISCHARGE PORT

DO NOT extract these as ETD/ETA:
- Cargo cutoff dates (when cargo must be delivered to port)
- ICD/Inland depot arrival dates
- Container stuffing dates
- Gate cut-off dates

VALIDATION RULES:
1. ETA must be AFTER ETD (ocean transit takes 15-60 days typically)
2. ETD is when the ship LEAVES the origin port
3. ETA is when the ship ARRIVES at the destination port

Look for patterns like:
- "ETD: [port name] [date]" or "Departs [port] on [date]"
- "ETA: [port name] [date]" or "Arrives [port] on [date]"
- Vessel schedule tables with departure/arrival times

Return JSON:
{
  "vessel_name": "VESSEL NAME or null",
  "voyage_number": "VOYAGE NUMBER or null",
  "load_port": "PORT NAME (not ICD/inland depot)",
  "discharge_port": "DESTINATION PORT NAME",
  "vessel_etd": "YYYY-MM-DDTHH:MM:SS or null",
  "vessel_eta": "YYYY-MM-DDTHH:MM:SS or null",
  "confidence": 0-100
}

If dates don't make sense (ETA before ETD), return null for those fields.
If you can only find ICD/inland dates (not ocean vessel dates), return null for ETD/ETA.`;

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
        const result = JSON.parse(jsonMatch[0]) as VesselDateExtraction;

        // Validate: ETA must be after ETD
        if (result.vessel_etd && result.vessel_eta) {
          const etd = new Date(result.vessel_etd);
          const eta = new Date(result.vessel_eta);
          const transitDays = (eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24);

          // If transit is negative or less than 3 days, data is invalid
          if (transitDays < 3) {
            console.log(`    ⚠️ Invalid transit time: ${transitDays.toFixed(1)} days - clearing ETA`);
            result.vessel_eta = undefined;
            result.confidence = Math.min(result.confidence, 30);
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

async function fixETDETA() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         FIX ETD/ETA EXTRACTION WITH BETTER PROMPTS               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get emails that have etd or eta entities
  const { data: entitiesWithDates } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .in('entity_type', ['etd', 'eta'])
    .limit(500);

  const emailIds = [...new Set(entitiesWithDates?.map(e => e.email_id) || [])];
  console.log(`Found ${emailIds.length} emails with ETD/ETA entities\n`);

  // Get those emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .in('id', emailIds);

  if (error || !emails) {
    console.error('Error:', error);
    return;
  }

  let processed = 0;
  let fixed = 0;
  let cleared = 0;

  for (const email of emails) {
    console.log(`\n[${processed + 1}/${emails.length}] ${email.subject?.substring(0, 60)}`);

    // Get current ETD/ETA values
    const { data: currentEntities } = await supabase
      .from('entity_extractions')
      .select('id, entity_type, entity_value')
      .eq('email_id', email.id)
      .in('entity_type', ['etd', 'eta']);

    const currentETD = currentEntities?.find(e => e.entity_type === 'etd');
    const currentETA = currentEntities?.find(e => e.entity_type === 'eta');

    if (currentETD) console.log(`  Current ETD: ${currentETD.entity_value}`);
    if (currentETA) console.log(`  Current ETA: ${currentETA.entity_value}`);

    // Check current validity
    if (currentETD && currentETA) {
      const etd = new Date(currentETD.entity_value);
      const eta = new Date(currentETA.entity_value);
      const transitDays = (eta.getTime() - etd.getTime()) / (1000 * 60 * 60 * 24);
      console.log(`  Transit: ${transitDays.toFixed(1)} days`);

      if (transitDays < 3) {
        console.log(`  ⚠️ Invalid - re-extracting...`);

        const newData = await extractVesselDates(email);

        if (newData) {
          console.log(`  New extraction:`);
          console.log(`    Vessel: ${newData.vessel_name || '-'}`);
          console.log(`    Load Port: ${newData.load_port || '-'}`);
          console.log(`    Discharge Port: ${newData.discharge_port || '-'}`);
          console.log(`    ETD: ${newData.vessel_etd || 'CLEARED'}`);
          console.log(`    ETA: ${newData.vessel_eta || 'CLEARED'}`);
          console.log(`    Confidence: ${newData.confidence}%`);

          // Update or delete entities
          if (newData.vessel_etd && currentETD) {
            await supabase
              .from('entity_extractions')
              .update({ entity_value: newData.vessel_etd })
              .eq('id', currentETD.id);
            fixed++;
          } else if (currentETD && !newData.vessel_etd) {
            // Delete invalid ETD
            await supabase
              .from('entity_extractions')
              .delete()
              .eq('id', currentETD.id);
            cleared++;
          }

          if (newData.vessel_eta && currentETA) {
            await supabase
              .from('entity_extractions')
              .update({ entity_value: newData.vessel_eta })
              .eq('id', currentETA.id);
            fixed++;
          } else if (currentETA && !newData.vessel_eta) {
            // Delete invalid ETA
            await supabase
              .from('entity_extractions')
              .delete()
              .eq('id', currentETA.id);
            cleared++;
          }
        } else {
          // Couldn't extract valid dates - clear both
          console.log(`  ❌ No valid vessel dates found - clearing`);
          if (currentETD) {
            await supabase.from('entity_extractions').delete().eq('id', currentETD.id);
            cleared++;
          }
          if (currentETA) {
            await supabase.from('entity_extractions').delete().eq('id', currentETA.id);
            cleared++;
          }
        }
      } else {
        console.log(`  ✓ Valid transit time`);
      }
    }

    processed++;

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n════════════════════════════════════════════════════');
  console.log(`✅ Processed: ${processed}`);
  console.log(`🔧 Fixed: ${fixed}`);
  console.log(`🗑️ Cleared: ${cleared}`);
}

// Run
fixETDETA().catch(console.error);
