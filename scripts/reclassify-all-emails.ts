/**
 * RECLASSIFY ALL EMAILS
 *
 * Re-runs classification on all emails with updated logic
 * Updates existing classifications and tracks changes
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface ClassificationResult {
  document_type: string;
  confidence_score: number;
  classification_reason: string;
}

interface EntityResult {
  entity_type: string;
  entity_value: string;
  confidence_score: number;
}

async function classifyEmail(email: any): Promise<ClassificationResult> {
  const prompt = `Classify this shipping/logistics email:

Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text?.substring(0, 1000) || email.snippet || 'No content'}

Classify as one of:
- booking_confirmation: Booking confirmation from shipping line
- booking_amendment: Changes to existing booking
- shipping_instruction: SI/VGM submission
- bill_of_lading: BL issuance or amendment
- arrival_notice: Container arrival notification
- delivery_order: DO issuance
- customs_document: Customs clearance documents
- detention_notice: Container detention/demurrage
- invoice: Freight or service invoice
- other: Other document types

Return JSON only:
{
  "document_type": "type",
  "confidence_score": 85,
  "classification_reason": "brief reason"
}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0];
  if (content.type === 'text') {
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  }

  return {
    document_type: 'other',
    confidence_score: 50,
    classification_reason: 'Failed to parse response'
  };
}

async function extractEntities(email: any, classification: ClassificationResult): Promise<EntityResult[]> {
  const content = email.body_text || email.snippet || '';

  const prompt = `Extract shipping entities from this email:

Subject: ${email.subject}
Content: ${content.substring(0, 1500)}

Extract and return JSON array of entities:
[
  {"entity_type": "booking_number", "entity_value": "ABC123", "confidence_score": 95},
  {"entity_type": "container_number", "entity_value": "MAEU1234567", "confidence_score": 90}
]

Entity types: booking_number, bl_number, container_number, vessel_name, port_of_loading, port_of_discharge, etd, eta

Return empty array [] if no entities found.`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1000,
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

  return [];
}

async function reclassifyAllEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         RECLASSIFY ALL EMAILS - UPDATE EXISTING                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Fetch all emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('*')
    .order('received_at', { ascending: false });

  if (error || !emails) {
    console.error('❌ Error fetching emails:', error);
    return;
  }

  console.log(`📧 Found ${emails.length} emails to reclassify\n`);

  let processed = 0;
  let updated = 0;
  let unchanged = 0;
  let changes: Array<{email: string; old: string; new: string}> = [];

  for (const email of emails) {
    try {
      console.log(`\n[${processed + 1}/${emails.length}] Processing: ${email.subject}`);

      // Get existing classification
      const { data: existing } = await supabase
        .from('document_classifications')
        .select('id, document_type, confidence_score')
        .eq('email_id', email.id)
        .single();

      // Classify
      console.log('  🤖 Reclassifying...');
      const classification = await classifyEmail(email);

      const oldType = existing?.document_type || 'none';
      const newType = classification.document_type;

      if (existing) {
        // Update existing classification
        const { error: updateError } = await supabase
          .from('document_classifications')
          .update({
            document_type: classification.document_type,
            confidence_score: classification.confidence_score,
            classification_reason: classification.classification_reason,
            model_name: HAIKU_MODEL,
            model_version: '2024-10-22',
            classified_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (updateError) {
          console.error('  ❌ Update failed:', updateError.message);
          processed++;
          continue;
        }

        if (oldType !== newType) {
          console.log(`  ✅ CHANGED: ${oldType} → ${newType} (${classification.confidence_score}%)`);
          changes.push({ email: email.subject, old: oldType, new: newType });
          updated++;
        } else {
          console.log(`  ℹ️  UNCHANGED: ${newType} (${classification.confidence_score}%)`);
          unchanged++;
        }

        // Delete old entities
        await supabase
          .from('entity_extractions')
          .delete()
          .eq('classification_id', existing.id);

        // Extract and save new entities
        console.log('  🔍 Extracting entities...');
        const entities = await extractEntities(email, classification);

        if (entities.length > 0) {
          const entityRecords = entities.map(e => ({
            email_id: email.id,
            classification_id: existing.id,
            entity_type: e.entity_type,
            entity_value: e.entity_value,
            confidence_score: e.confidence_score,
            extraction_method: 'ai_extraction'
          }));

          await supabase
            .from('entity_extractions')
            .insert(entityRecords);

          console.log(`  ✅ Extracted ${entities.length} entities`);
        } else {
          console.log('  ℹ️  No entities found');
        }

      } else {
        // No existing classification - create new one
        const { data: classRecord, error: classError } = await supabase
          .from('document_classifications')
          .insert({
            email_id: email.id,
            document_type: classification.document_type,
            confidence_score: classification.confidence_score,
            model_name: HAIKU_MODEL,
            model_version: '2024-10-22',
            classification_reason: classification.classification_reason
          })
          .select()
          .single();

        if (!classError && classRecord) {
          console.log(`  ✅ NEW: ${classification.document_type} (${classification.confidence_score}%)`);
          updated++;

          const entities = await extractEntities(email, classification);
          if (entities.length > 0) {
            const entityRecords = entities.map(e => ({
              email_id: email.id,
              classification_id: classRecord.id,
              entity_type: e.entity_type,
              entity_value: e.entity_value,
              confidence_score: e.confidence_score,
              extraction_method: 'ai_extraction'
            }));

            await supabase
              .from('entity_extractions')
              .insert(entityRecords);

            console.log(`  ✅ Extracted ${entities.length} entities`);
          }
        }
      }

      processed++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`  ❌ Error:`, error.message);
      processed++;
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Emails processed:       ${processed}`);
  console.log(`✅ Classifications changed: ${updated}`);
  console.log(`ℹ️  Unchanged:              ${unchanged}`);

  if (changes.length > 0) {
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                  CLASSIFICATION CHANGES                            ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    changes.forEach(c => {
      console.log(`📧 ${c.email.substring(0, 50)}`);
      console.log(`   ${c.old} → ${c.new}\n`);
    });
  }

  console.log('\n🎉 Reclassification complete!\n');
}

reclassifyAllEmails().catch(console.error);
