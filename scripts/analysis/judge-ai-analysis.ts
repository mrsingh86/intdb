/**
 * Judge AI Analysis Results
 *
 * Uses Sonnet to validate Haiku extraction quality.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

import { createAIAnalysisExtractor } from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic();

async function judgeWithSonnet(
  email: { subject: string; body_text: string },
  haikuResult: any
): Promise<{ verdict: string; score: number; feedback: string }> {

  const prompt = `You are a quality judge for AI extraction results. Evaluate the following extraction:

EMAIL SUBJECT: ${email.subject}

EMAIL BODY (first 2000 chars):
${(email.body_text || '').slice(0, 2000)}

HAIKU EXTRACTION RESULT:
${JSON.stringify(haikuResult, null, 2)}

Evaluate:
1. Is the sentiment correct? Does it match the email tone?
2. Is the urgency level appropriate?
3. Is the summary accurate and captures key points?
4. Are the action items real actions from the email (not hallucinated)?

Return JSON:
{
  "verdict": "approved" | "needs_review" | "rejected",
  "score": 0-100,
  "sentiment_correct": true/false,
  "urgency_correct": true/false,
  "summary_accurate": true/false,
  "actions_valid": true/false,
  "feedback": "brief explanation"
}

Return ONLY JSON.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { verdict: 'error', score: 0, feedback: 'No response' };
  }

  try {
    const match = content.text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch {
    return { verdict: 'error', score: 0, feedback: content.text };
  }

  return { verdict: 'error', score: 0, feedback: 'Parse failed' };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SONNET JUDGE: Validating Haiku AI Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .order('received_at', { ascending: false })
    .limit(5);

  if (error || !emails?.length) {
    console.error('Failed to fetch emails');
    return;
  }

  const aiExtractor = createAIAnalysisExtractor();

  let totalScore = 0;
  let approved = 0;

  for (const email of emails) {
    console.log(`\n─── Email: ${(email.subject || '').slice(0, 50)}... ───\n`);

    // Step 1: Haiku extraction
    console.log('  [Haiku] Extracting...');
    const haikuStart = Date.now();
    const haikuResult = await aiExtractor.analyze({
      subject: email.subject || '',
      bodyText: email.body_text || '',
      senderEmail: email.sender_email || '',
    });
    console.log(`  [Haiku] Done in ${Date.now() - haikuStart}ms`);
    console.log(`    Sentiment: ${haikuResult.sentiment.value}`);
    console.log(`    Urgency: ${haikuResult.urgencyLevel.value}`);
    console.log(`    Summary: ${haikuResult.conversationSummary.summary.slice(0, 60)}...`);
    console.log(`    Actions: ${haikuResult.actionItems.items.length} items`);

    // Step 2: Sonnet judge
    console.log('  [Sonnet] Judging...');
    const sonnetStart = Date.now();
    const judgement = await judgeWithSonnet(email, haikuResult);
    console.log(`  [Sonnet] Done in ${Date.now() - sonnetStart}ms`);
    console.log(`    Verdict: ${judgement.verdict}`);
    console.log(`    Score: ${judgement.score}/100`);
    console.log(`    Feedback: ${judgement.feedback?.slice(0, 80)}`);

    totalScore += judgement.score || 0;
    if (judgement.verdict === 'approved') approved++;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  SUMMARY: ${approved}/${emails.length} approved`);
  console.log(`  Average Score: ${Math.round(totalScore / emails.length)}/100`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
