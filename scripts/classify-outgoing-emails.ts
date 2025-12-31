/**
 * Classify Unprocessed Outgoing Emails
 * Run AI classification and entity extraction on outgoing emails
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

async function classifyOutgoingEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    CLASSIFYING UNPROCESSED OUTGOING EMAILS                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch outgoing emails without classification
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      body_text,
      snippet,
      document_classifications (id)
    `)
    .ilike('sender_email', '%@intoglo.com%')
    .order('received_at', { ascending: false })
    .limit(15);

  if (!emails || emails.length === 0) {
    console.log('No outgoing emails found\n');
    return;
  }

  // Filter to unclassified only
  const unclassified = emails.filter(e =>
    !e.document_classifications || e.document_classifications.length === 0
  );

  console.log(`Found ${unclassified.length} unclassified outgoing emails\n`);

  let processed = 0;
  let failed = 0;

  for (const email of unclassified) {
    try {
      console.log(`\n${'─'.repeat(100)}`);
      console.log(`Processing: ${email.subject?.substring(0, 70)}...`);
      console.log(`Email ID: ${email.id}`);

      // Step 1: Classify
      const classification = await classifyEmail(email);

      if (classification) {
        console.log(`✅ Classified as: ${classification.document_type} (${classification.confidence_score}% confidence)`);

        // Save classification
        await supabase.from('document_classifications').insert({
          email_id: email.id,
          document_type: classification.document_type,
          confidence_score: classification.confidence_score,
          model_name: 'claude-3-5-haiku',
          model_version: '20241022',
          classification_reason: classification.reasoning,
          matched_patterns: {
            input_tokens: classification.input_tokens,
            output_tokens: classification.output_tokens,
            processing_time_ms: classification.processing_time_ms
          }
        });

        // Step 2: Extract entities if confidence is high enough
        if (classification.confidence_score >= 50) {
          const entities = await extractEntities(email);

          if (entities.length > 0) {
            console.log(`📊 Extracted ${entities.length} entities`);

            // Save entities
            await supabase.from('entity_extractions').insert(
              entities.map((e: any) => ({
                email_id: email.id,
                entity_type: e.entity_type,
                entity_value: e.entity_value,
                confidence_score: e.confidence_score,
                extraction_method: 'ai_extraction'
              }))
            );
          } else {
            console.log(`ℹ️  No entities extracted`);
          }
        }

        processed++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n${'═'.repeat(100)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log(`Processed:  ${processed}`);
  console.log(`Failed:     ${failed}`);
  console.log(`\n✅ Classification complete!\n`);
}

async function classifyEmail(email: any) {
  const startTime = Date.now();

  const content = email.body_text || email.snippet || email.subject || '';

  const prompt = `You are a freight forwarding document classifier. Analyze this email and classify it into ONE of these document types:

Document Types:
- booking_confirmation: Initial booking acceptance from shipping line
- shipping_instruction: Details for preparing cargo/containers
- amendment: Changes to existing booking/shipment
- si_draft: Draft shipping instruction for review
- vgm_request: Verified Gross Mass submission
- commercial_invoice: Payment/billing document
- arrival_notice: Notification of cargo arrival
- house_bl: House Bill of Lading
- other: None of the above

Email:
Subject: ${email.subject}
From: ${email.sender_email}
Content: ${content.substring(0, 3000)}

Respond in JSON:
{
  "document_type": "one of the types above",
  "confidence_score": 0-100,
  "reasoning": "why you classified it this way"
}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const processingTime = Date.now() - startTime;
  const textContent = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse JSON response
  const jsonMatch = textContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const result = JSON.parse(jsonMatch[0]);

  return {
    document_type: result.document_type,
    confidence_score: result.confidence_score,
    reasoning: result.reasoning,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    processing_time_ms: processingTime
  };
}

async function extractEntities(email: any) {
  const content = email.body_text || email.snippet || email.subject || '';

  const prompt = `Extract shipping entities from this email:

Email:
Subject: ${email.subject}
Content: ${content.substring(0, 2000)}

Extract these entities if present:
- booking_number
- bl_number
- container_number
- vessel_name
- voyage_number
- port_of_loading
- port_of_discharge
- shipper_name
- consignee_name
- estimated_departure_date
- estimated_arrival_date

Respond in JSON array:
[
  {"entity_type": "booking_number", "entity_value": "ABC123", "confidence_score": 90},
  ...
]

Return empty array [] if no entities found.`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  const textContent = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = textContent.match(/\[[\s\S]*\]/);

  if (!jsonMatch) return [];

  return JSON.parse(jsonMatch[0]);
}

classifyOutgoingEmails().catch(console.error);
