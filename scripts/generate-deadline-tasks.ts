#!/usr/bin/env npx tsx
/**
 * Generate Deadline Tasks
 *
 * Creates action_tasks for shipments with approaching deadlines:
 * - SI cutoff
 * - VGM cutoff
 * - Cargo cutoff
 * - Gate cutoff
 *
 * Tasks are generated for deadlines within the next 7 days.
 * Avoids duplicates by checking existing tasks per shipment + deadline type.
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Deadline type configurations
const DEADLINE_CONFIGS = {
  si_cutoff: {
    templateCode: 'si_cutoff_deadline',
    title: (booking: string) => `Submit SI for ${booking}`,
    description: 'Submit shipping instruction before cutoff deadline',
    category: 'deadline',
    basePriority: 'high',
  },
  vgm_cutoff: {
    templateCode: 'vgm_cutoff_deadline',
    title: (booking: string) => `Submit VGM for ${booking}`,
    description: 'Submit Verified Gross Mass declaration before cutoff',
    category: 'deadline',
    basePriority: 'high',
  },
  cargo_cutoff: {
    templateCode: 'cargo_cutoff_deadline',
    title: (booking: string) => `Deliver Cargo for ${booking}`,
    description: 'Ensure cargo delivery to port before cutoff',
    category: 'deadline',
    basePriority: 'critical',
  },
  gate_cutoff: {
    templateCode: 'gate_cutoff_deadline',
    title: (booking: string) => `Gate-in for ${booking}`,
    description: 'Complete gate-in at terminal before cutoff',
    category: 'deadline',
    basePriority: 'critical',
  },
};

type DeadlineType = keyof typeof DEADLINE_CONFIGS;

function calculatePriorityScore(
  deadline: Date,
  basePriority: string
): { score: number; priority: string; factors: Record<string, unknown> } {
  const now = new Date();
  const hoursUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Deadline urgency (0-35 points)
  let deadlineScore = 0;
  let deadlineReason = '';
  if (hoursUntil < 0) {
    deadlineScore = 35;
    deadlineReason = 'OVERDUE';
  } else if (hoursUntil < 24) {
    deadlineScore = 35;
    deadlineReason = 'Due within 24 hours';
  } else if (hoursUntil < 48) {
    deadlineScore = 30;
    deadlineReason = 'Due within 48 hours';
  } else if (hoursUntil < 72) {
    deadlineScore = 25;
    deadlineReason = 'Due within 3 days';
  } else if (hoursUntil < 168) {
    deadlineScore = 15;
    deadlineReason = 'Due within 7 days';
  } else {
    deadlineScore = 5;
    deadlineReason = 'Due later';
  }

  // Base priority score (0-15 points)
  let basePriorityScore = 0;
  if (basePriority === 'critical') basePriorityScore = 15;
  else if (basePriority === 'high') basePriorityScore = 11;
  else if (basePriority === 'medium') basePriorityScore = 7;
  else basePriorityScore = 3;

  // Total score
  const totalScore = deadlineScore + basePriorityScore + 20; // +20 base points

  // Determine priority level
  let priority = 'low';
  if (totalScore >= 65) priority = 'critical';
  else if (totalScore >= 50) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';

  return {
    score: totalScore,
    priority,
    factors: {
      deadline_urgency: { score: deadlineScore, max: 35, reason: deadlineReason },
      notification_severity: { score: basePriorityScore, max: 15, reason: `Base priority: ${basePriority}` },
      financial_impact: { score: 10, max: 20, reason: 'Shipment deadline' },
      stakeholder_importance: { score: 5, max: 15, reason: 'Standard shipment' },
      historical_pattern: { score: 5, max: 10, reason: 'No historical context' },
    },
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE DEADLINE TASKS                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  console.log(`Checking deadlines from ${now.toISOString()} to ${sevenDaysLater.toISOString()}\n`);

  // Get existing tasks to avoid duplicates
  const { data: existingTasks } = await supabase
    .from('action_tasks')
    .select('shipment_id, template_code');

  const existingTaskSet = new Set(
    existingTasks?.map(t => `${t.shipment_id}:${t.template_code}`) || []
  );

  console.log(`Existing tasks: ${existingTasks?.length || 0}`);

  // Get shipments with cutoffs
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff')
    .or('si_cutoff.not.is.null,vgm_cutoff.not.is.null,cargo_cutoff.not.is.null,gate_cutoff.not.is.null');

  if (!shipments || shipments.length === 0) {
    console.log('No shipments with cutoffs found');
    return;
  }

  console.log(`Shipments with cutoffs: ${shipments.length}`);

  let tasksCreated = 0;
  let tasksSkipped = 0;

  for (const shipment of shipments) {
    const deadlineTypes: DeadlineType[] = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

    for (const deadlineType of deadlineTypes) {
      const cutoffValue = shipment[deadlineType];
      if (!cutoffValue) continue;

      const cutoffDate = new Date(cutoffValue);
      const config = DEADLINE_CONFIGS[deadlineType];
      const taskKey = `${shipment.id}:${config.templateCode}`;

      // Skip if task already exists
      if (existingTaskSet.has(taskKey)) {
        tasksSkipped++;
        continue;
      }

      // Skip if deadline is past or too far in future
      if (cutoffDate < now || cutoffDate > sevenDaysLater) {
        continue;
      }

      // Calculate priority
      const { score, priority, factors } = calculatePriorityScore(
        cutoffDate,
        config.basePriority
      );

      // Create task
      const { error } = await supabase
        .from('action_tasks')
        .insert({
          template_code: config.templateCode,
          shipment_id: shipment.id,
          title: config.title(shipment.booking_number || 'Unknown'),
          description: config.description,
          category: config.category,
          priority,
          priority_score: score,
          priority_factors: factors,
          due_date: cutoffDate.toISOString(),
          status: 'pending',
        });

      if (!error) {
        tasksCreated++;
        existingTaskSet.add(taskKey);
        console.log(`✓ Created ${deadlineType} task for ${shipment.booking_number}`);
      }
    }
  }

  // Final stats
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`Tasks created: ${tasksCreated}`);
  console.log(`Tasks skipped (already exist): ${tasksSkipped}`);

  const { count: finalTaskCount } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal action_tasks: ${finalTaskCount}`);

  // Show task distribution
  const { data: taskStats } = await supabase
    .from('action_tasks')
    .select('priority, status');

  const priorityCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};

  taskStats?.forEach(t => {
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });

  console.log('\nTasks by Priority:');
  Object.entries(priorityCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, c]) => console.log(`  ${p}: ${c}`));

  console.log('\nTasks by Status:');
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => console.log(`  ${s}: ${c}`));
}

main().catch(console.error);
