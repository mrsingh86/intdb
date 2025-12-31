#!/usr/bin/env npx tsx
/**
 * Generate Overdue Deadline Tasks
 *
 * Creates action_tasks for deadlines that have ALREADY PASSED:
 * - Past SI cutoff → follow up on SI submission
 * - Past VGM cutoff → verify VGM was submitted
 * - Past cargo cutoff → verify cargo was delivered
 * - Past gate cutoff → verify gate-in completed
 *
 * These are follow-up tasks to ensure past deadlines were met
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

interface OverdueDeadlineConfig {
  deadlineField: 'si_cutoff' | 'vgm_cutoff' | 'cargo_cutoff' | 'gate_cutoff';
  templateCode: string;
  title: (booking: string, daysOverdue: number) => string;
  description: string;
  category: string;
  basePriority: string;
  verificationDocType?: string; // Optional document type to check if deadline was met
}

const OVERDUE_DEADLINE_CONFIGS: OverdueDeadlineConfig[] = [
  {
    deadlineField: 'si_cutoff',
    templateCode: 'verify_si_submission_overdue',
    title: (booking: string, days: number) => `Verify SI Submission for ${booking} (${days}d overdue)`,
    description: 'SI cutoff has passed - verify shipping instructions were submitted on time',
    category: 'compliance',
    basePriority: 'high',
    verificationDocType: 'shipping_instruction',
  },
  {
    deadlineField: 'vgm_cutoff',
    templateCode: 'verify_vgm_submission_overdue',
    title: (booking: string, days: number) => `Verify VGM Submission for ${booking} (${days}d overdue)`,
    description: 'VGM cutoff has passed - verify VGM was submitted and cargo can load',
    category: 'compliance',
    basePriority: 'critical',
    verificationDocType: 'vgm_confirmation',
  },
  {
    deadlineField: 'cargo_cutoff',
    templateCode: 'verify_cargo_delivery_overdue',
    title: (booking: string, days: number) => `Verify Cargo Delivery for ${booking} (${days}d overdue)`,
    description: 'Cargo cutoff has passed - verify cargo was delivered to port on time',
    category: 'operational',
    basePriority: 'critical',
  },
  {
    deadlineField: 'gate_cutoff',
    templateCode: 'verify_gate_in_overdue',
    title: (booking: string, days: number) => `Verify Gate-In for ${booking} (${days}d overdue)`,
    description: 'Gate cutoff has passed - verify container gate-in was completed',
    category: 'operational',
    basePriority: 'critical',
  },
];

function calculatePriorityScore(
  basePriority: string,
  daysOverdue: number,
  hasVerificationDoc: boolean,
  deadlineType: string
): { score: number; priority: string; factors: Record<string, unknown> } {
  // Overdue urgency (0-35 points) - MORE overdue = MORE urgent
  let overdueScore = 0;
  let overdueReason = '';

  if (daysOverdue >= 10) {
    overdueScore = 35;
    overdueReason = `CRITICAL: ${daysOverdue} days overdue`;
  } else if (daysOverdue >= 7) {
    overdueScore = 30;
    overdueReason = `${daysOverdue} days overdue`;
  } else if (daysOverdue >= 5) {
    overdueScore = 25;
    overdueReason = `${daysOverdue} days overdue`;
  } else if (daysOverdue >= 3) {
    overdueScore = 20;
    overdueReason = `${daysOverdue} days overdue`;
  } else if (daysOverdue >= 1) {
    overdueScore = 15;
    overdueReason = `${daysOverdue} days overdue`;
  } else {
    overdueScore = 10;
    overdueReason = 'Recently passed';
  }

  // Deadline type severity (0-20 points)
  let severityScore = 0;
  let severityReason = '';
  const criticalDeadlines = ['vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

  if (criticalDeadlines.includes(deadlineType)) {
    severityScore = 20;
    severityReason = 'Critical operational deadline';
  } else {
    severityScore = 15;
    severityReason = 'Important documentation deadline';
  }

  // Verification status (0-15 points) - if we don't have confirmation doc, it's more urgent
  let verificationScore = 0;
  let verificationReason = '';

  if (!hasVerificationDoc) {
    verificationScore = 15;
    verificationReason = 'No verification document found - high risk';
  } else {
    verificationScore = 0;
    verificationReason = 'Verification document exists - likely met';
  }

  // Base priority score (0-15 points)
  let basePriorityScore = 0;
  if (basePriority === 'critical') basePriorityScore = 15;
  else if (basePriority === 'high') basePriorityScore = 11;
  else if (basePriority === 'medium') basePriorityScore = 7;
  else basePriorityScore = 3;

  // Total score
  const totalScore = overdueScore + severityScore + verificationScore + basePriorityScore;

  // Determine priority level
  let priority = 'low';
  if (totalScore >= 70) priority = 'critical';
  else if (totalScore >= 50) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';

  return {
    score: totalScore,
    priority,
    factors: {
      deadline_urgency: { score: overdueScore, max: 35, reason: overdueReason },
      financial_impact: { score: severityScore, max: 20, reason: severityReason },
      document_criticality: { score: verificationScore, max: 15, reason: verificationReason },
      notification_severity: { score: basePriorityScore, max: 15, reason: `Base priority: ${basePriority}` },
      stakeholder_importance: { score: 5, max: 15, reason: 'Standard shipment' },
    },
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE OVERDUE DEADLINE TASKS                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const now = new Date();

  // Get existing tasks to avoid duplicates
  const { data: existingTasks } = await supabase
    .from('action_tasks')
    .select('shipment_id, template_code');

  const existingTaskSet = new Set(
    existingTasks?.map(t => `${t.shipment_id}:${t.template_code}`) || []
  );

  console.log(`Existing tasks: ${existingTasks?.length || 0}\n`);

  let tasksCreated = 0;
  let tasksSkipped = 0;

  for (const config of OVERDUE_DEADLINE_CONFIGS) {
    console.log(`Checking overdue ${config.deadlineField}...`);

    // Get shipments with past deadlines for this field
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, booking_number, bl_number, ' + config.deadlineField)
      .not(config.deadlineField, 'is', null)
      .lt(config.deadlineField, now.toISOString());

    if (!shipments || shipments.length === 0) {
      console.log(`  No overdue ${config.deadlineField} found\n`);
      continue;
    }

    console.log(`  Found ${shipments.length} shipments with overdue ${config.deadlineField}`);

    // If there's a verification document type, get shipments that have it
    let shipmentsWithVerification = new Set<string>();
    if (config.verificationDocType) {
      const { data: verificationDocs } = await supabase
        .from('shipment_documents')
        .select('shipment_id')
        .eq('document_type', config.verificationDocType)
        .in('shipment_id', shipments.map(s => s.id));

      shipmentsWithVerification = new Set(verificationDocs?.map(d => d.shipment_id) || []);
      console.log(`  ${shipmentsWithVerification.size} have ${config.verificationDocType} (likely met deadline)`);
    }

    for (const shipment of shipments) {
      const taskKey = `${shipment.id}:${config.templateCode}`;

      // Skip if task already exists
      if (existingTaskSet.has(taskKey)) {
        tasksSkipped++;
        continue;
      }

      // Calculate how many days overdue
      const deadlineDate = new Date(shipment[config.deadlineField]);
      const daysOverdue = Math.ceil((now.getTime() - deadlineDate.getTime()) / (1000 * 60 * 60 * 24));

      // Check if we have verification document
      const hasVerificationDoc = config.verificationDocType
        ? shipmentsWithVerification.has(shipment.id)
        : false;

      // Calculate due date (urgent - 1 day to verify)
      const dueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Calculate priority
      const { score, priority, factors } = calculatePriorityScore(
        config.basePriority,
        daysOverdue,
        hasVerificationDoc,
        config.deadlineField
      );

      const bookingRef = shipment.booking_number || shipment.bl_number || 'Unknown';

      // Create task
      const { error } = await supabase
        .from('action_tasks')
        .insert({
          template_code: config.templateCode,
          shipment_id: shipment.id,
          title: config.title(bookingRef, daysOverdue),
          description: config.description,
          category: config.category,
          priority,
          priority_score: score,
          priority_factors: factors,
          due_date: dueDate.toISOString(),
          status: 'pending',
        });

      if (!error) {
        tasksCreated++;
        existingTaskSet.add(taskKey);
        const verificationStatus = hasVerificationDoc ? '✓ has verification' : '⚠ no verification';
        console.log(`  ✓ Created ${config.templateCode} task for ${bookingRef} (${daysOverdue}d overdue, ${verificationStatus})`);
      } else {
        console.error(`  ✗ Error creating task: ${error.message}`);
      }
    }

    console.log('');
  }

  // Final stats
  console.log('════════════════════════════════════════════════════════════════════');
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
    .select('priority, category, status');

  const priorityCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};

  taskStats?.forEach(t => {
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  });

  console.log('\nTasks by Priority:');
  Object.entries(priorityCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, c]) => console.log(`  ${p}: ${c}`));

  console.log('\nTasks by Category:');
  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, count]) => console.log(`  ${c}: ${count}`));
}

main().catch(console.error);
