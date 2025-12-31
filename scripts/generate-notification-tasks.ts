#!/usr/bin/env npx tsx
/**
 * Generate Notification Response Tasks
 *
 * Creates action_tasks based on received notifications:
 * - Customs hold response
 * - Detention alert response
 * - Vessel delay actions
 * - Rollover response
 * - Equipment shortage response
 *
 * Tasks are generated for unread or pending notifications
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

interface NotificationTaskConfig {
  notificationType: string;
  templateCode: string;
  title: (booking: string, type: string) => string;
  description: string;
  category: string;
  basePriority: string;
  urgencyHours: number; // How quickly should this be addressed
}

const NOTIFICATION_TASK_CONFIGS: NotificationTaskConfig[] = [
  {
    notificationType: 'customs_hold',
    templateCode: 'respond_customs_hold',
    title: (booking: string) => `CRITICAL: Address Customs Hold for ${booking}`,
    description: 'Customs hold detected - provide required documentation and clearance',
    category: 'notification',
    basePriority: 'critical',
    urgencyHours: 4, // Must address within 4 hours
  },
  {
    notificationType: 'detention_alert',
    templateCode: 'respond_detention',
    title: (booking: string) => `URGENT: Address Detention Alert for ${booking}`,
    description: 'Detention charges accruing - arrange container return or payment',
    category: 'notification',
    basePriority: 'critical',
    urgencyHours: 8,
  },
  {
    notificationType: 'vessel_delay',
    templateCode: 'respond_vessel_delay',
    title: (booking: string) => `Vessel Delay for ${booking} - Update Stakeholders`,
    description: 'Vessel delay detected - notify consignee and adjust plans',
    category: 'notification',
    basePriority: 'high',
    urgencyHours: 12,
  },
  {
    notificationType: 'rollover',
    templateCode: 'respond_rollover',
    title: (booking: string) => `URGENT: Rollover for ${booking} - Action Required`,
    description: 'Shipment rolled to next vessel - confirm acceptance or arrange alternative',
    category: 'notification',
    basePriority: 'critical',
    urgencyHours: 6,
  },
  {
    notificationType: 'equipment_shortage',
    templateCode: 'respond_equipment_shortage',
    title: (booking: string) => `Equipment Shortage for ${booking}`,
    description: 'Container equipment shortage - arrange alternative or reschedule',
    category: 'notification',
    basePriority: 'high',
    urgencyHours: 12,
  },
  {
    notificationType: 'cargo_cutoff_change',
    templateCode: 'respond_cutoff_change',
    title: (booking: string) => `Cargo Cutoff Changed for ${booking}`,
    description: 'Cargo cutoff time changed - verify cargo delivery schedule',
    category: 'notification',
    basePriority: 'high',
    urgencyHours: 8,
  },
  {
    notificationType: 'vessel_omission',
    templateCode: 'respond_vessel_omission',
    title: (booking: string) => `CRITICAL: Vessel Omission for ${booking}`,
    description: 'Vessel will not call at port - arrange alternative routing immediately',
    category: 'notification',
    basePriority: 'critical',
    urgencyHours: 4,
  },
];

function calculatePriorityScore(
  basePriority: string,
  hoursOld: number,
  urgencyHours: number,
  notificationType: string
): { score: number; priority: string; factors: Record<string, unknown> } {
  // Notification severity (0-35 points)
  let severityScore = 0;
  let severityReason = '';
  const criticalNotifications = ['customs_hold', 'detention_alert', 'rollover', 'vessel_omission'];
  const highNotifications = ['vessel_delay', 'equipment_shortage', 'cargo_cutoff_change'];

  if (criticalNotifications.includes(notificationType)) {
    severityScore = 35;
    severityReason = 'Critical notification requiring immediate action';
  } else if (highNotifications.includes(notificationType)) {
    severityScore = 25;
    severityReason = 'High priority notification';
  } else {
    severityScore = 15;
    severityReason = 'Standard notification';
  }

  // Time urgency (0-25 points) - based on how long notification has been pending
  let urgencyScore = 0;
  let urgencyReason = '';
  if (hoursOld >= urgencyHours * 2) {
    urgencyScore = 25;
    urgencyReason = `Notification pending for ${hoursOld.toFixed(1)}h (urgency: ${urgencyHours}h)`;
  } else if (hoursOld >= urgencyHours) {
    urgencyScore = 20;
    urgencyReason = `Approaching urgency deadline (${hoursOld.toFixed(1)}h old)`;
  } else if (hoursOld >= urgencyHours / 2) {
    urgencyScore = 15;
    urgencyReason = `Notification pending for ${hoursOld.toFixed(1)}h`;
  } else {
    urgencyScore = 10;
    urgencyReason = `Recently received (${hoursOld.toFixed(1)}h old)`;
  }

  // Base priority score (0-15 points)
  let basePriorityScore = 0;
  if (basePriority === 'critical') basePriorityScore = 15;
  else if (basePriority === 'high') basePriorityScore = 11;
  else if (basePriority === 'medium') basePriorityScore = 7;
  else basePriorityScore = 3;

  // Financial impact (customs/detention are expensive)
  let financialScore = 0;
  let financialReason = '';
  if (['customs_hold', 'detention_alert'].includes(notificationType)) {
    financialScore = 15;
    financialReason = 'High financial impact (charges accruing)';
  } else if (['rollover', 'vessel_omission'].includes(notificationType)) {
    financialScore = 10;
    financialReason = 'Moderate financial impact (schedule disruption)';
  } else {
    financialScore = 5;
    financialReason = 'Standard financial impact';
  }

  // Total score
  const totalScore = severityScore + urgencyScore + basePriorityScore + financialScore;

  // Determine priority level
  let priority = 'low';
  if (totalScore >= 75) priority = 'critical';
  else if (totalScore >= 55) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';

  return {
    score: totalScore,
    priority,
    factors: {
      notification_severity: { score: severityScore, max: 35, reason: severityReason },
      deadline_urgency: { score: urgencyScore, max: 25, reason: urgencyReason },
      financial_impact: { score: financialScore, max: 20, reason: financialReason },
      base_priority: { score: basePriorityScore, max: 15, reason: `Base: ${basePriority}` },
      stakeholder_importance: { score: 5, max: 15, reason: 'Standard shipment' },
    },
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE NOTIFICATION TASKS                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get existing tasks to avoid duplicates
  const { data: existingTasks } = await supabase
    .from('action_tasks')
    .select('notification_id, template_code');

  const existingTaskSet = new Set(
    existingTasks?.map(t => `${t.notification_id}:${t.template_code}`).filter(k => k !== 'null:undefined') || []
  );

  console.log(`Existing tasks: ${existingTasks?.length || 0}\n`);

  let tasksCreated = 0;
  let tasksSkipped = 0;

  for (const config of NOTIFICATION_TASK_CONFIGS) {
    console.log(`Processing ${config.notificationType}...`);

    // Get unread/pending notifications of this type
    const { data: notifications } = await supabase
      .from('notifications')
      .select(`
        id,
        shipment_id,
        notification_type,
        created_at,
        shipments(
          id,
          booking_number,
          bl_number
        )
      `)
      .eq('notification_type', config.notificationType)
      .in('status', ['unread', 'pending']);

    if (!notifications || notifications.length === 0) {
      console.log(`  No ${config.notificationType} notifications found\n`);
      continue;
    }

    console.log(`  Found ${notifications.length} ${config.notificationType} notifications`);

    for (const notification of notifications) {
      const shipment = notification.shipments as any;
      if (!shipment) {
        console.log(`  ✗ Notification ${notification.id} has no shipment`);
        continue;
      }

      const taskKey = `${notification.id}:${config.templateCode}`;

      // Skip if task already exists
      if (existingTaskSet.has(taskKey)) {
        tasksSkipped++;
        continue;
      }

      // Calculate how many hours old the notification is
      const createdDate = new Date(notification.created_at);
      const now = new Date();
      const hoursOld = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);

      // Calculate due date (urgency hours from now)
      const dueDate = new Date(now.getTime() + config.urgencyHours * 60 * 60 * 1000);

      // Calculate priority
      const { score, priority, factors } = calculatePriorityScore(
        config.basePriority,
        hoursOld,
        config.urgencyHours,
        config.notificationType
      );

      const bookingRef = shipment.booking_number || shipment.bl_number || 'Unknown';

      // Create task
      const { error } = await supabase
        .from('action_tasks')
        .insert({
          template_code: config.templateCode,
          shipment_id: shipment.id,
          notification_id: notification.id,
          title: config.title(bookingRef, config.notificationType),
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
        console.log(`  ✓ Created ${config.templateCode} task for ${bookingRef} (${hoursOld.toFixed(1)}h old)`);
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
