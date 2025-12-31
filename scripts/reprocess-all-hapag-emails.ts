/**
 * Reprocess All Hapag-Lloyd Emails
 *
 * Re-extracts entities from ALL Hapag-Lloyd emails, not just HL-* subjects.
 * Targets emails with deadline/cutoff content in body.
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface ExtractedEntity {
  entity_type: string;
  entity_value: string;
  confidence_score: number;
}

async function extractEntitiesFromEmail(email: any): Promise<ExtractedEntity[]> {
  const content = email.body_text || '';

  // Find deadline section
  const deadlineIdx = content.toLowerCase().indexOf('deadline');
  const cutoffIdx = content.toLowerCase().indexOf('cut-off');
  const startIdx = Math.min(
    deadlineIdx >= 0 ? deadlineIdx : Infinity,
    cutoffIdx >= 0 ? cutoffIdx : Infinity
  );

  if (startIdx === Infinity) {
    return [];
  }

  const relevantSection = content.substring(Math.max(0, startIdx - 200), startIdx + 2500);

  const prompt = `Extract shipping dates and cutoffs from this email content.

Subject: ${email.subject}
Content:
${relevantSection}

Look for these patterns:
- "Shipping instruction closing" or "SI cut-off" → si_cutoff
- "VGM cut-off" → vgm_cutoff
- "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
- "Gate cut-off" → gate_cutoff
- "Estimated time of arrival" or "ETA" → eta
- "Estimated time of departure" or "ETD" → etd
- Booking numbers like "HL-XXXXXXXX" or just numbers → booking_number

Dates appear as "DD-Mon-YYYY HH:MM" (e.g., "25-Dec-2025 10:00") or in tables.

Return JSON array ONLY:
[
  {"entity_type": "booking_number", "entity_value": "12345678", "confidence_score": 95},
  {"entity_type": "si_cutoff", "entity_value": "2025-12-25T10:00:00", "confidence_score": 90},
  {"entity_type": "vgm_cutoff", "entity_value": "2025-12-26T17:00:00", "confidence_score": 90}
]

Convert dates to ISO format: YYYY-MM-DDTHH:MM:SS
Return empty array [] if nothing found.`;

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 800,
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

async function reprocessHapagEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         REPROCESS HAPAG-LLOYD EMAILS FOR ENTITIES                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get ALL Hapag-Lloyd emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .or('sender_email.ilike.%hlag%,sender_email.ilike.%hapag%')
    .order('received_at', { ascending: false });

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`Found ${emails.length} Hapag-Lloyd emails\n`);

  // Filter to those with deadline/cutoff content
  const emailsWithDeadlines = emails.filter(e => {
    const body = (e.body_text || '').toLowerCase();
    return body.includes('deadline') || body.includes('cut-off') || body.includes('cutoff');
  });

  console.log(`Emails with deadline content: ${emailsWithDeadlines.length}\n`);

  let processed = 0;
  let entitiesAdded = 0;

  for (const email of emailsWithDeadlines) {
    console.log(`[${processed + 1}/${emailsWithDeadlines.length}] ${email.subject?.substring(0, 50)}...`);

    // Check existing entities
    const { data: existingEntities } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .eq('email_id', email.id)
      .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff']);

    const hasCutoffs = existingEntities && existingEntities.length > 0;

    if (hasCutoffs) {
      console.log(`  ⏭️  Already has ${existingEntities.length} cutoffs`);
      processed++;
      continue;
    }

    // Extract entities
    console.log('  🔍 Extracting...');
    const entities = await extractEntitiesFromEmail(email);

    if (entities.length > 0) {
      // Get classification ID
      const { data: classification } = await supabase
        .from('document_classifications')
        .select('id, document_type')
        .eq('email_id', email.id)
        .limit(1)
        .single();

      if (classification) {
        const entityRecords = entities.map(e => ({
          email_id: email.id,
          classification_id: classification.id,
          entity_type: e.entity_type,
          entity_value: e.entity_value,
          confidence_score: e.confidence_score,
          extraction_method: 'ai_extraction',
          source_document_type: classification.document_type
        }));

        const { error: insertError } = await supabase
          .from('entity_extractions')
          .insert(entityRecords);

        if (!insertError) {
          const cutoffs = entities.filter(e => e.entity_type.includes('cutoff'));
          console.log(`  ✅ Extracted: ${cutoffs.length} cutoffs, ${entities.length - cutoffs.length} other`);
          entitiesAdded += entities.length;
        } else {
          console.error(`  ❌ Insert error:`, insertError.message);
        }
      }
    } else {
      console.log('  ℹ️  No entities found');
    }

    processed++;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Emails processed: ${processed}`);
  console.log(`Entities added: ${entitiesAdded}`);

  // Show updated entity counts
  const { data: entityCounts } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  if (entityCounts) {
    const counts: Record<string, number> = {};
    entityCounts.forEach(e => {
      counts[e.entity_type] = (counts[e.entity_type] || 0) + 1;
    });

    console.log('\nEntity Counts:');
    ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff'].forEach(type => {
      console.log(`  ${type}: ${counts[type] || 0}`);
    });
  }

  console.log('\n🎉 Done!\n');
}

reprocessHapagEmails().catch(console.error);
