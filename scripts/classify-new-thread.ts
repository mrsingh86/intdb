/**
 * Classify New Thread and Show Extraction Pipeline
 * Classifies the newly downloaded thread and displays complete RAW → CLASSIFY → EXTRACT flow
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
const THREAD_ID = '19b516305a7269a8';

async function classifyNewThread() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    CLASSIFY NEW THREAD & SHOW EXTRACTION PIPELINE                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch all emails in thread
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      gmail_message_id,
      thread_id,
      subject,
      sender_email,
      recipient_emails,
      body_text,
      snippet,
      received_at,
      revision_type,
      is_duplicate,
      thread_position,
      document_classifications (id, document_type, confidence_score)
    `)
    .eq('thread_id', THREAD_ID)
    .order('received_at', { ascending: true });

  if (!emails) {
    console.log('❌ No emails found in thread\n');
    return;
  }

  console.log(`📧 Thread: ${THREAD_ID}`);
  console.log(`   Subject: ${emails[0].subject}`);
  console.log(`   Emails: ${emails.length}\n`);

  // Filter unclassified
  const unclassified = emails.filter(e =>
    (!e.document_classifications || e.document_classifications.length === 0) &&
    !e.is_duplicate
  );

  console.log(`   Unclassified: ${unclassified.length}`);
  console.log(`   Already classified: ${emails.length - unclassified.length}\n`);

  if (unclassified.length === 0) {
    console.log('✅ All emails already classified. Showing extraction results...\n');
    await showExtractionPipeline();
    return;
  }

  // Classify each email
  console.log('═'.repeat(100));
  console.log('CLASSIFYING EMAILS');
  console.log('═'.repeat(100) + '\n');

  let processed = 0;

  for (const email of unclassified) {
    try {
      const threadContext = buildThreadContext(emails, email);

      console.log(`\n📧 EMAIL ${email.thread_position}/${emails.length}`);
      console.log(`   From: ${email.sender_email}`);
      console.log(`   Subject: ${email.subject?.substring(0, 60)}...\n`);

      // Classify
      const classification = await classifyEmail(email, threadContext);

      console.log(`   ✅ Classification: ${classification.document_type} (${classification.confidence_score}%)`);
      console.log(`   📊 Reasoning: ${classification.reasoning.substring(0, 80)}...\n`);

      // Save classification
      await supabase
        .from('document_classifications')
        .insert({
          email_id: email.id,
          document_type: classification.document_type,
          confidence_score: classification.confidence_score,
          model_name: 'claude-3-5-haiku',
          model_version: '20241022',
          classification_reason: classification.reasoning,
          matched_patterns: {
            input_tokens: classification.input_tokens,
            output_tokens: classification.output_tokens,
            processing_time_ms: classification.processing_time_ms,
            thread_aware: true,
            thread_position: email.thread_position
          }
        });

      // Extract entities if confidence high enough
      if (classification.confidence_score >= 50) {
        const entities = await extractEntities(email);

        if (entities.length > 0) {
          console.log(`   📋 Extracted ${entities.length} entities:`);
          entities.forEach((e: any) => {
            console.log(`      • ${e.entity_type}: "${e.entity_value}" (${e.confidence_score}%)`);
          });
          console.log('');

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
          console.log(`   ⚠️  No entities extracted (AI didn't find shipping data)\n`);
        }
      } else {
        console.log(`   ⏭️  Skipping entity extraction (confidence ${classification.confidence_score}% < 50%)\n`);
      }

      processed++;
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }

  console.log('═'.repeat(100));
  console.log(`✅ Classified ${processed}/${unclassified.length} emails\n`);

  // Show complete extraction pipeline
  await showExtractionPipeline();
}

function buildThreadContext(thread: any[], currentEmail: any): string {
  const currentIndex = thread.findIndex(e => e.id === currentEmail.id);

  let context = `THREAD CONTEXT (${thread.length} emails in conversation):\n\n`;

  thread.forEach((email, index) => {
    const isCurrent = index === currentIndex;
    const marker = isCurrent ? '>>> CURRENT EMAIL <<<' : '';

    context += `Email ${index + 1}/${thread.length} ${marker}\n`;
    context += `  From: ${email.sender_email}\n`;
    context += `  Sent: ${new Date(email.received_at).toLocaleString()}\n`;

    if (email.snippet && !isCurrent) {
      context += `  Snippet: "${email.snippet.substring(0, 100)}..."\n`;
    }

    context += `\n`;
  });

  return context;
}

async function classifyEmail(email: any, threadContext: string) {
  const startTime = Date.now();
  const content = email.body_text || email.snippet || '';

  const prompt = `You are classifying Email ${email.thread_position} in a thread conversation.

${threadContext}

CURRENT EMAIL TO CLASSIFY:
Subject: ${email.subject}
From: ${email.sender_email}
Content: ${content.substring(0, 2000)}

Document Types:
- booking_confirmation: Initial booking acceptance
- shipping_instruction: SI/VGM details
- amendment: Changes to existing booking
- si_draft: Draft SI for review
- vgm_request: VGM submission
- commercial_invoice: Payment/billing
- arrival_notice: Cargo arrival notification
- house_bl: House Bill of Lading
- government_document: Customs, permits, regulatory
- other: None of the above

Use thread context to understand the email's purpose.

Respond in JSON:
{
  "document_type": "one of the types above",
  "confidence_score": 0-100,
  "reasoning": "explain your classification, referencing thread context if relevant"
}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const processingTime = Date.now() - startTime;
  const textContent = response.content[0].type === 'text' ? response.content[0].text : '';

  const jsonMatch = textContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const sanitizedJson = jsonMatch[0]
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ');

  const result = JSON.parse(sanitizedJson);

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
- customs_reference
- permit_number

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

  const sanitizedJson = jsonMatch[0]
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ');

  return JSON.parse(sanitizedJson);
}

async function showExtractionPipeline() {
  console.log('\n\n' + '═'.repeat(100));
  console.log('COMPLETE EXTRACTION PIPELINE: RAW → CLASSIFY → EXTRACT');
  console.log('═'.repeat(100) + '\n');

  // Fetch complete data
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      gmail_message_id,
      subject,
      sender_email,
      received_at,
      body_text,
      snippet,
      thread_position,
      document_classifications (
        id,
        document_type,
        confidence_score,
        classification_reason,
        classified_at
      ),
      entity_extractions (
        id,
        entity_type,
        entity_value,
        confidence_score
      )
    `)
    .eq('thread_id', THREAD_ID)
    .order('received_at', { ascending: true });

  emails?.forEach((email: any, idx: number) => {
    console.log('┌' + '─'.repeat(98) + '┐');
    console.log(`│ EMAIL ${idx + 1}/${emails.length}`.padEnd(99) + '│');
    console.log('├' + '─'.repeat(98) + '┤');
    console.log('│');
    console.log(`│ 📨 RAW EMAIL DATA:`);
    console.log(`│    Gmail ID:        ${email.gmail_message_id}`);
    console.log(`│    Subject:         ${email.subject?.substring(0, 60)}`);
    console.log(`│    From:            ${email.sender_email}`);
    console.log(`│    Received:        ${new Date(email.received_at).toLocaleString()}`);
    console.log(`│    Thread Position: ${email.thread_position}`);
    console.log('│');

    // Show body preview
    if (email.body_text) {
      console.log(`│    Content Preview:`);
      const lines = email.body_text.substring(0, 300).split('\n').slice(0, 3);
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.log(`│    "${line.trim().substring(0, 80)}..."`);
        }
      });
    } else {
      console.log(`│    Snippet: "${email.snippet?.substring(0, 70)}..."`);
    }
    console.log('│');

    // Classifications
    const classifications = email.document_classifications || [];
    console.log(`│ 🏷️  CLASSIFICATION: ${classifications.length > 0 ? '✅' : '⚠️  Not classified'}`);

    if (classifications.length > 0) {
      classifications.forEach((c: any) => {
        console.log(`│    Type:            ${c.document_type.toUpperCase()}`);
        console.log(`│    Confidence:      ${c.confidence_score}%`);
        console.log(`│    Classified:      ${new Date(c.classified_at).toLocaleString()}`);
        console.log(`│    Reasoning:       "${c.classification_reason?.substring(0, 60)}..."`);
      });
    }
    console.log('│');

    // Extractions
    const extractions = email.entity_extractions || [];
    console.log(`│ 📋 EXTRACTED ENTITIES: ${extractions.length} ${extractions.length > 0 ? '✅' : '(none)'}`);

    if (extractions.length > 0) {
      extractions.forEach((e: any) => {
        console.log(`│    • ${e.entity_type.padEnd(25)} = "${e.entity_value}" (${e.confidence_score}%)`);
      });
    }
    console.log('│');
    console.log('└' + '─'.repeat(98) + '┘\n');
  });

  // Summary
  const totalClassifications = emails?.reduce((sum: number, e: any) =>
    sum + (e.document_classifications?.length || 0), 0) || 0;
  const totalExtractions = emails?.reduce((sum: number, e: any) =>
    sum + (e.entity_extractions?.length || 0), 0) || 0;

  console.log('═'.repeat(100));
  console.log('PIPELINE SUMMARY');
  console.log('═'.repeat(100));
  console.log(`📧 Total Emails:          ${emails?.length || 0}`);
  console.log(`🏷️  Total Classifications:  ${totalClassifications}`);
  console.log(`📋 Total Extractions:     ${totalExtractions}`);
  console.log(`📊 Avg per Email:         ${emails?.length ? (totalExtractions / emails.length).toFixed(1) : 0} entities`);
  console.log('');

  if (totalExtractions === 0) {
    console.log('⚠️  No entities extracted from this thread (likely not shipping-related emails)\n');
  } else {
    console.log('✅ Complete pipeline working: RAW → CLASSIFY → EXTRACT\n');
  }
}

classifyNewThread().catch(console.error);
