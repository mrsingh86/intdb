#!/usr/bin/env npx tsx
/**
 * Generate Workflow State Tasks
 *
 * Creates action_tasks based on shipment workflow state:
 * - Booked shipments → prepare SI, arrange cargo
 * - In-transit shipments → track milestones, prepare arrival
 * - Arrived shipments → arrange clearance, track delivery
 *
 * Tasks are generated based on expected milestones for each state
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

interface WorkflowTaskConfig {
  status: string;
  condition: (shipment: any) => boolean;
  templateCode: string;
  title: (booking: string) => string;
  description: string;
  category: string;
  basePriority: string;
  daysToComplete: number;
}

const WORKFLOW_TASK_CONFIGS: WorkflowTaskConfig[] = [
  // Booked shipment tasks
  {
    status: 'booked',
    condition: (s) => !s.etd || (new Date(s.etd) > new Date()),
    templateCode: 'prepare_cargo_booked',
    title: (booking: string) => `Prepare Cargo for ${booking}`,
    description: 'Arrange cargo preparation, packing, and documentation for upcoming shipment',
    category: 'operational',
    basePriority: 'medium',
    daysToComplete: 5,
  },
  {
    status: 'booked',
    condition: (s) => s.etd && new Date(s.etd) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    templateCode: 'arrange_cargo_delivery_booked',
    title: (booking: string) => `Arrange Cargo Delivery for ${booking}`,
    description: 'Coordinate cargo delivery to port/terminal before cutoff',
    category: 'operational',
    basePriority: 'high',
    daysToComplete: 3,
  },

  // In-transit shipment tasks
  {
    status: 'in_transit',
    condition: (s) => s.eta && new Date(s.eta) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    templateCode: 'prepare_arrival_in_transit',
    title: (booking: string) => `Prepare for Arrival - ${booking}`,
    description: 'Prepare for shipment arrival: arrange clearance, notify consignee, prepare documents',
    category: 'operational',
    basePriority: 'high',
    daysToComplete: 3,
  },
  {
    status: 'in_transit',
    condition: (s) => s.eta && new Date(s.eta) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    templateCode: 'notify_consignee_arrival',
    title: (booking: string) => `Notify Consignee of Arrival - ${booking}`,
    description: 'Notify consignee of upcoming arrival and provide clearance information',
    category: 'communication',
    basePriority: 'high',
    daysToComplete: 1,
  },
  {
    status: 'in_transit',
    condition: (s) => !s.bl_number,
    templateCode: 'follow_up_bl_in_transit',
    title: (booking: string) => `Follow Up BL for ${booking}`,
    description: 'Follow up with carrier to obtain Bill of Lading for in-transit shipment',
    category: 'document',
    basePriority: 'high',
    daysToComplete: 2,
  },

  // Arrived shipment tasks
  {
    status: 'arrived',
    condition: (s) => true,
    templateCode: 'arrange_clearance_arrived',
    title: (booking: string) => `Arrange Customs Clearance - ${booking}`,
    description: 'Coordinate customs clearance and cargo release from port',
    category: 'operational',
    basePriority: 'critical',
    daysToComplete: 2,
  },
  {
    status: 'arrived',
    condition: (s) => true,
    templateCode: 'track_delivery_arrived',
    title: (booking: string) => `Track Delivery - ${booking}`,
    description: 'Track cargo delivery to final destination and obtain POD',
    category: 'operational',
    basePriority: 'high',
    daysToComplete: 3,
  },
];

function calculatePriorityScore(
  basePriority: string,
  status: string,
  etaProximity: number | null // days until ETA (negative if past)
): { score: number; priority: string; factors: Record<string, unknown> } {
  // Workflow state urgency (0-30 points)
  let workflowScore = 0;
  let workflowReason = '';

  if (status === 'arrived') {
    workflowScore = 30;
    workflowReason = 'Shipment arrived - immediate action required';
  } else if (status === 'in_transit') {
    if (etaProximity !== null && etaProximity <= 3) {
      workflowScore = 25;
      workflowReason = `Arriving in ${etaProximity} days`;
    } else if (etaProximity !== null && etaProximity <= 7) {
      workflowScore = 20;
      workflowReason = `Arriving in ${etaProximity} days`;
    } else {
      workflowScore = 15;
      workflowReason = 'In transit';
    }
  } else if (status === 'booked') {
    if (etaProximity !== null && etaProximity <= 7) {
      workflowScore = 20;
      workflowReason = `ETD in ${etaProximity} days`;
    } else {
      workflowScore = 10;
      workflowReason = 'Recently booked';
    }
  } else {
    workflowScore = 5;
    workflowReason = 'Standard workflow state';
  }

  // Base priority score (0-15 points)
  let basePriorityScore = 0;
  if (basePriority === 'critical') basePriorityScore = 15;
  else if (basePriority === 'high') basePriorityScore = 11;
  else if (basePriority === 'medium') basePriorityScore = 7;
  else basePriorityScore = 3;

  // Operational impact (0-20 points)
  let operationalScore = 0;
  let operationalReason = '';
  if (status === 'arrived') {
    operationalScore = 20;
    operationalReason = 'Critical operational milestone';
  } else if (status === 'in_transit' && etaProximity !== null && etaProximity <= 3) {
    operationalScore = 15;
    operationalReason = 'Approaching critical milestone';
  } else {
    operationalScore = 10;
    operationalReason = 'Standard operational task';
  }

  // Total score
  const totalScore = workflowScore + basePriorityScore + operationalScore + 20; // +20 base points

  // Determine priority level
  let priority = 'low';
  if (totalScore >= 70) priority = 'critical';
  else if (totalScore >= 50) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';

  return {
    score: totalScore,
    priority,
    factors: {
      workflow_urgency: { score: workflowScore, max: 30, reason: workflowReason },
      financial_impact: { score: operationalScore, max: 20, reason: operationalReason },
      notification_severity: { score: basePriorityScore, max: 15, reason: `Base priority: ${basePriority}` },
      stakeholder_importance: { score: 10, max: 15, reason: 'Standard shipment' },
      deadline_urgency: { score: 10, max: 35, reason: 'Workflow milestone' },
    },
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE WORKFLOW STATE TASKS                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

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

  // Process each workflow status
  const statuses = ['booked', 'in_transit', 'arrived'];

  for (const status of statuses) {
    console.log(`Processing ${status} shipments...`);

    // Get shipments with this status
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, booking_number, bl_number, status, etd, eta')
      .eq('status', status);

    if (!shipments || shipments.length === 0) {
      console.log(`  No ${status} shipments found\n`);
      continue;
    }

    console.log(`  Found ${shipments.length} ${status} shipments`);

    // Get relevant configs for this status
    const configs = WORKFLOW_TASK_CONFIGS.filter(c => c.status === status);

    for (const shipment of shipments) {
      for (const config of configs) {
        // Check if condition is met
        if (!config.condition(shipment)) {
          continue;
        }

        const taskKey = `${shipment.id}:${config.templateCode}`;

        // Skip if task already exists
        if (existingTaskSet.has(taskKey)) {
          tasksSkipped++;
          continue;
        }

        // Calculate ETA proximity (for priority scoring)
        let etaProximity: number | null = null;
        if (shipment.eta) {
          const etaDate = new Date(shipment.eta);
          const now = new Date();
          etaProximity = Math.ceil((etaDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        } else if (shipment.etd) {
          const etdDate = new Date(shipment.etd);
          const now = new Date();
          etaProximity = Math.ceil((etdDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Calculate due date
        const now = new Date();
        const dueDate = new Date(now.getTime() + config.daysToComplete * 24 * 60 * 60 * 1000);

        // Calculate priority
        const { score, priority, factors } = calculatePriorityScore(
          config.basePriority,
          status,
          etaProximity
        );

        const bookingRef = shipment.booking_number || shipment.bl_number || 'Unknown';

        // Create task
        const { error } = await supabase
          .from('action_tasks')
          .insert({
            template_code: config.templateCode,
            shipment_id: shipment.id,
            title: config.title(bookingRef),
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
          console.log(`  ✓ Created ${config.templateCode} task for ${bookingRef}`);
        } else {
          console.error(`  ✗ Error creating task: ${error.message}`);
        }
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
