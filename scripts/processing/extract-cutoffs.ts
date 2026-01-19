/**
 * Extract Cutoff Dates from Emails
 *
 * Re-processes emails that have deadline information in their body
 * to extract SI, VGM, Cargo, and Gate cutoff dates.
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface CutoffEntity {
  entity_type: string;
  entity_value: string;
  confidence_score: number;
}

async function extractCutoffsFromEmail(email: any): Promise<CutoffEntity[]> {
  const content = email.body_text || '';

  // Find deadline section
  const deadlineIdx = content.toLowerCase().indexOf('deadline');
  if (deadlineIdx === -1) {
    return [];
  }

  const deadlineSection = content.substring(deadlineIdx, deadlineIdx + 2000);

  const prompt = `Extract shipping cutoff/deadline dates from this content.

Deadline Section:
${deadlineSection}

Look for these specific patterns and extract dates:
- "Shipping instruction closing" or "SI cut-off" → si_cutoff
- "VGM cut-off" → vgm_cutoff
- "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
- "Gate cut-off" or "Gate closing" → gate_cutoff
- "Estimated time of arrival" → eta
- "Estimated time of departure" → etd

Dates appear as "DD-Mon-YYYY HH:MM" (e.g., "25-Dec-2025 10:00")

Return JSON array of cutoff entities ONLY:
[
  {"entity_type": "si_cutoff", "entity_value": "2025-12-25T10:00:00", "confidence_score": 95},
  {"entity_type": "vgm_cutoff", "entity_value": "2025-12-26T17:00:00", "confidence_score": 95}
]

Convert dates to ISO format: YYYY-MM-DDTHH:MM:SS
Return empty array [] if no cutoffs found.`;

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseContent = response.content[0];
    if (responseContent.type === 'text') {
      const jsonMatch = responseContent.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  } catch (error: any) {
    console.error(`  Error extracting:`, error.message);
  }

  return [];
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         EXTRACT CUTOFF DATES FROM EMAILS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Find emails with deadline content
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .ilike('body_text', '%deadline%')
    .order('received_at', { ascending: false });

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`Found ${emails.length} emails with deadline content\n`);

  let processed = 0;
  let entitiesExtracted = 0;

  for (const email of emails) {
    console.log(`[${processed + 1}/${emails.length}] ${email.subject?.substring(0, 50)}...`);

    // Get classification for this email (use first one if multiple exist)
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('id')
      .eq('email_id', email.id)
      .limit(1);

    const classification = classifications?.[0];
    if (!classification) {
      console.log('  ⏭️  No classification found - skipping');
      processed++;
      continue;
    }

    // Check if cutoffs already extracted
    const { data: existingCutoffs } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .eq('email_id', email.id)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff']);

    if (existingCutoffs && existingCutoffs.length > 0) {
      console.log(`  ⏭️  Cutoffs already extracted (${existingCutoffs.length})`);
      processed++;
      continue;
    }

    // Extract cutoffs
    console.log('  🔍 Extracting cutoffs...');
    const cutoffs = await extractCutoffsFromEmail(email);

    if (cutoffs.length > 0) {
      const entityRecords = cutoffs.map(c => ({
        email_id: email.id,
        classification_id: classification.id,
        entity_type: c.entity_type,
        entity_value: c.entity_value,
        confidence_score: c.confidence_score,
        extraction_method: 'ai_extraction'
      }));

      const { error: insertError } = await supabase
        .from('entity_extractions')
        .insert(entityRecords);

      if (!insertError) {
        console.log(`  ✅ Extracted ${cutoffs.length} cutoffs: ${cutoffs.map(c => c.entity_type).join(', ')}`);
        entitiesExtracted += cutoffs.length;
      } else {
        console.error(`  ❌ Insert error:`, insertError.message);
      }
    } else {
      console.log('  ℹ️  No cutoffs found');
    }

    processed++;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Emails processed:       ${processed}`);
  console.log(`✅ Cutoffs extracted:      ${entitiesExtracted}`);
  console.log('\n🎉 Done! Run shipment resync to update shipments with cutoff dates.\n');
}

main().catch(console.error);
