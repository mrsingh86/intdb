/**
 * Test Pattern Matcher Service
 *
 * Compares pattern matching results against AI classifications
 * to validate the hybrid classification approach.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  PatternMatcherService,
  PatternMatchInput,
} from '../lib/chronicle/pattern-matcher';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TestEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_address: string;
  body_preview: string;
  ai_document_type: string;
  thread_id: string;
}

async function runTest() {
  console.log('🔬 Pattern Matcher Test\n');
  console.log('='.repeat(80));

  // Create pattern matcher
  const patternMatcher = new PatternMatcherService(supabase);

  // Load patterns
  console.log('\n📥 Loading patterns from database...');
  await patternMatcher.reloadPatterns();
  const patterns = patternMatcher.getLoadedPatterns();
  console.log(`   Loaded ${patterns.length} active patterns\n`);

  // Fetch test emails
  const { data: emails, error } = await supabase
    .from('chronicle')
    .select('id, gmail_message_id, subject, from_address, body_preview, document_type, thread_id')
    .not('document_type', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(50);

  if (error || !emails) {
    console.error('Failed to fetch emails:', error);
    return;
  }

  // Calculate thread positions for each email
  const threadPositions = new Map<string, number>();
  const threadCounts = new Map<string, number>();

  // First pass: count emails per thread
  for (const email of emails) {
    const count = threadCounts.get(email.thread_id) || 0;
    threadCounts.set(email.thread_id, count + 1);
  }

  // Second pass: assign positions (simple heuristic - newer emails have higher positions)
  const threadCurrentPos = new Map<string, number>();
  for (const email of [...emails].reverse()) {
    const pos = (threadCurrentPos.get(email.thread_id) || 0) + 1;
    threadCurrentPos.set(email.thread_id, pos);
    threadPositions.set(email.id, pos);
  }

  console.log(`📧 Testing ${emails.length} emails\n`);
  console.log('='.repeat(80));

  // Test results
  let matched = 0;
  let correctMatches = 0;
  let incorrectMatches = 0;
  let noMatch = 0;
  let aiNeeded = 0;

  const results: Array<{
    subject: string;
    aiType: string;
    patternType: string | null;
    confidence: number;
    match: boolean;
    correct: boolean;
    threadPos: number;
  }> = [];

  for (const email of emails as TestEmail[]) {
    const threadPos = threadPositions.get(email.id) || 1;

    const input: PatternMatchInput = {
      subject: email.subject,
      senderEmail: email.from_address,
      bodyText: email.body_preview || '',
      hasAttachment: false, // We don't have this info from the query
      threadPosition: threadPos,
    };

    const result = await patternMatcher.match(input);

    const isCorrect = result.matched && result.documentType === email.ai_document_type;

    if (result.matched) {
      matched++;
      if (isCorrect) {
        correctMatches++;
      } else {
        incorrectMatches++;
      }
      if (result.requiresAiFallback) {
        aiNeeded++;
      }
    } else {
      noMatch++;
    }

    results.push({
      subject: email.subject.substring(0, 50),
      aiType: email.ai_document_type,
      patternType: result.documentType,
      confidence: result.confidence,
      match: result.matched,
      correct: isCorrect,
      threadPos,
    });
  }

  // Print results
  console.log('\n📊 RESULTS\n');
  console.log('-'.repeat(80));

  // Print detailed results
  console.log('\nMatched Emails:');
  for (const r of results.filter(r => r.match)) {
    const status = r.correct ? '✅' : '❌';
    const confidence = r.confidence.toString().padStart(3);
    console.log(`${status} [${confidence}%] pos:${r.threadPos} | AI: ${r.aiType.padEnd(25)} | Pattern: ${(r.patternType || 'null').padEnd(25)} | ${r.subject}`);
  }

  console.log('\n\nNo Pattern Match (AI Required):');
  for (const r of results.filter(r => !r.match).slice(0, 15)) {
    console.log(`   AI: ${r.aiType.padEnd(25)} | pos:${r.threadPos} | ${r.subject}`);
  }
  if (results.filter(r => !r.match).length > 15) {
    console.log(`   ... and ${results.filter(r => !r.match).length - 15} more`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 SUMMARY\n');
  console.log(`   Total emails tested:     ${emails.length}`);
  console.log(`   Pattern matched:         ${matched} (${Math.round(matched/emails.length*100)}%)`);
  console.log(`   - Correct matches:       ${correctMatches} (${matched > 0 ? Math.round(correctMatches/matched*100) : 0}% accuracy)`);
  console.log(`   - Incorrect matches:     ${incorrectMatches}`);
  console.log(`   - AI fallback needed:    ${aiNeeded} (low confidence)`);
  console.log(`   No pattern match:        ${noMatch} (${Math.round(noMatch/emails.length*100)}%)`);
  console.log();
  console.log(`   🎯 High-confidence skips: ${matched - aiNeeded} emails can skip AI`);
  console.log(`   💰 Potential cost savings: ${Math.round((matched - aiNeeded)/emails.length*100)}% reduction in AI calls`);
  console.log('='.repeat(80));

  // Show incorrect matches for debugging
  if (incorrectMatches > 0) {
    console.log('\n⚠️  INCORRECT MATCHES (needs pattern review):\n');
    for (const r of results.filter(r => r.match && !r.correct)) {
      console.log(`   AI: ${r.aiType.padEnd(25)} → Pattern: ${(r.patternType || 'null').padEnd(25)} | ${r.subject}`);
    }
  }
}

// Run the test
runTest().catch(console.error);
