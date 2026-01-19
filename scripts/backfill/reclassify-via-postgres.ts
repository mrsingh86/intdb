/**
 * RECLASSIFY ALL EMAILS - Direct PostgreSQL Connection
 *
 * Bypasses Supabase API to work around schema cache issues
 * Re-runs classification on all emails and tracks changes
 */

import { Client } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

// Direct PostgreSQL connection
const DATABASE_PASSWORD = process.env.DATABASE_PASSWORD || 'OMomSairam@123';
const connectionString = `postgresql://postgres.jkvlggqkccozyouvipso:${DATABASE_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

interface ClassificationResult {
  document_type: string;
  confidence_score: number;
  classification_reason: string;
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

async function extractEntities(email: any): Promise<any[]> {
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

async function main() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║         RECLASSIFY ALL EMAILS - UPDATE EXISTING                    ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

    // Get all emails
    const result = await client.query('SELECT * FROM raw_emails ORDER BY received_at DESC');
    console.log(`📧 Found ${result.rows.length} emails to reclassify\n`);

    let processed = 0;
    let updated = 0;
    let unchanged = 0;
    let newClassifications = 0;
    let changes: Array<{email: string; old: string; new: string}> = [];

    for (const email of result.rows) {
      try {
        console.log(`\n[${processed + 1}/${result.rows.length}] ${email.subject.substring(0, 60)}`);

        // Get existing classification
        const existingResult = await client.query(
          'SELECT id, document_type, confidence_score FROM document_classifications WHERE email_id = $1',
          [email.id]
        );

        // Classify
        console.log('  🤖 Reclassifying...');
        const classification = await classifyEmail(email);

        const oldType = existingResult.rows[0]?.document_type || 'none';
        const newType = classification.document_type;

        if (existingResult.rows.length > 0) {
          const existingId = existingResult.rows[0].id;

          // Update existing classification
          await client.query(
            `UPDATE document_classifications
             SET document_type = $1,
                 confidence_score = $2,
                 classification_reason = $3,
                 model_name = $4,
                 model_version = $5,
                 classified_at = NOW()
             WHERE id = $6`,
            [
              classification.document_type,
              classification.confidence_score,
              classification.classification_reason,
              HAIKU_MODEL,
              '2024-10-22',
              existingId
            ]
          );

          if (oldType !== newType) {
            console.log(`  ✅ CHANGED: ${oldType} → ${newType} (${classification.confidence_score}%)`);
            changes.push({
              email: email.subject.substring(0, 50),
              old: oldType,
              new: newType
            });
            updated++;
          } else {
            console.log(`  ℹ️  UNCHANGED: ${newType} (${classification.confidence_score}%)`);
            unchanged++;
          }

          // Delete old entities
          await client.query(
            'DELETE FROM entity_extractions WHERE classification_id = $1',
            [existingId]
          );

          // Extract new entities
          console.log('  🔍 Extracting entities...');
          const entities = await extractEntities(email);

          if (entities.length > 0) {
            for (const entity of entities) {
              await client.query(
                `INSERT INTO entity_extractions
                 (email_id, classification_id, entity_type, entity_value, confidence_score, extraction_method)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  email.id,
                  existingId,
                  entity.entity_type,
                  entity.entity_value,
                  entity.confidence_score,
                  'ai_extraction'
                ]
              );
            }
            console.log(`  ✅ Extracted ${entities.length} entities`);
          } else {
            console.log('  ℹ️  No entities found');
          }

        } else {
          // No existing classification - create new
          const insertResult = await client.query(
            `INSERT INTO document_classifications
             (email_id, document_type, confidence_score, model_name, model_version, classification_reason)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
              email.id,
              classification.document_type,
              classification.confidence_score,
              HAIKU_MODEL,
              '2024-10-22',
              classification.classification_reason
            ]
          );

          const newId = insertResult.rows[0].id;
          console.log(`  ✅ NEW: ${classification.document_type} (${classification.confidence_score}%)`);
          newClassifications++;

          // Extract entities
          const entities = await extractEntities(email);
          if (entities.length > 0) {
            for (const entity of entities) {
              await client.query(
                `INSERT INTO entity_extractions
                 (email_id, classification_id, entity_type, entity_value, confidence_score, extraction_method)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  email.id,
                  newId,
                  entity.entity_type,
                  entity.entity_value,
                  entity.confidence_score,
                  'ai_extraction'
                ]
              );
            }
            console.log(`  ✅ Extracted ${entities.length} entities`);
          }
        }

        processed++;

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error: any) {
        console.error(`  ❌ Error: ${error.message}`);
        processed++;
      }
    }

    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                         SUMMARY                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    console.log(`✅ Emails processed:        ${processed}`);
    console.log(`✅ Classifications changed: ${updated}`);
    console.log(`✅ New classifications:     ${newClassifications}`);
    console.log(`ℹ️  Unchanged:              ${unchanged}`);

    if (changes.length > 0) {
      console.log('\n╔════════════════════════════════════════════════════════════════════╗');
      console.log('║                  CLASSIFICATION CHANGES                            ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
      changes.forEach(c => {
        console.log(`📧 ${c.email}`);
        console.log(`   ${c.old} → ${c.new}\n`);
      });
    }

    console.log('\n🎉 Reclassification complete!\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
