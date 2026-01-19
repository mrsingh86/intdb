/**
 * Test Script: Learning System Integration
 *
 * Tests the new learning system features:
 * 1. Enum normalization
 * 2. Flow validation
 * 3. Learning episode recording
 *
 * Usage: npx tsx scripts/test-learning-system.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import {
  ChronicleService,
  ChronicleLogger,
  createChronicleGmailService,
} from '../lib/chronicle';

const MAX_EMAILS = 15; // Process more emails to catch Position 1
const HOURS_BACK = 72; // Look back 72 hours

async function main() {
  console.log('='.repeat(60));
  console.log('TESTING LEARNING SYSTEM INTEGRATION');
  console.log('='.repeat(60));

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

  // Step 1: Check enum mappings
  console.log('\n📋 Step 1: Checking enum_mappings table...');
  const { data: mappings, count: mappingCount } = await supabase
    .from('enum_mappings')
    .select('ai_value, correct_value', { count: 'exact' })
    .eq('mapping_type', 'document_type')
    .limit(5);
  console.log(`   Found ${mappingCount} document_type mappings`);
  console.log('   Sample:', mappings?.slice(0, 3).map(m => `${m.ai_value} → ${m.correct_value}`).join(', '));

  // Step 2: Check flow validation rules
  console.log('\n📋 Step 2: Checking flow_validation_rules table...');
  const { count: ruleCount } = await supabase
    .from('flow_validation_rules')
    .select('*', { count: 'exact', head: true });
  console.log(`   Found ${ruleCount} flow validation rules`);

  // Step 3: Process some emails
  console.log('\n📧 Step 3: Processing emails...');
  const after = new Date(Date.now() - HOURS_BACK * 60 * 60 * 1000);
  console.log(`   Looking back to: ${after.toISOString()}`);
  console.log(`   Max emails: ${MAX_EMAILS}`);

  const result = await chronicleService.fetchAndProcess({
    after,
    maxResults: MAX_EMAILS,
    concurrency: 2,
  });

  console.log('\n📊 Processing Results:');
  console.log(`   Total:     ${result.processed}`);
  console.log(`   Succeeded: ${result.succeeded}`);
  console.log(`   Failed:    ${result.failed}`);
  console.log(`   Linked:    ${result.linked}`);
  console.log(`   Time:      ${result.totalTimeMs}ms`);

  // Step 4: Check learning episodes
  console.log('\n📋 Step 4: Checking learning_episodes table...');
  const { data: episodes, count: episodeCount } = await supabase
    .from('learning_episodes')
    .select('predicted_document_type, prediction_method, prediction_confidence, flow_validation_passed, thread_position', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(5);

  console.log(`   Total learning episodes: ${episodeCount}`);
  if (episodes && episodes.length > 0) {
    console.log('\n   Recent episodes:');
    episodes.forEach((ep, i) => {
      console.log(`   ${i + 1}. ${ep.predicted_document_type} (${ep.prediction_method}, ${ep.prediction_confidence}% confidence)`);
      console.log(`      Thread position: ${ep.thread_position}, Flow valid: ${ep.flow_validation_passed}`);
    });
  }

  // Step 5: Check pattern match stats
  console.log('\n📊 Step 5: Pattern Match Statistics:');
  const stats = chronicleService.getPatternMatchStats();
  console.log(`   Pattern matches: ${stats.matched}`);
  console.log(`   AI needed:       ${stats.aiNeeded}`);
  console.log(`   Match rate:      ${stats.matchRate}`);

  // Step 6: Check if any enum normalizations were used
  console.log('\n📋 Step 6: Checking enum normalization usage...');
  const { data: usedMappings } = await supabase
    .from('enum_mappings')
    .select('ai_value, correct_value, usage_count')
    .gt('usage_count', 0)
    .order('usage_count', { ascending: false })
    .limit(5);

  if (usedMappings && usedMappings.length > 0) {
    console.log('   Normalizations applied:');
    usedMappings.forEach(m => {
      console.log(`   - "${m.ai_value}" → "${m.correct_value}" (${m.usage_count} times)`);
    });
  } else {
    console.log('   No normalizations applied yet (AI returned valid values)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
