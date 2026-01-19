/**
 * Test AI Classification Fallback
 *
 * Tests the AI fallback on emails with unknown/low-confidence classifications.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { createClassificationOrchestrator } from '../lib/services/classification/index.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const orchestrator = createClassificationOrchestrator();

async function testAIClassification() {
  console.log('='.repeat(80));
  console.log('AI CLASSIFICATION FALLBACK TEST');
  console.log('='.repeat(80));

  // Get emails that would be classified as unknown
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
    .limit(100);

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`\nTesting ${emails.length} emails...\n`);

  // Track statistics
  let patternUnknownSender = 0;
  let patternUnknownEmailType = 0;
  let aiImprovedSender = 0;
  let aiImprovedEmailType = 0;
  let totalAICalls = 0;

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    // First, check pattern-only result
    const patternResult = orchestrator.classify({
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email || null,
      bodyText: email.body_text || '',
    });

    const needsAI = patternResult.senderCategory === 'unknown' ||
                    patternResult.emailType === 'unknown';

    if (!needsAI) {
      continue; // Skip emails where pattern matching is confident
    }

    if (patternResult.senderCategory === 'unknown') patternUnknownSender++;
    if (patternResult.emailType === 'unknown') patternUnknownEmailType++;

    // Now test with AI
    console.log(`\n--- Email ${i + 1}: ${email.subject?.substring(0, 60)} ---`);
    console.log(`Sender: ${email.sender_email}`);
    console.log(`\nPattern-only results:`);
    console.log(`  Sender Category: ${patternResult.senderCategory}`);
    console.log(`  Email Type: ${patternResult.emailType} (${patternResult.emailTypeConfidence}%)`);

    try {
      const aiResult = await orchestrator.classifyWithAI({
        subject: email.subject || '',
        senderEmail: email.sender_email || '',
        trueSenderEmail: email.true_sender_email || null,
        bodyText: email.body_text || '',
      });

      totalAICalls++;

      console.log(`\nWith AI fallback:`);
      console.log(`  Sender Category: ${aiResult.senderCategory}`);
      console.log(`  Email Type: ${aiResult.emailType} (${aiResult.emailTypeConfidence}%)`);
      console.log(`  Used AI: ${aiResult.usedAIFallback || false}`);
      if (aiResult.aiReasoning) {
        console.log(`  AI Reasoning: ${aiResult.aiReasoning.substring(0, 100)}...`);
      }

      // Track improvements
      if (patternResult.senderCategory === 'unknown' && aiResult.senderCategory !== 'unknown') {
        aiImprovedSender++;
        console.log(`  ✅ AI improved sender: unknown → ${aiResult.senderCategory}`);
      }
      if (patternResult.emailType === 'unknown' && aiResult.emailType !== 'unknown') {
        aiImprovedEmailType++;
        console.log(`  ✅ AI improved email type: unknown → ${aiResult.emailType}`);
      }

    } catch (err) {
      console.error(`  ❌ AI error: ${err}`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total emails tested: ${emails.length}`);
  console.log(`Emails needing AI (unknown pattern results): ${totalAICalls}`);
  console.log(`  Pattern unknown sender: ${patternUnknownSender}`);
  console.log(`  Pattern unknown email type: ${patternUnknownEmailType}`);
  console.log(`AI improvements:`);
  console.log(`  Sender category improved: ${aiImprovedSender}/${patternUnknownSender} (${patternUnknownSender ? ((aiImprovedSender/patternUnknownSender)*100).toFixed(1) : 0}%)`);
  console.log(`  Email type improved: ${aiImprovedEmailType}/${patternUnknownEmailType} (${patternUnknownEmailType ? ((aiImprovedEmailType/patternUnknownEmailType)*100).toFixed(1) : 0}%)`);
}

testAIClassification().catch(console.error);
