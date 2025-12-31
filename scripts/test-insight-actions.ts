/**
 * Test script for Insight Actions
 *
 * Verifies that patterns with actions are correctly detected
 * and the action structure flows through the pipeline.
 * Also tests the InsightActionExecutor for generating email drafts.
 */

import { createClient } from '@supabase/supabase-js';
import { InsightPatternDetector } from '../lib/services/insight-pattern-detector';
import { InsightContextGatherer } from '../lib/services/insight-context-gatherer';
import { InsightSynthesizer } from '../lib/services/insight-synthesizer';
import { InsightActionExecutor } from '../lib/services/insight-action-executor';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function testInsightActions() {
  console.log('═'.repeat(70));
  console.log('           INSIGHT ACTIONS TEST');
  console.log('═'.repeat(70));
  console.log('');

  // Find a shipment with upcoming cutoffs for good test
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status, workflow_state')
    .in('status', ['booked', 'in_transit'])
    .not('booking_number', 'is', null)
    .limit(5);

  if (shipments === null || shipments.length === 0) {
    console.log('No shipments found');
    return;
  }

  const shipment = shipments[0];
  console.log('Testing shipment:', shipment.booking_number);
  console.log('Status:', shipment.status, '| Workflow:', shipment.workflow_state);
  console.log('');

  // Get context
  const gatherer = new InsightContextGatherer(supabase);
  const context = await gatherer.gatherContext(shipment.id);

  // Detect patterns
  const detector = new InsightPatternDetector();
  const patterns = await detector.detectPatterns(context);

  console.log('Found', patterns.length, 'patterns');
  console.log('─'.repeat(70));
  console.log('');

  // Show patterns WITH actions
  const withActions = patterns.filter(p => p.action);
  const withoutActions = patterns.filter(p => p.action === undefined);

  console.log('PATTERNS WITH ACTIONS (' + withActions.length + '):');
  for (const p of withActions) {
    console.log('');
    console.log('  [' + p.severity.toUpperCase() + '] ' + p.title);
    console.log('  Pattern Code:', p.pattern_code);
    console.log('  Action:', JSON.stringify(p.action, null, 2).replace(/\n/g, '\n         '));
    console.log('  Insight:', p.insight.substring(0, 80) + (p.insight.length > 80 ? '...' : ''));
  }

  console.log('');
  console.log('PATTERNS WITHOUT ACTIONS (' + withoutActions.length + '):');
  for (const p of withoutActions.slice(0, 3)) {
    console.log('  [' + p.severity.toUpperCase() + '] ' + p.title);
  }
  if (withoutActions.length > 3) {
    console.log('  ... and ' + (withoutActions.length - 3) + ' more');
  }

  // Test synthesizer
  console.log('');
  console.log('─'.repeat(70));
  console.log('SYNTHESIZER OUTPUT:');
  console.log('');

  const synthesizer = new InsightSynthesizer();
  const result = synthesizer.synthesizeRulesOnly(patterns);

  console.log('Total insights:', result.insights.length);
  console.log('Priority boost:', result.priority_boost);
  console.log('');

  for (const insight of result.insights.slice(0, 3)) {
    console.log('  [' + insight.severity.toUpperCase() + '] ' + insight.title);
    console.log('    Action (structured):', insight.action ? JSON.stringify(insight.action) : 'none');
    console.log('    Action (text):', insight.action_text || 'none');
    console.log('');
  }

  // Test InsightActionExecutor
  console.log('');
  console.log('─'.repeat(70));
  console.log('ACTION EXECUTOR - DRAFT GENERATION:');
  console.log('');

  const executor = new InsightActionExecutor(supabase);
  const actionableInsights = result.insights
    .filter(i => i.action !== null)
    .map(i => ({
      id: i.id,
      title: i.title,
      description: i.description,
      action: i.action,
    }));

  console.log('Actionable insights:', actionableInsights.length);

  if (actionableInsights.length > 0) {
    console.log('');
    console.log('Generating draft for first actionable insight...');

    // Use override recipient for testing (since shippers don't have emails yet)
    const firstInsight = actionableInsights[0];
    let draft;
    try {
      draft = await executor.generateDraft({
        insightId: firstInsight.id,
        shipmentId: shipment.id,
        action: firstInsight.action!,
        insightTitle: firstInsight.title,
        insightDescription: firstInsight.description,
        overrideRecipient: {
          email: 'shipper@example.com',
          name: 'Demo Shipper',
        },
      });
    } catch (e) {
      console.log('Draft generation error:', e);
      draft = null;
    }

    const drafts = draft ? [draft] : [];

    console.log('Generated', drafts.length, 'draft(s)');
    console.log('');

    for (const draft of drafts) {
      console.log('  Draft ID:', draft.id.substring(0, 12) + '...');
      console.log('  To:', draft.recipientName, '<' + draft.recipientEmail + '>');
      console.log('  Urgency:', draft.urgency);
      console.log('  Subject:', draft.subject);
      console.log('  Template:', draft.templateUsed);
      console.log('');
      console.log('  Body preview:');
      const bodyLines = draft.body.split('\n').slice(0, 10);
      for (const line of bodyLines) {
        console.log('    ' + line);
      }
      if (draft.body.split('\n').length > 10) {
        console.log('    ... (truncated)');
      }
      console.log('');
    }
  }

  console.log('═'.repeat(70));
  console.log('TEST COMPLETE');
}

testInsightActions().catch(console.error);
