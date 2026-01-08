/**
 * Test AI Analysis Extraction
 *
 * Tests sentiment, urgency, summary, and action items extraction.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createAIAnalysisExtractor,
  quickSentimentAnalysis,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AI ANALYSIS EXTRACTION TEST');
  console.log('  Sentiment, Urgency, Summary, Action Items');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get diverse sample emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .order('received_at', { ascending: false })
    .limit(10);

  if (error || !emails?.length) {
    console.error('Failed to fetch emails');
    return;
  }

  const aiExtractor = createAIAnalysisExtractor();

  // Test Quick Analysis (keyword-based)
  console.log('─── QUICK ANALYSIS (Keyword-Based) ───\n');

  for (const email of emails.slice(0, 5)) {
    const quick = quickSentimentAnalysis(email.subject || '', email.body_text || '');
    console.log(`Subject: ${(email.subject || '').slice(0, 50)}...`);
    console.log(`  Sentiment: ${quick.sentiment} (${quick.confidence}%)`);
    console.log(`  Urgency: ${quick.urgency}`);
    console.log('');
  }

  // Test Full AI Analysis
  console.log('─── FULL AI ANALYSIS (Claude Sonnet) ───\n');

  for (const email of emails.slice(0, 3)) {
    console.log(`Subject: ${(email.subject || '').slice(0, 60)}...`);

    const result = await aiExtractor.analyze({
      subject: email.subject || '',
      bodyText: email.body_text || '',
      senderEmail: email.sender_email || '',
    });

    console.log(`  Sentiment: ${result.sentiment.value} (${result.sentiment.confidence}%)`);
    console.log(`    Reasoning: ${result.sentiment.reasoning.slice(0, 60)}...`);
    console.log(`  Urgency: ${result.urgencyLevel.value} (${result.urgencyLevel.confidence}%)`);
    if (result.urgencyLevel.triggers.length > 0) {
      console.log(`    Triggers: ${result.urgencyLevel.triggers.join(', ')}`);
    }
    console.log(`  Summary: ${result.conversationSummary.summary.slice(0, 80)}...`);
    if (result.conversationSummary.keyPoints.length > 0) {
      console.log(`  Key Points:`);
      for (const point of result.conversationSummary.keyPoints.slice(0, 3)) {
        console.log(`    • ${point.slice(0, 60)}`);
      }
    }
    if (result.actionItems.items.length > 0) {
      console.log(`  Action Items:`);
      for (const item of result.actionItems.items.slice(0, 3)) {
        console.log(`    → ${item.action.slice(0, 50)} [${item.owner}] ${item.priority}`);
      }
    }
    console.log(`  Processing: ${result.processingTimeMs}ms`);
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
