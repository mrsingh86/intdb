#!/usr/bin/env npx tsx
/**
 * Generate Missing Document Tasks
 *
 * Creates action_tasks for shipments missing expected documents:
 * - Booked shipments without BL
 * - In-transit shipments without SI
 * - Arrived shipments without arrival notice
 * - All shipments without booking confirmation
 *
 * Tasks are generated based on shipment state and expected documents
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

interface MissingDocumentConfig {
  documentType: string;
  requiredStatus: string[];
  templateCode: string;
  title: (booking: string) => string;
  description: string;
  category: string;
  basePriority: string;
  daysToObtain: number;
  gracePeriodDays: number; // How many days to wait before creating task
}

const MISSING_DOCUMENT_CONFIGS: MissingDocumentConfig[] = [
  {
    documentType: 'booking_confirmation',
    requiredStatus: ['booked', 'in_transit', 'arrived'],
    templateCode: 'obtain_booking_confirmation',
    title: (booking: string) => `Obtain Booking Confirmation for ${booking}`,
    description: 'Follow up with carrier to obtain booking confirmation',
    category: 'document',
    basePriority: 'high',
    daysToObtain: 2,
    gracePeriodDays: 1,
  },
  {
    documentType: 'shipping_instruction',
    requiredStatus: ['in_transit', 'arrived'],
    templateCode: 'obtain_si',
    title: (booking: string) => `Obtain Shipping Instructions for ${booking}`,
    description: 'Follow up to obtain shipping instructions for in-transit shipment',
    category: 'document',
    basePriority: 'high',
    daysToObtain: 2,
    gracePeriodDays: 2,
  },
  {
    documentType: 'bill_of_lading',
    requiredStatus: ['in_transit', 'arrived'],
    templateCode: 'obtain_bl',
    title: (booking: string) => `URGENT: Obtain Bill of Lading for ${booking}`,
    description: 'BL required for customs clearance - follow up with carrier immediately',
    category: 'document',
    basePriority: 'critical',
    daysToObtain: 1,
    gracePeriodDays: 3,
  },
  {
    documentType: 'arrival_notice',
    requiredStatus: ['in_transit', 'arrived'],
    templateCode: 'obtain_arrival_notice',
    title: (booking: string) => `Obtain Arrival Notice for ${booking}`,
    description: 'Follow up with carrier to obtain arrival notice',
    category: 'document',
    basePriority: 'high',
    daysToObtain: 2,
    gracePeriodDays: 5,
  },
  {
    documentType: 'vgm_confirmation',
    requiredStatus: ['booked', 'in_transit'],
    templateCode: 'obtain_vgm',
    title: (booking: string) => `Obtain VGM Confirmation for ${booking}`,
    description: 'Ensure VGM has been submitted and confirmed',
    category: 'compliance',
    basePriority: 'high',
    daysToObtain: 1,
    gracePeriodDays: 2,
  },
  {
    documentType: 'commercial_invoice',
    requiredStatus: ['in_transit', 'arrived'],
    templateCode: 'obtain_commercial_invoice',
    title: (booking: string) => `Obtain Commercial Invoice for ${booking}`,
    description: 'Commercial invoice required for customs clearance',
    category: 'document',
    basePriority: 'medium',
    daysToObtain: 3,
    gracePeriodDays: 3,
  },
];

function calculatePriorityScore(
  basePriority: string,
  status: string,
  daysInStatus: number,
  documentType: string
): { score: number; priority: string; factors: Record<string, unknown> } {
  // Document criticality (0-30 points)
  let documentScore = 0;
  let documentReason = '';
  const criticalDocs = ['bill_of_lading', 'vgm_confirmation'];
  const highDocs = ['shipping_instruction', 'booking_confirmation', 'arrival_notice'];

  if (criticalDocs.includes(documentType)) {
    documentScore = 30;
    documentReason = 'Critical document for customs/shipping';
  } else if (highDocs.includes(documentType)) {
    documentScore = 20;
    documentReason = 'Important shipping document';
  } else {
    documentScore = 10;
    documentReason = 'Supporting document';
  }

  // Shipment state urgency (0-25 points)
  let stateScore = 0;
  let stateReason = '';

  if (status === 'arrived') {
    stateScore = 25;
    stateReason = 'Shipment arrived - documents urgently needed';
  } else if (status === 'in_transit') {
    stateScore = 20;
    stateReason = 'Shipment in transit - documents needed soon';
  } else if (status === 'booked') {
    stateScore = 10;
    stateReason = 'Shipment booked - documents expected';
  } else {
    stateScore = 5;
    stateReason = 'Standard document requirement';
  }

  // Missing duration impact (0-20 points)
  let durationScore = 0;
  let durationReason = '';

  if (daysInStatus >= 10) {
    durationScore = 20;
    durationReason = `Document missing for ${daysInStatus} days`;
  } else if (daysInStatus >= 7) {
    durationScore = 15;
    durationReason = `Document missing for ${daysInStatus} days`;
  } else if (daysInStatus >= 5) {
    durationScore = 10;
    durationReason = `Document missing for ${daysInStatus} days`;
  } else {
    durationScore = 5;
    durationReason = `Document missing for ${daysInStatus} days`;
  }

  // Base priority score (0-15 points)
  let basePriorityScore = 0;
  if (basePriority === 'critical') basePriorityScore = 15;
  else if (basePriority === 'high') basePriorityScore = 11;
  else if (basePriority === 'medium') basePriorityScore = 7;
  else basePriorityScore = 3;

  // Total score
  const totalScore = documentScore + stateScore + durationScore + basePriorityScore;

  // Determine priority level
  let priority = 'low';
  if (totalScore >= 70) priority = 'critical';
  else if (totalScore >= 50) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';

  return {
    score: totalScore,
    priority,
    factors: {
      document_criticality: { score: documentScore, max: 30, reason: documentReason },
      deadline_urgency: { score: stateScore, max: 25, reason: stateReason },
      financial_impact: { score: durationScore, max: 20, reason: durationReason },
      notification_severity: { score: basePriorityScore, max: 15, reason: `Base priority: ${basePriority}` },
      stakeholder_importance: { score: 5, max: 15, reason: 'Standard shipment' },
    },
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE MISSING DOCUMENT TASKS                           ║');
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

  for (const config of MISSING_DOCUMENT_CONFIGS) {
    console.log(`Checking for missing ${config.documentType}...`);

    // Get all shipments in relevant statuses
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, booking_number, bl_number, status, created_at, status_updated_at')
      .in('status', config.requiredStatus);

    if (!shipments || shipments.length === 0) {
      console.log(`  No shipments in required statuses\n`);
      continue;
    }

    // Get shipment IDs that already have this document
    const { data: existingDocs } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('document_type', config.documentType);

    const shipmentsWithDoc = new Set(existingDocs?.map(d => d.shipment_id) || []);

    // Find shipments missing this document
    const shipmentsMissingDoc = shipments.filter(s => !shipmentsWithDoc.has(s.id));

    console.log(`  ${shipmentsWithDoc.size} shipments have ${config.documentType}`);
    console.log(`  ${shipmentsMissingDoc.length} shipments missing ${config.documentType}`);

    for (const shipment of shipmentsMissingDoc) {
      // Calculate how long shipment has been in this status
      const statusDate = new Date(shipment.status_updated_at || shipment.created_at);
      const now = new Date();
      const daysInStatus = Math.floor((now.getTime() - statusDate.getTime()) / (1000 * 60 * 60 * 24));

      // Only create task if grace period has passed
      if (daysInStatus < config.gracePeriodDays) {
        continue;
      }

      const taskKey = `${shipment.id}:${config.templateCode}`;

      // Skip if task already exists
      if (existingTaskSet.has(taskKey)) {
        tasksSkipped++;
        continue;
      }

      // Calculate due date
      const dueDate = new Date(now.getTime() + config.daysToObtain * 24 * 60 * 60 * 1000);

      // Calculate priority
      const { score, priority, factors } = calculatePriorityScore(
        config.basePriority,
        shipment.status,
        daysInStatus,
        config.documentType
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
        console.log(`  ✓ Created ${config.templateCode} task for ${bookingRef} (${daysInStatus} days in ${shipment.status})`);
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
