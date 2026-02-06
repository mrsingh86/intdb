/**
 * Comprehensive Test Suite for PreciseActionService
 *
 * Tests:
 * 1. Template lookups for all document_type + from_party combinations
 * 2. Priority calculations (base, keywords, cutoff proximity)
 * 3. Deadline calculations (fixed_days, cutoff_relative, urgent)
 * 4. Fallback recommendations for unmapped combinations
 * 5. Auto-resolution logic
 * 6. Cross-validation against expected business rules
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  PreciseActionService,
  PreciseActionRecommendation,
  ShipmentContext,
} from '../lib/chronicle/precise-action-service';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Test result tracking
interface TestResult {
  testName: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

const results: TestResult[] = [];

function logResult(testName: string, passed: boolean, expected: string, actual: string, details?: string) {
  results.push({ testName, passed, expected, actual, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${testName}`);
  if (!passed) {
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual: ${actual}`);
    if (details) console.log(`   Details: ${details}`);
  }
}

// ============================================================================
// TEST 1: Template Lookup for All Combinations
// ============================================================================

async function testTemplateLookups(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 1: Template Lookups');
  console.log('========================================\n');

  const testCases = [
    // High priority documents
    { docType: 'duty_invoice', fromParty: 'customs_broker', expectedVerb: 'Pay Duties', expectedOwner: 'finance', expectedPriority: 85 },
    { docType: 'exception_notice', fromParty: 'ocean_carrier', expectedVerb: 'Investigate Issue', expectedOwner: 'operations', expectedPriority: 85 },
    { docType: 'exception_notice', fromParty: 'customer', expectedVerb: 'Resolve Issue', expectedOwner: 'operations', expectedPriority: 80 },

    // Operations documents
    { docType: 'shipping_instructions', fromParty: 'customer', expectedVerb: 'Submit SI', expectedOwner: 'operations', expectedPriority: 80 },
    { docType: 'booking_request', fromParty: 'customer', expectedVerb: 'Process Booking', expectedOwner: 'operations', expectedPriority: 75 },
    { docType: 'draft_bl', fromParty: 'ocean_carrier', expectedVerb: 'Share for Approval', expectedOwner: 'operations', expectedPriority: 75 },
    { docType: 'draft_bl', fromParty: 'nvocc', expectedVerb: 'Share for Approval', expectedOwner: 'operations', expectedPriority: 75 },

    // Forwarding documents
    { docType: 'arrival_notice', fromParty: 'ocean_carrier', expectedVerb: 'Forward to Customer', expectedOwner: 'operations', expectedPriority: 70 },
    { docType: 'arrival_notice', fromParty: 'nvocc', expectedVerb: 'Forward to Customer', expectedOwner: 'operations', expectedPriority: 70 },
    { docType: 'delivery_order', fromParty: 'ocean_carrier', expectedVerb: 'Forward DO', expectedOwner: 'operations', expectedPriority: 75 },
    { docType: 'delivery_order', fromParty: 'nvocc', expectedVerb: 'Forward DO', expectedOwner: 'operations', expectedPriority: 75 },

    // Invoice documents
    { docType: 'invoice', fromParty: 'ocean_carrier', expectedVerb: 'Process Payment', expectedOwner: 'finance', expectedPriority: 60 },
    { docType: 'invoice', fromParty: 'nvocc', expectedVerb: 'Process Payment', expectedOwner: 'finance', expectedPriority: 60 },
    { docType: 'invoice', fromParty: 'customs_broker', expectedVerb: 'Process Payment', expectedOwner: 'finance', expectedPriority: 65 },

    // Customs documents
    { docType: 'customs_entry', fromParty: 'customs_broker', expectedVerb: 'Review & Share', expectedOwner: 'customs', expectedPriority: 65 },
    { docType: 'entry_summary', fromParty: 'customs_broker', expectedVerb: 'Share with Customer', expectedOwner: 'customs', expectedPriority: 55 },

    // Sales documents
    { docType: 'rate_request', fromParty: 'customer', expectedVerb: 'Quote Rate', expectedOwner: 'sales', expectedPriority: 70 },
  ];

  for (const tc of testCases) {
    const result = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      'Test Subject',
      'Test Body',
      new Date()
    );

    // Test action verb
    logResult(
      `Lookup: ${tc.docType} from ${tc.fromParty} → verb`,
      result.actionVerb === tc.expectedVerb,
      tc.expectedVerb,
      result.actionVerb
    );

    // Test owner
    logResult(
      `Lookup: ${tc.docType} from ${tc.fromParty} → owner`,
      result.owner === tc.expectedOwner,
      tc.expectedOwner,
      result.owner
    );

    // Test base priority (allowing +/-5 for keyword boosts)
    const priorityMatch = Math.abs(result.priority - tc.expectedPriority) <= 5;
    logResult(
      `Lookup: ${tc.docType} from ${tc.fromParty} → priority`,
      priorityMatch,
      String(tc.expectedPriority),
      String(result.priority),
      result.source === 'fallback' ? 'Used fallback' : undefined
    );
  }
}

// ============================================================================
// TEST 2: Priority Calculation with Keywords
// ============================================================================

async function testPriorityWithKeywords(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 2: Priority Boost with Keywords');
  console.log('========================================\n');

  // Test cases with urgency keywords
  const testCases = [
    // Exception notice with delay keyword should boost priority
    {
      docType: 'exception_notice',
      fromParty: 'ocean_carrier',
      subject: 'Shipment DELAY notification',
      body: 'Your shipment has been delayed due to port congestion',
      basePriority: 85,
      boostAmount: 15,
      boostKeywords: ['delay']
    },
    // Rate request with urgent keyword
    {
      docType: 'rate_request',
      fromParty: 'customer',
      subject: 'URGENT Rate Request',
      body: 'Need quote ASAP for shipment next week',
      basePriority: 70,
      boostAmount: 25,
      boostKeywords: ['urgent', 'asap']
    },
    // Booking request with cutoff keyword
    {
      docType: 'booking_request',
      fromParty: 'customer',
      subject: 'Booking Request - cutoff approaching',
      body: 'Please book urgently, cutoff is tomorrow',
      basePriority: 75,
      boostAmount: 20,
      boostKeywords: ['cutoff', 'urgent']
    },
    // Customer exception with problem keyword
    {
      docType: 'exception_notice',
      fromParty: 'customer',
      subject: 'Problem with shipment',
      body: 'We have an issue with the delivery',
      basePriority: 80,
      boostAmount: 20,
      boostKeywords: ['problem', 'issue']
    },
  ];

  for (const tc of testCases) {
    // Test WITHOUT keyword
    const resultWithoutKeyword = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      'Normal subject line',
      'Normal body text without any keywords',
      new Date()
    );

    // Test WITH keyword
    const resultWithKeyword = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      tc.subject,
      tc.body,
      new Date()
    );

    const priorityIncrease = resultWithKeyword.priority - resultWithoutKeyword.priority;
    const expectedIncrease = tc.boostAmount;

    logResult(
      `Keyword boost: ${tc.docType} with "${tc.boostKeywords.join('/')}"`,
      priorityIncrease >= expectedIncrease - 5 && priorityIncrease <= expectedIncrease + 5,
      `+${expectedIncrease}`,
      `+${priorityIncrease}`,
      `Base: ${resultWithoutKeyword.priority}, With keyword: ${resultWithKeyword.priority}`
    );
  }
}

// ============================================================================
// TEST 3: Priority Boost with Cutoff Proximity
// ============================================================================

async function testPriorityWithCutoffProximity(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 3: Priority Boost with Cutoff Proximity');
  console.log('========================================\n');

  const today = new Date();

  // Create shipment contexts with different cutoff dates
  const cutoffTomorrow: ShipmentContext = {
    shipmentId: 'test-1',
    stage: 'SI_STAGE',
    siCutoff: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000), // Tomorrow
  };

  const cutoffIn3Days: ShipmentContext = {
    shipmentId: 'test-2',
    stage: 'SI_STAGE',
    siCutoff: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days
  };

  const cutoffIn7Days: ShipmentContext = {
    shipmentId: 'test-3',
    stage: 'SI_STAGE',
    siCutoff: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
  };

  const noCutoff: ShipmentContext = {
    shipmentId: 'test-4',
    stage: 'SI_STAGE',
  };

  // Test shipping_instructions (uses cutoff)
  const resultNoCutoff = await service.getRecommendation(
    'shipping_instructions', 'customer', 'SI Submitted', 'Please find attached', today, noCutoff
  );

  const resultCutoff7Days = await service.getRecommendation(
    'shipping_instructions', 'customer', 'SI Submitted', 'Please find attached', today, cutoffIn7Days
  );

  const resultCutoff3Days = await service.getRecommendation(
    'shipping_instructions', 'customer', 'SI Submitted', 'Please find attached', today, cutoffIn3Days
  );

  const resultCutoffTomorrow = await service.getRecommendation(
    'shipping_instructions', 'customer', 'SI Submitted', 'Please find attached', today, cutoffTomorrow
  );

  console.log('Cutoff proximity priority progression:');
  console.log(`  No cutoff: ${resultNoCutoff.priority}`);
  console.log(`  7 days: ${resultCutoff7Days.priority}`);
  console.log(`  3 days: ${resultCutoff3Days.priority} (+${resultCutoff3Days.priority - resultCutoff7Days.priority})`);
  console.log(`  1 day: ${resultCutoffTomorrow.priority} (+${resultCutoffTomorrow.priority - resultCutoff3Days.priority})`);

  // Verify priority increases as cutoff approaches
  logResult(
    'Cutoff proximity: 3 days higher than 7 days',
    resultCutoff3Days.priority > resultCutoff7Days.priority,
    'Higher',
    resultCutoff3Days.priority > resultCutoff7Days.priority ? 'Higher' : 'Lower or Equal'
  );

  logResult(
    'Cutoff proximity: 1 day higher than 3 days',
    resultCutoffTomorrow.priority > resultCutoff3Days.priority,
    'Higher',
    resultCutoffTomorrow.priority > resultCutoff3Days.priority ? 'Higher' : 'Lower or Equal'
  );

  // Check priority label escalation
  logResult(
    'Cutoff proximity: 1 day should be URGENT or HIGH',
    ['URGENT', 'HIGH'].includes(resultCutoffTomorrow.priorityLabel),
    'URGENT or HIGH',
    resultCutoffTomorrow.priorityLabel
  );
}

// ============================================================================
// TEST 4: Deadline Calculations
// ============================================================================

async function testDeadlineCalculations(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 4: Deadline Calculations');
  console.log('========================================\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Test fixed_days deadline
  const fixedDaysResult = await service.getRecommendation(
    'duty_invoice', 'customs_broker', 'Duty Invoice', 'Please pay', today
  );

  // Duty invoice has deadline_days = 2
  const expectedFixedDeadline = new Date(today);
  expectedFixedDeadline.setDate(expectedFixedDeadline.getDate() + 2);

  logResult(
    'Deadline: fixed_days (duty_invoice = 2 days)',
    fixedDaysResult.deadline !== null,
    'Has deadline',
    fixedDaysResult.deadline ? 'Has deadline' : 'No deadline'
  );

  if (fixedDaysResult.deadline) {
    const deadlineDiff = Math.round((fixedDaysResult.deadline.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    logResult(
      'Deadline: 2 days from receipt',
      deadlineDiff === 2,
      '2 days',
      `${deadlineDiff} days`,
      `Deadline source: ${fixedDaysResult.deadlineSource}`
    );
  }

  // Test booking_request (1 day deadline)
  const bookingResult = await service.getRecommendation(
    'booking_request', 'customer', 'New Booking', 'Please book', today
  );

  if (bookingResult.deadline) {
    const deadlineDiff = Math.round((bookingResult.deadline.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    logResult(
      'Deadline: fixed_days (booking_request = 1 day)',
      deadlineDiff === 1,
      '1 day',
      `${deadlineDiff} days`
    );
  }

  // Test deadline source text
  logResult(
    'Deadline source: human-readable',
    fixedDaysResult.deadlineSource?.includes('day') || false,
    'Contains "day"',
    fixedDaysResult.deadlineSource || 'null'
  );
}

// ============================================================================
// TEST 5: Fallback Recommendations
// ============================================================================

async function testFallbackRecommendations(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 5: Fallback Recommendations');
  console.log('========================================\n');

  // Test unmapped document types
  const unmappedTypes = [
    { docType: 'tracking_update', fromParty: 'ocean_carrier', expectedAction: false },
    { docType: 'schedule_update', fromParty: 'ocean_carrier', expectedAction: false },
    { docType: 'acknowledgement', fromParty: 'customer', expectedAction: false },
    { docType: 'booking_confirmation', fromParty: 'ocean_carrier', expectedAction: false },
    { docType: 'vgm_confirmation', fromParty: 'ocean_carrier', expectedAction: false },
    { docType: 'pod_proof_of_delivery', fromParty: 'trucker', expectedAction: false },
    { docType: 'unknown_type', fromParty: 'unknown_party', expectedAction: true }, // Default to needs review
  ];

  for (const tc of unmappedTypes) {
    const result = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      'Test Subject',
      'Test Body',
      new Date()
    );

    logResult(
      `Fallback: ${tc.docType} from ${tc.fromParty} → hasAction`,
      result.hasAction === tc.expectedAction,
      String(tc.expectedAction),
      String(result.hasAction),
      `Source: ${result.source}, Type: ${result.actionType}`
    );

    // Verify fallback source
    if (result.source === 'fallback') {
      logResult(
        `Fallback: ${tc.docType} → source is fallback`,
        result.source === 'fallback',
        'fallback',
        result.source
      );
    }
  }
}

// ============================================================================
// TEST 6: Auto-Resolution Logic
// ============================================================================

async function testAutoResolutionLogic(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 6: Auto-Resolution Logic');
  console.log('========================================\n');

  // Test that templates return correct auto-resolve fields
  const testCases = [
    {
      docType: 'draft_bl',
      fromParty: 'ocean_carrier',
      expectedResolveOn: ['approval', 'acknowledgement'],
      expectedResolveKeywords: ['approved', 'ok', 'confirmed', 'proceed']
    },
    {
      docType: 'arrival_notice',
      fromParty: 'ocean_carrier',
      expectedResolveOn: ['acknowledgement'],
      expectedResolveKeywords: ['noted', 'received', 'thanks']
    },
    {
      docType: 'checklist',
      fromParty: 'customs_broker',
      expectedResolveOn: ['acknowledgement', 'shipping_instructions'],
      expectedResolveKeywords: ['attached', 'submitted', 'done']
    },
  ];

  for (const tc of testCases) {
    const result = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      'Test Subject',
      'Test Body',
      new Date()
    );

    // Check auto_resolve_on
    const resolveOnMatch = tc.expectedResolveOn.every(r => result.autoResolveOn.includes(r));
    logResult(
      `Auto-resolve: ${tc.docType} → resolveOn`,
      resolveOnMatch,
      tc.expectedResolveOn.join(', '),
      result.autoResolveOn.join(', ')
    );

    // Check auto_resolve_keywords
    const keywordsMatch = tc.expectedResolveKeywords.every(k => result.autoResolveKeywords.includes(k));
    logResult(
      `Auto-resolve: ${tc.docType} → keywords`,
      keywordsMatch,
      tc.expectedResolveKeywords.join(', '),
      result.autoResolveKeywords.join(', ')
    );
  }
}

// ============================================================================
// TEST 7: Action Type Mapping
// ============================================================================

async function testActionTypeMapping(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 7: Action Type Mapping');
  console.log('========================================\n');

  const actionTypeMappings = [
    { docType: 'duty_invoice', fromParty: 'customs_broker', expectedType: 'pay' },
    { docType: 'invoice', fromParty: 'ocean_carrier', expectedType: 'pay' },
    { docType: 'draft_bl', fromParty: 'ocean_carrier', expectedType: 'approve' },
    { docType: 'shipping_instructions', fromParty: 'customer', expectedType: 'process' },
    { docType: 'booking_request', fromParty: 'customer', expectedType: 'process' },
    { docType: 'rate_request', fromParty: 'customer', expectedType: 'respond' },
    { docType: 'exception_notice', fromParty: 'ocean_carrier', expectedType: 'investigate' },
    { docType: 'arrival_notice', fromParty: 'ocean_carrier', expectedType: 'share' },
    { docType: 'delivery_order', fromParty: 'ocean_carrier', expectedType: 'share' },
    { docType: 'customs_entry', fromParty: 'customs_broker', expectedType: 'review' },
    { docType: 'booking_amendment', fromParty: 'ocean_carrier', expectedType: 'review' },
  ];

  for (const tc of actionTypeMappings) {
    const result = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      'Test Subject',
      'Test Body',
      new Date()
    );

    logResult(
      `Action type: ${tc.docType} from ${tc.fromParty}`,
      result.actionType === tc.expectedType,
      tc.expectedType,
      result.actionType
    );
  }
}

// ============================================================================
// TEST 8: Priority Labels
// ============================================================================

async function testPriorityLabels(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 8: Priority Labels');
  console.log('========================================\n');

  // Test priority label thresholds
  // URGENT >= 85, HIGH >= 70, MEDIUM >= 50, LOW < 50

  const testCases = [
    { docType: 'duty_invoice', fromParty: 'customs_broker', expectedLabel: 'URGENT' }, // base 85
    { docType: 'exception_notice', fromParty: 'ocean_carrier', expectedLabel: 'URGENT' }, // base 85
    { docType: 'shipping_instructions', fromParty: 'customer', expectedLabel: 'HIGH' }, // base 80
    { docType: 'booking_request', fromParty: 'customer', expectedLabel: 'HIGH' }, // base 75
    { docType: 'draft_bl', fromParty: 'ocean_carrier', expectedLabel: 'HIGH' }, // base 75
    { docType: 'rate_request', fromParty: 'customer', expectedLabel: 'HIGH' }, // base 70
    { docType: 'customs_entry', fromParty: 'customs_broker', expectedLabel: 'MEDIUM' }, // base 65
    { docType: 'invoice', fromParty: 'ocean_carrier', expectedLabel: 'MEDIUM' }, // base 60
    { docType: 'entry_summary', fromParty: 'customs_broker', expectedLabel: 'MEDIUM' }, // base 55
  ];

  for (const tc of testCases) {
    const result = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      'Test Subject',
      'Test Body',
      new Date()
    );

    logResult(
      `Priority label: ${tc.docType} (base priority)`,
      result.priorityLabel === tc.expectedLabel,
      tc.expectedLabel,
      result.priorityLabel,
      `Priority score: ${result.priority}`
    );
  }
}

// ============================================================================
// TEST 9: Cross-Validation with Business Rules
// ============================================================================

async function testBusinessRules(service: PreciseActionService) {
  console.log('\n========================================');
  console.log('TEST 9: Business Rule Cross-Validation');
  console.log('========================================\n');

  // Business Rule 1: Financial documents go to finance
  const financeDocs = ['duty_invoice', 'invoice'];
  for (const docType of financeDocs) {
    const result = await service.getRecommendation(docType, 'customs_broker', 'Invoice', 'Pay', new Date());
    logResult(
      `Business Rule: ${docType} → finance team`,
      result.owner === 'finance',
      'finance',
      result.owner
    );
  }

  // Business Rule 2: Customs documents go to customs
  const customsDocs = ['customs_entry', 'entry_summary'];
  for (const docType of customsDocs) {
    const result = await service.getRecommendation(docType, 'customs_broker', 'Customs', 'Entry', new Date());
    logResult(
      `Business Rule: ${docType} → customs team`,
      result.owner === 'customs',
      'customs',
      result.owner
    );
  }

  // Business Rule 3: Rate requests go to sales
  const salesResult = await service.getRecommendation('rate_request', 'customer', 'Quote', 'Need rate', new Date());
  logResult(
    'Business Rule: rate_request → sales team',
    salesResult.owner === 'sales',
    'sales',
    salesResult.owner
  );

  // Business Rule 4: Exceptions are high priority
  const exceptionResult = await service.getRecommendation('exception_notice', 'ocean_carrier', 'Exception', 'Issue', new Date());
  logResult(
    'Business Rule: exception_notice → URGENT priority',
    exceptionResult.priorityLabel === 'URGENT',
    'URGENT',
    exceptionResult.priorityLabel
  );

  // Business Rule 5: Confirmations don't need action (via fallback)
  const confirmationTypes = ['booking_confirmation', 'vgm_confirmation', 'si_confirmation'];
  for (const docType of confirmationTypes) {
    const result = await service.getRecommendation(docType, 'ocean_carrier', 'Confirmed', 'Done', new Date());
    logResult(
      `Business Rule: ${docType} → no action`,
      !result.hasAction,
      'false',
      String(result.hasAction),
      `Source: ${result.source}`
    );
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   PRECISE ACTION SERVICE - COMPREHENSIVE TEST SUITE        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const service = new PreciseActionService(supabase);

  try {
    await testTemplateLookups(service);
    await testPriorityWithKeywords(service);
    await testPriorityWithCutoffProximity(service);
    await testDeadlineCalculations(service);
    await testFallbackRecommendations(service);
    await testAutoResolutionLogic(service);
    await testActionTypeMapping(service);
    await testPriorityLabels(service);
    await testBusinessRules(service);

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST SUMMARY                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Pass Rate: ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n--- FAILED TESTS ---');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`\n❌ ${r.testName}`);
        console.log(`   Expected: ${r.expected}`);
        console.log(`   Actual: ${r.actual}`);
        if (r.details) console.log(`   Details: ${r.details}`);
      });
    }

    return { passed, failed, total };
  } catch (error) {
    console.error('Test execution error:', error);
    throw error;
  }
}

// Run tests
runAllTests()
  .then(summary => {
    console.log('\n✅ Test suite completed');
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  });
