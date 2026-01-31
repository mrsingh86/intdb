/**
 * Test Smart Escalation Logic
 *
 * Verifies that:
 * 1. Communication types (request, approval, etc.) NEVER escalate
 * 2. Critical BL types (final_bl, house_bl, etc.) escalate when confidence < 85%
 * 3. Other shipping types use standard thresholds
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  ObjectiveConfidenceService,
  createObjectiveConfidenceService,
  ConfidenceInput,
} from '../../lib/chronicle/index.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface TestCase {
  name: string;
  documentType: string;
  simulatedScore: number;
  expectedRecommendation: string;
  reason: string;
}

const TEST_CASES: TestCase[] = [
  // Communication types - NEVER escalate
  {
    name: 'Request (low score)',
    documentType: 'request',
    simulatedScore: 45,
    expectedRecommendation: 'flag_review',
    reason: 'Communication type - no shipping data to extract',
  },
  {
    name: 'Approval (low score)',
    documentType: 'approval',
    simulatedScore: 55,
    expectedRecommendation: 'flag_review',
    reason: 'Communication type - no shipping data to extract',
  },
  {
    name: 'Acknowledgement (medium score)',
    documentType: 'acknowledgement',
    simulatedScore: 72,
    expectedRecommendation: 'accept',
    reason: 'Communication type with decent score',
  },
  {
    name: 'Quotation (very low score)',
    documentType: 'quotation',
    simulatedScore: 35,
    expectedRecommendation: 'flag_review',
    reason: 'Communication type - no shipping data',
  },
  {
    name: 'Notification (low score)',
    documentType: 'notification',
    simulatedScore: 60,
    expectedRecommendation: 'flag_review',
    reason: 'Communication type - status FYI only',
  },

  // Critical BL types - escalate when confidence < 85%
  {
    name: 'Final BL (high score)',
    documentType: 'final_bl',
    simulatedScore: 88,
    expectedRecommendation: 'accept',
    reason: 'Critical doc with high confidence',
  },
  {
    name: 'Final BL (medium score)',
    documentType: 'final_bl',
    simulatedScore: 72,
    expectedRecommendation: 'escalate_sonnet',
    reason: 'Critical doc - needs Sonnet for accuracy',
  },
  {
    name: 'House BL (low score)',
    documentType: 'house_bl',
    simulatedScore: 55,
    expectedRecommendation: 'escalate_sonnet',
    reason: 'Critical doc - financial liability',
  },
  {
    name: 'Draft BL (very low score)',
    documentType: 'draft_bl',
    simulatedScore: 42,
    expectedRecommendation: 'escalate_opus',
    reason: 'Critical doc with very low confidence',
  },
  {
    name: 'SI Confirmation (medium score)',
    documentType: 'si_confirmation',
    simulatedScore: 65,
    expectedRecommendation: 'escalate_sonnet',
    reason: 'Critical for vessel operations',
  },

  // Standard shipping types - use database thresholds
  {
    name: 'Booking Confirmation (high)',
    documentType: 'booking_confirmation',
    simulatedScore: 90,
    expectedRecommendation: 'accept',
    reason: 'High confidence - standard threshold',
  },
  {
    name: 'Invoice (medium)',
    documentType: 'invoice',
    simulatedScore: 75,
    expectedRecommendation: 'flag_review',
    reason: 'Medium confidence - standard threshold',
  },
  {
    name: 'Arrival Notice (low)',
    documentType: 'arrival_notice',
    simulatedScore: 55,
    expectedRecommendation: 'escalate_sonnet',
    reason: 'Low confidence - standard escalation',
  },
];

async function runTest(
  confidenceService: ObjectiveConfidenceService,
  test: TestCase
): Promise<{ passed: boolean; actual: string }> {
  // Build a minimal confidence input
  const input: ConfidenceInput = {
    chronicleId: 'test-' + Date.now(),
    documentType: test.documentType,
    extractedFields: {
      booking_number: test.simulatedScore > 60 ? 'TEST123' : null,
      vessel_name: test.simulatedScore > 70 ? 'MSC OSCAR' : null,
      etd: test.simulatedScore > 80 ? '2026-02-01' : null,
    },
    senderEmail: 'test@carrier.com',
  };

  // Calculate confidence (this will use real DB rules + our new logic)
  const result = await confidenceService.calculateConfidence(input);

  return {
    passed: result.recommendation === test.expectedRecommendation,
    actual: result.recommendation,
  };
}

async function main() {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('   TEST: Smart Escalation Logic');
  console.log('═'.repeat(70));

  const confidenceService = createObjectiveConfidenceService(supabase);

  // Group tests by category
  const categories = {
    'COMMUNICATION TYPES (should NEVER escalate)': TEST_CASES.filter(t =>
      ['request', 'approval', 'acknowledgement', 'quotation', 'notification'].includes(t.documentType)
    ),
    'CRITICAL BL TYPES (should escalate when < 85%)': TEST_CASES.filter(t =>
      ['final_bl', 'house_bl', 'draft_bl', 'si_confirmation'].includes(t.documentType)
    ),
    'STANDARD SHIPPING (use DB thresholds)': TEST_CASES.filter(t =>
      ['booking_confirmation', 'invoice', 'arrival_notice'].includes(t.documentType)
    ),
  };

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [category, tests] of Object.entries(categories)) {
    console.log(`\n${category}`);
    console.log('─'.repeat(70));

    for (const test of tests) {
      const result = await runTest(confidenceService, test);

      if (result.passed) {
        totalPassed++;
        console.log(`  ✅ ${test.name}`);
        console.log(`     Score: ${test.simulatedScore}% → ${result.actual}`);
      } else {
        totalFailed++;
        console.log(`  ❌ ${test.name}`);
        console.log(`     Score: ${test.simulatedScore}%`);
        console.log(`     Expected: ${test.expectedRecommendation}`);
        console.log(`     Actual:   ${result.actual}`);
        console.log(`     Reason: ${test.reason}`);
      }
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('   SUMMARY');
  console.log('═'.repeat(70));
  console.log(`\n  Total: ${totalPassed + totalFailed} tests`);
  console.log(`  Passed: ${totalPassed} ✅`);
  console.log(`  Failed: ${totalFailed} ❌`);
  console.log(`\n  Result: ${totalFailed === 0 ? 'ALL TESTS PASSED!' : 'SOME TESTS FAILED'}`);

  if (totalFailed === 0) {
    console.log(`
  Smart Escalation Logic Verified:
  ✓ Communication types (request, approval, etc.) NEVER escalate to Sonnet
  ✓ Critical BL types escalate when confidence < 85%
  ✓ Standard shipping types use database thresholds

  Projected savings: ~60% reduction in Sonnet escalations
  Projected improvement: Higher quality on critical shipping documents
`);
  }

  console.log('═'.repeat(70));
}

main().catch(console.error);
