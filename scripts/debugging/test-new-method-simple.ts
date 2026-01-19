/**
 * Simple Test: New Classification Method
 *
 * Processes recent unprocessed emails and shows quality metrics.
 *
 * Usage: npx tsx scripts/test-new-method-simple.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import {
  ChronicleService,
  ChronicleLogger,
  createChronicleGmailService,
} from '../lib/chronicle';

async function main() {
  console.log('='.repeat(70));
  console.log('NEW CLASSIFICATION METHOD - QUALITY TEST');
  console.log('='.repeat(70));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const gmailService = createChronicleGmailService();
  const logger = new ChronicleLogger(supabase);
  const chronicleService = new ChronicleService(supabase, gmailService, logger);

  // Process recent emails (last 6 hours, max 50)
  console.log('\n📧 Processing recent emails with NEW classification method...');
  console.log('   (Thread position, enum normalization, flow validation, learning episodes)\n');

  const result = await chronicleService.fetchAndProcess({
    after: new Date(Date.now() - 6 * 60 * 60 * 1000),
    maxResults: 50,
    concurrency: 3,
  });

  console.log(`\n📊 Processing Results:`);
  console.log(`   Total:     ${result.processed}`);
  console.log(`   Succeeded: ${result.succeeded}`);
  console.log(`   Failed:    ${result.failed}`);
  console.log(`   Linked:    ${result.linked}`);
  console.log(`   Time:      ${result.totalTimeMs}ms`);

  // Get learning episodes from this run
  console.log('\n📋 Learning Episodes Analysis...');
  const { data: episodes } = await supabase
    .from('learning_episodes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(result.succeeded || 50);

  if (episodes && episodes.length > 0) {
    // Strategy breakdown
    const strategyCount: Record<string, number> = {};
    const methodCount: Record<string, number> = {};
    const docTypeCount: Record<string, number> = {};
    let flowPassed = 0;

    for (const ep of episodes) {
      strategyCount[ep.classification_strategy || 'unknown'] = (strategyCount[ep.classification_strategy || 'unknown'] || 0) + 1;
      methodCount[ep.prediction_method || 'unknown'] = (methodCount[ep.prediction_method || 'unknown'] || 0) + 1;
      docTypeCount[ep.predicted_document_type] = (docTypeCount[ep.predicted_document_type] || 0) + 1;
      if (ep.flow_validation_passed) flowPassed++;
    }

    console.log('─'.repeat(70));
    console.log(`   Total episodes:      ${episodes.length}`);
    console.log(`   Flow validation OK:  ${flowPassed} (${Math.round(flowPassed/episodes.length*100)}%)`);

    console.log('\n   Classification Strategy:');
    Object.entries(strategyCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      console.log(`     ${k}: ${v} (${Math.round(v/episodes.length*100)}%)`);
    });

    console.log('\n   Prediction Method:');
    Object.entries(methodCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      console.log(`     ${k}: ${v} (${Math.round(v/episodes.length*100)}%)`);
    });

    console.log('\n   Document Type Distribution:');
    const sortedTypes = Object.entries(docTypeCount).sort((a, b) => b[1] - a[1]);
    sortedTypes.forEach(([type, count]) => {
      const bar = '█'.repeat(Math.round(count / episodes.length * 20));
      console.log(`     ${type.padEnd(25)} ${count.toString().padStart(3)} ${bar}`);
    });

    // Quality score
    const genericTypes = ['request', 'notification', 'internal_notification', 'system_notification', 'unknown'];
    const genericCount = sortedTypes
      .filter(([type]) => genericTypes.includes(type))
      .reduce((sum, [, count]) => sum + count, 0);

    console.log('\n━'.repeat(70));
    console.log('QUALITY SCORE');
    console.log('━'.repeat(70));
    const qualityScore = Math.round((episodes.length - genericCount) / episodes.length * 100);
    console.log(`   Specific classifications: ${episodes.length - genericCount}/${episodes.length}`);
    console.log(`   Generic classifications:  ${genericCount}/${episodes.length}`);
    console.log(`   Quality Score:            ${qualityScore}%`);
    console.log('━'.repeat(70));
  }

  // Pattern match stats
  const stats = chronicleService.getPatternMatchStats();
  console.log('\n📈 Pattern Matching Performance:');
  console.log(`   Pattern matches: ${stats.matched}`);
  console.log(`   AI fallback:     ${stats.aiNeeded}`);
  console.log(`   Match rate:      ${stats.matchRate}`);

  // Check enum normalization usage
  console.log('\n📋 Enum Normalization Usage:');
  const { data: usedMappings } = await supabase
    .from('enum_mappings')
    .select('ai_value, correct_value, usage_count')
    .gt('usage_count', 0)
    .order('usage_count', { ascending: false })
    .limit(10);

  if (usedMappings && usedMappings.length > 0) {
    usedMappings.forEach(m => {
      console.log(`   "${m.ai_value}" → "${m.correct_value}" (${m.usage_count}x)`);
    });
  } else {
    console.log('   No normalizations applied (AI returned valid values)');
  }

  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
