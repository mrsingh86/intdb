#!/usr/bin/env npx tsx
/**
 * Backfill Intelligence Tables
 *
 * Extracts AI intelligence (sentiment, urgency, actions) from emails
 * and aggregates into shipment-level rollups.
 *
 * Usage:
 *   npx tsx scripts/backfill-intelligence.ts --limit 100
 *   npx tsx scripts/backfill-intelligence.ts --limit 100 --quick    # No AI, keyword-based
 *   npx tsx scripts/backfill-intelligence.ts --shipments-only       # Only aggregate shipments
 *   npx tsx scripts/backfill-intelligence.ts --force                # Reprocess existing
 *
 * Cost: ~$0.0005/email with AI (Haiku)
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  createEmailIntelligenceService,
  createShipmentIntelligenceService,
} from '../lib/services/intelligence';

// Parse args
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf('--limit') + 1] || '50') : 50;
const useQuick = args.includes('--quick');
const shipmentsOnly = args.includes('--shipments-only');
const forceReprocess = args.includes('--force');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function backfillEmailIntelligence() {
  console.log('=== Backfill Email Intelligence ===\n');
  console.log(`Mode: ${useQuick ? 'Quick (keyword-based, $0)' : 'AI (Haiku, ~$0.0005/email)'}`);
  console.log(`Limit: ${limit} emails`);
  console.log(`Force reprocess: ${forceReprocess}\n`);

  const emailIntelService = createEmailIntelligenceService(supabase);

  // Get emails that need intelligence extraction
  // Prioritize emails that have entity extractions (already processed)
  let query = supabase
    .from('raw_emails')
    .select('id')
    .eq('processing_status', 'processed')
    .order('created_at', { ascending: false })
    .limit(limit);

  // If not forcing, exclude already processed
  if (!forceReprocess) {
    const { data: existingIds } = await supabase
      .from('email_intelligence')
      .select('email_id');

    if (existingIds && existingIds.length > 0) {
      const excludeIds = existingIds.map(e => e.email_id);
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }
  }

  const { data: emails, error } = await query;

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No emails to process.');
    return;
  }

  console.log(`Found ${emails.length} emails to process\n`);

  // Process emails
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    try {
      const result = await emailIntelService.extractIntelligence(email.id, {
        useQuickAnalysis: useQuick,
        forceReprocess,
      });

      if (result) {
        processed++;
        const progress = `[${i + 1}/${emails.length}]`;
        const sentiment = result.sentiment.padEnd(10);
        const urgency = result.urgency.padEnd(8);
        const action = result.has_action ? 'ACTION' : '      ';
        console.log(`${progress} ${email.id.substring(0, 8)} | ${sentiment} | ${urgency} | ${action}`);
      } else {
        skipped++;
      }

      // Rate limit for AI calls
      if (!useQuick && processed % 10 === 0) {
        await sleep(1000);
      }
    } catch (err) {
      errors++;
      console.error(`Error processing ${email.id}:`, err);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const estimatedCost = useQuick ? 0 : (processed * 0.0005);

  console.log('\n=== Email Intelligence Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);

  return processed;
}

async function backfillShipmentIntelligence() {
  console.log('\n=== Backfill Shipment Intelligence ===\n');

  const shipmentIntelService = createShipmentIntelligenceService(supabase);

  // Get unique shipment IDs from email_intelligence
  const { data: shipmentRows } = await supabase
    .from('email_intelligence')
    .select('shipment_id')
    .not('shipment_id', 'is', null);

  if (!shipmentRows || shipmentRows.length === 0) {
    console.log('No shipments with email intelligence to aggregate.');
    return;
  }

  const shipmentIds = [...new Set(shipmentRows.map(s => s.shipment_id))];
  console.log(`Found ${shipmentIds.length} shipments to aggregate\n`);

  let updated = 0;
  let errors = 0;

  for (const shipmentId of shipmentIds) {
    try {
      const result = await shipmentIntelService.updateShipmentIntelligence(shipmentId);
      if (result) {
        updated++;
        const attention = result.needs_attention ? 'ATTENTION' : '         ';
        const actions = `${result.open_actions} actions`;
        console.log(`${shipmentId.substring(0, 8)} | ${attention} | ${actions} | ${result.status_summary?.substring(0, 40) || ''}`);
      }
    } catch (err) {
      errors++;
      console.error(`Error aggregating ${shipmentId}:`, err);
    }
  }

  console.log('\n=== Shipment Intelligence Summary ===');
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);
}

async function showStats() {
  console.log('\n=== Current Intelligence Stats ===\n');

  // Email intelligence stats
  const { count: emailIntelCount } = await supabase
    .from('email_intelligence')
    .select('*', { count: 'exact', head: true });

  const { data: sentimentStats } = await supabase
    .from('email_intelligence')
    .select('sentiment')
    .then(({ data }) => {
      const counts: Record<string, number> = {};
      data?.forEach(row => {
        counts[row.sentiment] = (counts[row.sentiment] || 0) + 1;
      });
      return { data: counts };
    });

  const { data: urgencyStats } = await supabase
    .from('email_intelligence')
    .select('urgency')
    .then(({ data }) => {
      const counts: Record<string, number> = {};
      data?.forEach(row => {
        counts[row.urgency] = (counts[row.urgency] || 0) + 1;
      });
      return { data: counts };
    });

  const { count: withActions } = await supabase
    .from('email_intelligence')
    .select('*', { count: 'exact', head: true })
    .eq('has_action', true);

  console.log('Email Intelligence:');
  console.log(`  Total: ${emailIntelCount || 0}`);
  console.log(`  With actions: ${withActions || 0}`);
  console.log('  Sentiment distribution:', sentimentStats);
  console.log('  Urgency distribution:', urgencyStats);

  // Shipment intelligence stats
  const { count: shipmentIntelCount } = await supabase
    .from('shipment_intelligence')
    .select('*', { count: 'exact', head: true });

  const { count: needsAttention } = await supabase
    .from('shipment_intelligence')
    .select('*', { count: 'exact', head: true })
    .eq('needs_attention', true);

  console.log('\nShipment Intelligence:');
  console.log(`  Total: ${shipmentIntelCount || 0}`);
  console.log(`  Needs attention: ${needsAttention || 0}`);

  // Coverage
  const { count: totalProcessedEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('processing_status', 'processed');

  const coverage = totalProcessedEmails ? ((emailIntelCount || 0) / totalProcessedEmails * 100).toFixed(1) : 0;
  console.log(`\nCoverage: ${emailIntelCount || 0}/${totalProcessedEmails || 0} emails (${coverage}%)`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (shipmentsOnly) {
    await backfillShipmentIntelligence();
  } else {
    const processed = await backfillEmailIntelligence();
    if (processed && processed > 0) {
      await backfillShipmentIntelligence();
    }
  }

  await showStats();
}

main().catch(console.error);
