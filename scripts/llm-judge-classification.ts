/**
 * LLM Judge for Classification Quality
 *
 * Uses an LLM to evaluate whether the classification makes sense
 * and provide feedback on misclassifications.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { createClassificationOrchestrator } from '../lib/services/classification/index.js';
import { detectSentiment } from '../lib/config/email-type-config.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!anthropicKey) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });
const orchestrator = createClassificationOrchestrator();

interface JudgmentResult {
  emailId: string;
  subject: string;
  senderEmail: string;
  trueSender: string | null;

  // Our classification
  ourSenderCategory: string;
  ourEmailType: string;
  ourDocumentType: string;
  ourSentiment: string;

  // LLM judgment
  llmSenderCategory: string;
  llmEmailType: string;
  llmDocumentType: string;
  llmSentiment: string;

  // Agreement
  senderMatch: boolean;
  emailTypeMatch: boolean;
  documentTypeMatch: boolean;
  sentimentMatch: boolean;

  // LLM reasoning
  feedback: string;
}

async function judgeClassification(email: {
  subject: string;
  sender_email: string;
  true_sender_email: string | null;
  body_text: string | null;
}): Promise<{
  senderCategory: string;
  emailType: string;
  documentType: string;
  sentiment: string;
  reasoning: string;
}> {
  const prompt = `You are an expert at classifying shipping/freight forwarding emails.

Given this email, classify it into the following categories:

EMAIL:
- Subject: ${email.subject}
- Sender: ${email.sender_email}
- True Sender (if forwarded): ${email.true_sender_email || 'N/A'}
- Body Preview: ${(email.body_text || '').substring(0, 500)}

CLASSIFY INTO:

1. SENDER CATEGORY (who is sending):
   - carrier (shipping lines: Maersk, Hapag-Lloyd, CMA CGM, COSCO, etc.)
   - intoglo (internal @intoglo.com team)
   - cha_india (Indian customs house agents)
   - customs_broker_us (US customs brokers)
   - shipper (exporters/manufacturers)
   - consignee (importers/receivers)
   - trucker (trucking/drayage companies)
   - partner (freight forwarder partners)
   - platform (logistics platforms, government portals)
   - unknown (newsletters, marketing, unrelated)

2. EMAIL TYPE (what is the intent):
   - approval_request, approval_granted, approval_rejected
   - stuffing_update, gate_in_update, handover_update
   - departure_update, transit_update, arrival_update
   - pre_alert, clearance_initiation, clearance_complete
   - delivery_scheduling, pickup_scheduling, delivery_complete
   - quote_request, quote_response, payment_request, payment_confirmation
   - amendment_request, cancellation_notice
   - query, reminder, urgent_action, delay_notice, demurrage_action
   - document_share, general_correspondence, acknowledgement, escalation
   - unknown

3. DOCUMENT TYPE (what document is being shared/referenced):
   - booking_confirmation, booking_amendment, booking_cancellation
   - shipping_instruction, si_draft
   - bill_of_lading, hbl, hbl_draft, mbl
   - arrival_notice, sob_confirmation
   - invoice, commercial_invoice, freight_invoice, duty_invoice
   - shipping_bill, entry_summary
   - proof_of_delivery, work_order
   - unknown

4. SENTIMENT:
   - urgent (needs immediate action)
   - escalated (complaint, issue raised)
   - negative (problem, dissatisfaction)
   - positive (thanks, appreciation)
   - neutral (normal business)

Respond in JSON format only:
{
  "senderCategory": "...",
  "emailType": "...",
  "documentType": "...",
  "sentiment": "...",
  "reasoning": "Brief explanation of your classification"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      // Extract JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
    throw new Error('Invalid response format');
  } catch (error) {
    console.error('LLM error:', error);
    return {
      senderCategory: 'unknown',
      emailType: 'unknown',
      documentType: 'unknown',
      sentiment: 'neutral',
      reasoning: 'Error calling LLM',
    };
  }
}

async function runJudge() {
  console.log('='.repeat(80));
  console.log('LLM JUDGE - CLASSIFICATION QUALITY EVALUATION');
  console.log('='.repeat(80));

  // Get random sample of emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      true_sender_email,
      body_text
    `)
    .not('subject', 'is', null)
    .not('sender_email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`\nJudging ${emails.length} emails...\n`);

  const results: JudgmentResult[] = [];
  let senderMatches = 0;
  let emailTypeMatches = 0;
  let documentTypeMatches = 0;
  let sentimentMatches = 0;

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    process.stdout.write(`\rProcessing ${i + 1}/${emails.length}...`);

    // Our classification
    const ourResult = orchestrator.classify({
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email || null,
      bodyText: email.body_text || '',
    });

    const sentimentResult = detectSentiment(email.subject || '', email.body_text || '');

    // LLM judgment
    const llmResult = await judgeClassification({
      subject: email.subject || '',
      sender_email: email.sender_email || '',
      true_sender_email: email.true_sender_email || null,
      body_text: email.body_text || '',
    });

    const senderMatch = ourResult.senderCategory === llmResult.senderCategory;
    const emailTypeMatch = ourResult.emailType === llmResult.emailType ||
      (ourResult.emailType === 'general_correspondence' && llmResult.emailType === 'unknown') ||
      (ourResult.emailType === 'unknown' && llmResult.emailType === 'general_correspondence');
    const documentTypeMatch = ourResult.documentType === llmResult.documentType;
    const sentimentMatch = sentimentResult.sentiment === llmResult.sentiment;

    if (senderMatch) senderMatches++;
    if (emailTypeMatch) emailTypeMatches++;
    if (documentTypeMatch) documentTypeMatches++;
    if (sentimentMatch) sentimentMatches++;

    results.push({
      emailId: email.id.substring(0, 8),
      subject: email.subject?.substring(0, 60) || '',
      senderEmail: email.sender_email || '',
      trueSender: email.true_sender_email,

      ourSenderCategory: ourResult.senderCategory,
      ourEmailType: ourResult.emailType,
      ourDocumentType: ourResult.documentType,
      ourSentiment: sentimentResult.sentiment,

      llmSenderCategory: llmResult.senderCategory,
      llmEmailType: llmResult.emailType,
      llmDocumentType: llmResult.documentType,
      llmSentiment: llmResult.sentiment,

      senderMatch,
      emailTypeMatch,
      documentTypeMatch,
      sentimentMatch,

      feedback: llmResult.reasoning,
    });

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n\n');

  // Print disagreements
  console.log('='.repeat(80));
  console.log('DISAGREEMENTS (Our classification vs LLM)');
  console.log('='.repeat(80));

  const disagreements = results.filter(r =>
    !r.senderMatch || !r.emailTypeMatch || !r.documentTypeMatch
  );

  for (const r of disagreements.slice(0, 20)) {
    console.log(`\nSubject: ${r.subject}`);
    console.log(`Sender: ${r.senderEmail}`);
    if (!r.senderMatch) {
      console.log(`  Sender Category: OURS=${r.ourSenderCategory} vs LLM=${r.llmSenderCategory}`);
    }
    if (!r.emailTypeMatch) {
      console.log(`  Email Type: OURS=${r.ourEmailType} vs LLM=${r.llmEmailType}`);
    }
    if (!r.documentTypeMatch) {
      console.log(`  Document Type: OURS=${r.ourDocumentType} vs LLM=${r.llmDocumentType}`);
    }
    console.log(`  LLM Reasoning: ${r.feedback}`);
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('AGREEMENT RATES');
  console.log('='.repeat(80));
  console.log(`Sender Category:  ${((senderMatches / emails.length) * 100).toFixed(1)}%`);
  console.log(`Email Type:       ${((emailTypeMatches / emails.length) * 100).toFixed(1)}%`);
  console.log(`Document Type:    ${((documentTypeMatches / emails.length) * 100).toFixed(1)}%`);
  console.log(`Sentiment:        ${((sentimentMatches / emails.length) * 100).toFixed(1)}%`);

  // Specific pattern suggestions
  console.log('\n' + '='.repeat(80));
  console.log('SUGGESTED PATTERN IMPROVEMENTS');
  console.log('='.repeat(80));

  const senderDisagreements = disagreements.filter(d => !d.senderMatch);
  const uniqueSenderPatterns = new Map<string, { ours: string; llm: string; count: number }>();

  for (const d of senderDisagreements) {
    const domain = (d.trueSender || d.senderEmail).split('@')[1]?.replace('>', '') || 'unknown';
    const key = `${domain}|${d.llmSenderCategory}`;
    if (!uniqueSenderPatterns.has(key)) {
      uniqueSenderPatterns.set(key, { ours: d.ourSenderCategory, llm: d.llmSenderCategory, count: 0 });
    }
    uniqueSenderPatterns.get(key)!.count++;
  }

  console.log('\nSender patterns to add:');
  for (const [key, value] of [...uniqueSenderPatterns.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10)) {
    const [domain] = key.split('|');
    console.log(`  ${domain}: LLM says ${value.llm} (we said ${value.ours}) - ${value.count} emails`);
  }
}

runJudge().catch(console.error);
