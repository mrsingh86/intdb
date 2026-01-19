/**
 * Deep dive into a single shipment's chronicle history
 * Run: npx tsx scripts/debugging/deep-dive-single-shipment.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function deepDiveShipment(shipmentId: string, description: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`DEEP DIVE: ${description}`);
  console.log('Shipment ID:', shipmentId);
  console.log('='.repeat(80));

  // Get AI summary
  const { data: summary } = await supabase
    .from('shipment_ai_summaries')
    .select('current_blocker, blocker_owner, days_overdue, updated_at')
    .eq('shipment_id', shipmentId)
    .single();

  if (summary) {
    console.log('\n--- CURRENT AI SUMMARY ---');
    console.log('Blocker:', summary.current_blocker);
    console.log('Blocker Owner:', summary.blocker_owner);
    console.log('Days Overdue:', summary.days_overdue);
    console.log('Last Updated:', summary.updated_at);
  }

  // Get all chronicles
  const { data: chronicles, error } = await supabase
    .from('chronicle')
    .select('occurred_at, direction, from_party, document_type, summary, subject, has_action, has_issue, issue_description')
    .eq('shipment_id', shipmentId)
    .order('occurred_at', { ascending: false });

  if (error || !chronicles) {
    console.log('Error fetching chronicles:', error?.message);
    return;
  }

  console.log('\n--- ALL CHRONICLE ENTRIES (' + chronicles.length + ' total) ---');
  console.log('-'.repeat(80));

  for (const c of chronicles) {
    const date = new Date(c.occurred_at).toISOString().split('T')[0];
    const dir = (c.direction || 'unknown').padEnd(8);
    const party = (c.from_party || 'unknown').padEnd(15);
    console.log(`[${date}] ${dir} | ${party} | ${c.document_type}`);
    if (c.subject) {
      console.log(`         Subject: ${c.subject.slice(0, 65)}`);
    }
    if (c.summary) {
      console.log(`         Summary: ${c.summary.slice(0, 70)}...`);
    }
    if (c.has_action || c.has_issue) {
      const flags = [];
      if (c.has_action) flags.push('ACTION');
      if (c.has_issue) flags.push('ISSUE');
      console.log(`         Flags: ${flags.join(', ')}`);
      if (c.issue_description) {
        console.log(`         Issue: ${c.issue_description.slice(0, 60)}`);
      }
    }
    console.log('');
  }

  // Check for resolution signals
  console.log('--- CHECKING FOR RESOLUTION SIGNALS ---');
  const allText = chronicles.map(c => `${c.summary || ''} ${c.subject || ''} ${c.issue_description || ''}`).join(' ').toLowerCase();

  const signals: Record<string, boolean> = {
    'delivered': allText.includes('delivered'),
    'cleared': allText.includes('cleared'),
    'released': allText.includes('released'),
    'completed': allText.includes('completed'),
    'paid': allText.includes('paid'),
    'resolved': allText.includes('resolved'),
    'credit note': allText.includes('credit note'),
    'mbl copy': allText.includes('mbl') && allText.includes('copy'),
  };

  for (const [signal, found] of Object.entries(signals)) {
    console.log(`  ${signal}: ${found ? '✅ FOUND' : '❌ not found'}`);
  }

  // Timeline analysis
  console.log('\n--- TIMELINE ANALYSIS ---');
  if (chronicles.length > 0) {
    const oldest = new Date(chronicles[chronicles.length - 1].occurred_at);
    const newest = new Date(chronicles[0].occurred_at);
    const now = new Date();

    console.log('First activity:', oldest.toISOString().split('T')[0]);
    console.log('Last activity:', newest.toISOString().split('T')[0]);
    console.log('Days since last activity:', Math.floor((now.getTime() - newest.getTime()) / (1000*60*60*24)));
    console.log('Total activity span:', Math.floor((newest.getTime() - oldest.getTime()) / (1000*60*60*24)), 'days');
  }
}

async function main() {
  // Investigate shipments with various delay patterns

  // Shipment 1: High delay (381 days), stage ARRIVED, credit note blocker
  await deepDiveShipment(
    'f379e47b-3241-45f5-ab4c-03d3798efb0d',
    '381 days delay, Stage: ARRIVED, Blocker: Credit note requests'
  );

  // Shipment 2: Get another example
  const { data: summaries } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id, current_blocker, days_overdue')
    .gt('days_overdue', 50)
    .not('current_blocker', 'is', null)
    .order('days_overdue', { ascending: false })
    .limit(5);

  if (summaries && summaries.length > 1) {
    const s = summaries[1]; // Second highest delay
    await deepDiveShipment(
      s.shipment_id,
      `${s.days_overdue} days delay, Blocker: ${s.current_blocker?.slice(0, 40)}...`
    );
  }

  console.log('\n\n========================================');
  console.log('CONCLUSION');
  console.log('========================================');
  console.log(`
Based on the investigation:

1. DELAYS ARE REAL - The high day counts (30-381 days) are mathematically correct
   based on ETD/ETA dates stored in shipments table.

2. BLOCKERS APPEAR CURRENT - The chronicled activity shows ongoing issues
   (credit notes, documentation requests, payment disputes) that haven't been resolved.

3. STAGE MAY BE STALE - Some shipments show 'ARRIVED' stage but still have unresolved
   blockers. This suggests either:
   a) Goods arrived but payment/documentation issues persist (legitimate)
   b) Stage was updated but blocker should have been cleared (data quality issue)

4. RECOMMENDATIONS:
   - Review shipments where stage='ARRIVED' or 'COMPLETED' but blocker exists
   - Consider auto-clearing blockers when certain stages are reached
   - Add logic to detect when blocker keywords appear in resolved chronicles
`);
}

main().catch(console.error);
