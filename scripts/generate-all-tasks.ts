#!/usr/bin/env npx tsx
/**
 * Generate All Tasks - Master Script
 *
 * Runs all task generation scripts in sequence:
 * 1. Deadline tasks (upcoming deadlines within 7 days)
 * 2. Overdue deadline tasks (past deadlines requiring verification)
 * 3. Document tasks (review documents that were received)
 * 4. Notification tasks (respond to notifications)
 * 5. Workflow tasks (based on shipment state)
 * 6. Missing document tasks (obtain missing documents)
 *
 * This is the comprehensive task generation pipeline
 */

import dotenv from 'dotenv';
dotenv.config();

import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SCRIPTS = [
  {
    name: 'Deadline Tasks',
    script: 'scripts/generate-deadline-tasks.ts',
    description: 'Generate tasks for upcoming deadlines (SI, VGM, cargo, gate cutoffs)',
  },
  {
    name: 'Overdue Deadline Tasks',
    script: 'scripts/generate-overdue-deadline-tasks.ts',
    description: 'Generate tasks for past deadlines requiring verification',
  },
  {
    name: 'Document Tasks',
    script: 'scripts/generate-document-tasks.ts',
    description: 'Generate tasks to review received documents',
  },
  {
    name: 'Notification Tasks',
    script: 'scripts/generate-notification-tasks.ts',
    description: 'Generate tasks to respond to notifications',
  },
  {
    name: 'Workflow Tasks',
    script: 'scripts/generate-workflow-tasks.ts',
    description: 'Generate tasks based on shipment workflow state',
  },
  {
    name: 'Missing Document Tasks',
    script: 'scripts/generate-missing-document-tasks.ts',
    description: 'Generate tasks to obtain missing documents',
  },
];

async function getInitialStats() {
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: totalTasks } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });

  const { data: tasksData } = await supabase
    .from('action_tasks')
    .select('shipment_id');

  const shipmentsWithTasks = new Set(tasksData?.map(t => t.shipment_id).filter(Boolean) || []);

  return {
    totalShipments: totalShipments || 0,
    totalTasks: totalTasks || 0,
    shipmentsWithTasks: shipmentsWithTasks.size,
    coverage: totalShipments ? ((shipmentsWithTasks.size / totalShipments) * 100).toFixed(1) : '0.0',
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE ALL TASKS - MASTER PIPELINE                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get initial stats
  console.log('Initial State:');
  const initialStats = await getInitialStats();
  console.log(`  Total shipments: ${initialStats.totalShipments}`);
  console.log(`  Total tasks: ${initialStats.totalTasks}`);
  console.log(`  Shipments with tasks: ${initialStats.shipmentsWithTasks} (${initialStats.coverage}%)`);
  console.log('');

  // Run each script
  for (let i = 0; i < SCRIPTS.length; i++) {
    const script = SCRIPTS[i];
    console.log('════════════════════════════════════════════════════════════════════');
    console.log(`STEP ${i + 1}/${SCRIPTS.length}: ${script.name}`);
    console.log(`Description: ${script.description}`);
    console.log('════════════════════════════════════════════════════════════════════\n');

    try {
      execSync(`npx tsx ${script.script}`, {
        stdio: 'inherit',
        env: process.env,
      });
      console.log('');
    } catch (error) {
      console.error(`\n✗ Error running ${script.name}:`, error);
      console.log('Continuing with next script...\n');
    }
  }

  // Get final stats
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          FINAL RESULTS                                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const finalStats = await getInitialStats();
  console.log('Final State:');
  console.log(`  Total shipments: ${finalStats.totalShipments}`);
  console.log(`  Total tasks: ${finalStats.totalTasks}`);
  console.log(`  Shipments with tasks: ${finalStats.shipmentsWithTasks} (${finalStats.coverage}%)`);
  console.log('');

  const tasksAdded = finalStats.totalTasks - initialStats.totalTasks;
  const shipmentsAdded = finalStats.shipmentsWithTasks - initialStats.shipmentsWithTasks;
  const coverageIncrease = (parseFloat(finalStats.coverage) - parseFloat(initialStats.coverage)).toFixed(1);

  console.log('Impact:');
  console.log(`  Tasks added: ${tasksAdded}`);
  console.log(`  Additional shipments covered: ${shipmentsAdded}`);
  console.log(`  Coverage increase: ${coverageIncrease}%`);
  console.log('');

  // Show task distribution
  const { data: taskStats } = await supabase
    .from('action_tasks')
    .select('priority, category, status');

  const priorityCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};

  taskStats?.forEach(t => {
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });

  console.log('Task Distribution:');
  console.log('');

  console.log('By Priority:');
  Object.entries(priorityCounts)
    .sort((a, b) => {
      const order = { critical: 4, high: 3, medium: 2, low: 1 };
      return (order[b[0] as keyof typeof order] || 0) - (order[a[0] as keyof typeof order] || 0);
    })
    .forEach(([p, c]) => {
      const percentage = ((c / finalStats.totalTasks) * 100).toFixed(1);
      console.log(`  ${p.padEnd(10)}: ${String(c).padStart(4)} (${percentage}%)`);
    });

  console.log('');
  console.log('By Category:');
  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, count]) => {
      const percentage = ((count / finalStats.totalTasks) * 100).toFixed(1);
      console.log(`  ${c.padEnd(15)}: ${String(count).padStart(4)} (${percentage}%)`);
    });

  console.log('');
  console.log('By Status:');
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => {
      const percentage = ((c / finalStats.totalTasks) * 100).toFixed(1);
      console.log(`  ${s.padEnd(12)}: ${String(c).padStart(4)} (${percentage}%)`);
    });

  console.log('');

  // Goal check
  const goalCoverage = 50;
  if (parseFloat(finalStats.coverage) >= goalCoverage) {
    console.log(`✓ SUCCESS: Achieved ${finalStats.coverage}% coverage (goal: ${goalCoverage}%)`);
  } else {
    console.log(`⚠ PROGRESS: ${finalStats.coverage}% coverage (goal: ${goalCoverage}%)`);
    console.log(`  Need ${goalCoverage - parseFloat(finalStats.coverage)}% more coverage to reach goal`);
  }
}

main().catch(console.error);
