/**
 * Thread-Aware AI Classification
 * Classifies emails using thread context for better accuracy
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

async function classifyWithThreadContext() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         THREAD-AWARE AI CLASSIFICATION                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch unclassified emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      thread_id,
      subject,
      sender_email,
      body_text,
      snippet,
      received_at,
      revision_type,
      is_duplicate,
      thread_position,
      document_classifications (id)
    `)
    .not('thread_id', 'is', null)
    .order('received_at', { ascending: true });

  if (!emails) {
    console.log('No emails found\n');
    return;
  }

  // Filter to unclassified, non-duplicates
  const unclassified = emails.filter(e =>
    (!e.document_classifications || e.document_classifications.length === 0) &&
    !e.is_duplicate  // Skip duplicates to save AI costs!
  );

  console.log(`📧 Total emails: ${emails.length}`);
  console.log(`📊 Unclassified: ${unclassified.length}`);
  console.log(`⏭️  Duplicates skipped: ${emails.filter(e => e.is_duplicate).length}\n`);

  if (unclassified.length === 0) {
    console.log('✅ All unique emails already classified!\n');
    return;
  }

  // Group by thread
  const threads: Record<string, typeof emails> = {};
  emails.forEach(email => {
    if (!threads[email.thread_id]) {
      threads[email.thread_id] = [];
    }
    threads[email.thread_id].push(email);
  });

  console.log('⚙️  Processing unclassified emails with thread context...\n');
  console.log('─'.repeat(100) + '\n');

  let processed = 0;
  let failed = 0;

  for (const email of unclassified) {
    try {
      // Get thread context
      const thread = threads[email.thread_id] || [email];
      const threadContext = buildThreadContext(thread, email);

      console.log(`\n📧 Email: ${email.subject?.substring(0, 50)}...`);
      console.log(`   Thread position: ${email.thread_position} of ${thread.length}`);
      console.log(`   Revision type: ${email.revision_type || 'not detected'}`);

      // Classify with thread context
      const classification = await classifyEmail(email, threadContext);

      console.log(`   ✅ Classified as: ${classification.document_type} (${classification.confidence_score}% confidence)`);

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
          processing_time_ms: classification.processing_time_ms,
          thread_aware: true,
          thread_position: email.thread_position,
          revision_type: email.revision_type
        }
      });

      // Extract entities if confidence is high
      if (classification.confidence_score >= 50) {
        const entities = await extractEntities(email);
        if (entities.length > 0) {
          console.log(`   📊 Extracted ${entities.length} entities`);

          await supabase.from('entity_extractions').insert(
            entities.map((e: any) => ({
              email_id: email.id,
              entity_type: e.entity_type,
              entity_value: e.entity_value,
              confidence_score: e.confidence_score,
              extraction_method: 'ai_extraction'
            }))
          );
        }
      }

      processed++;
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }

  console.log('\n\n' + '═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log(`Processed:  ${processed} ✅`);
  console.log(`Failed:     ${failed} ❌`);
  console.log(`Skipped:    ${emails.filter(e => e.is_duplicate).length} (duplicates)`);
  console.log('\n✅ Thread-aware classification complete!\n');
}

function buildThreadContext(thread: any[], currentEmail: any): string {
  const sortedThread = thread.sort((a, b) =>
    new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
  );

  const currentIndex = sortedThread.findIndex(e => e.id === currentEmail.id);

  let context = `THREAD CONTEXT (${thread.length} emails in conversation):\n\n`;

  sortedThread.forEach((email, index) => {
    const isCurrent = index === currentIndex;
    const marker = isCurrent ? '>>> CURRENT EMAIL <<<' : '';

    context += `Email ${index + 1}/${thread.length} ${marker}\n`;
    context += `  Subject: ${email.subject}\n`;
    context += `  From: ${email.sender_email}\n`;
    context += `  Sent: ${new Date(email.received_at).toLocaleString()}\n`;
    context += `  Revision: ${email.revision_type || 'unknown'}\n`;

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
Revision Type: ${email.revision_type || 'not detected'}
Content: ${content.substring(0, 2000)}

Document Types:
- booking_confirmation: Initial booking acceptance
- shipping_instruction: SI/VGM details
- amendment: Changes to existing booking (use if revision_type contains "update" or "amendment")
- si_draft: Draft SI for review
- vgm_request: VGM submission
- commercial_invoice: Payment/billing
- arrival_notice: Cargo arrival notification
- house_bl: House Bill of Lading
- other: None of the above

IMPORTANT:
- If revision_type is "1st_update", "2nd_update", etc., classify as "amendment"
- Use thread context to understand if this is a follow-up or update
- Higher confidence if you can see the progression in the thread

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

  // Sanitize JSON to remove control characters
  const sanitizedJson = jsonMatch[0]
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')  // Remove control characters
    .replace(/\n/g, ' ')  // Replace newlines with spaces
    .replace(/\t/g, ' ')  // Replace tabs with spaces
    .replace(/\s+/g, ' '); // Normalize whitespace

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

  // Sanitize JSON to remove control characters
  const sanitizedJson = jsonMatch[0]
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ');

  return JSON.parse(sanitizedJson);
}

classifyWithThreadContext().catch(console.error);
