/**
 * Classify emails using direct PostgreSQL connection
 * Bypasses Supabase API cache issues
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
const connectionString = `postgresql://postgres.jkvlggqkccozyouvipso:${process.env.SUPABASE_SERVICE_ROLE_KEY?.split('.')[2] || 'tPe-CS4zRZSksZa_PAIOAsMOYLiNCT7eon3crO_LgKY'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

async function classifyEmail(email: any) {
  const prompt = `Classify this shipping/logistics email:

Subject: ${email.subject}
From: ${email.sender_email}

Classify as: booking_confirmation, booking_amendment, bill_of_lading, arrival_notice, customs_document, detention_notice, invoice, or other

Return JSON: {"document_type": "type", "confidence_score": 85, "classification_reason": "reason"}`;

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
    classification_reason: 'Failed to parse'
  };
}

async function main() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    // Get all emails
    const result = await client.query('SELECT * FROM raw_emails ORDER BY received_at DESC');
    console.log(`📧 Found ${result.rows.length} emails\n`);

    let processed = 0;
    let classified = 0;

    for (const email of result.rows) {
      try {
        // Check if already classified
        const existingResult = await client.query(
          'SELECT id FROM document_classifications WHERE email_id = $1',
          [email.id]
        );

        if (existingResult.rows.length > 0) {
          console.log(`[${processed + 1}/${result.rows.length}] ⏭️  Already classified: ${email.subject}`);
          processed++;
          continue;
        }

        console.log(`[${processed + 1}/${result.rows.length}] 🤖 Classifying: ${email.subject}`);

        // Classify
        const classification = await classifyEmail(email);

        // Insert classification
        await client.query(
          `INSERT INTO document_classifications
           (email_id, document_type, confidence_score, model_name, model_version, classification_reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            email.id,
            classification.document_type,
            classification.confidence_score,
            HAIKU_MODEL,
            '2024-10-22',
            classification.classification_reason
          ]
        );

        console.log(`   ✅ ${classification.document_type} (${classification.confidence_score}%)\n`);
        classified++;
        processed++;

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error: any) {
        console.error(`   ❌ Error: ${error.message}\n`);
        processed++;
      }
    }

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║           SUMMARY                      ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`✅ Processed: ${processed}`);
    console.log(`✅ Classified: ${classified}\n`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
