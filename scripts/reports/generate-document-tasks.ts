#!/usr/bin/env npx tsx
/**
 * Generate Document-Based Tasks
 *
 * Creates action_tasks based on document receipt:
 * - Review SI drafts
 * - Compare SI vs Booking
 * - Review BL
 * - Review arrival notices
 * - Review commercial invoices
 *
 * Tasks are generated when documents are received but not yet reviewed
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

interface DocumentTaskConfig {
  documentType: string;
  templateCode: string;
  title: (booking: string, docType: string) => string;
  description: string;
  category: string;
  basePriority: string;
  daysToReview: number;
}

const DOCUMENT_TASK_CONFIGS: DocumentTaskConfig[] = [
  {
    documentType: 'si_draft',
    templateCode: 'review_si_draft',
    title: (booking: string) => `Review SI Draft for ${booking}`,
    description: 'Review shipping instruction draft and verify accuracy against booking',
    category: 'document',
    basePriority: 'high',
    daysToReview: 2,
  },
  {
    documentType: 'shipping_instruction',
    templateCode: 'verify_si_final',
    title: (booking: string) => `Verify Final SI for ${booking}`,
    description: 'Verify final shipping instruction matches draft and booking confirmation',
    category: 'document',
    basePriority: 'medium',
    daysToReview: 3,
  },
  {
    documentType: 'bill_of_lading',
    templateCode: 'review_bl',
    title: (booking: string) => `Review Bill of Lading for ${booking}`,
    description: 'Review bill of lading for accuracy and completeness',
    category: 'document',
    basePriority: 'high',
    daysToReview: 2,
  },
  {
    documentType: 'arrival_notice',
    templateCode: 'share_arrival_notice',
    title: (booking: string) => `Share Arrival Notice for ${booking}`,
    description: 'Share arrival notice with consignee and arrange cargo clearance',
    category: 'communication',
    basePriority: 'critical',
    daysToReview: 1,
  },
  {
    documentType: 'commercial_invoice',
    templateCode: 'review_commercial_invoice',
    title: (booking: string) => `Review Commercial Invoice for ${booking}`,
    description: 'Review commercial invoice for accuracy and customs compliance',
    category: 'document',
    basePriority: 'medium',
    daysToReview: 3,
  },
  {
    documentType: 'detention_notice',
    templateCode: 'respond_detention',
    title: (booking: string) => `URGENT: Address Detention for ${booking}`,
    description: 'Address detention notice and arrange container return or payment',
    category: 'notification',
    basePriority: 'critical',
    daysToReview: 1,
  },
  {
    documentType: 'vgm_confirmation',
    templateCode: 'verify_vgm',
    title: (booking: string) => `Verify VGM for ${booking}`,
    description: 'Verify VGM confirmation matches submitted declaration',
    category: 'document',
    basePriority: 'medium',
    daysToReview: 2,
  },
];

function calculatePriorityScore(
  basePriority: string,
  daysOld: number,
  documentType: string
): { score: number; priority: string; factors: Record<string, unknown> } {
  // Document criticality (0-35 points)
  let documentScore = 0;
  let documentReason = '';
  const criticalDocs = ['arrival_notice', 'detention_notice', 'customs_hold'];
  const highDocs = ['si_draft', 'bill_of_lading'];

  if (criticalDocs.includes(documentType)) {
    documentScore = 35;
    documentReason = 'Critical document requiring immediate action';
  } else if (highDocs.includes(documentType)) {
    documentScore = 25;
    documentReason = 'Important shipping document';
  } else {
    documentScore = 15;
    documentReason = 'Standard document review';
  }

  // Aging factor (0-25 points) - documents get more urgent as they age
  let agingScore = 0;
  let agingReason = '';
  if (daysOld >= 5) {
    agingScore = 25;
    agingReason = 'Document pending for 5+ days';
  } else if (daysOld >= 3) {
    agingScore = 20;
    agingReason = 'Document pending for 3+ days';
  } else if (daysOld >= 2) {
    agingScore = 15;
    agingReason = 'Document pending for 2+ days';
  } else if (daysOld >= 1) {
    agingScore = 10;
    agingReason = 'Document pending for 1+ day';
  } else {
    agingScore = 5;
    agingReason = 'Document recently received';
  }

  // Base priority score (0-15 points)
  let basePriorityScore = 0;
  if (basePriority === 'critical') basePriorityScore = 15;
  else if (basePriority === 'high') basePriorityScore = 11;
  else if (basePriority === 'medium') basePriorityScore = 7;
  else basePriorityScore = 3;

  // Total score
  const totalScore = documentScore + agingScore + basePriorityScore + 15; // +15 base points

  // Determine priority level
  let priority = 'low';
  if (totalScore >= 75) priority = 'critical';
  else if (totalScore >= 55) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';

  return {
    score: totalScore,
    priority,
    factors: {
      document_criticality: { score: documentScore, max: 35, reason: documentReason },
      document_aging: { score: agingScore, max: 25, reason: agingReason },
      notification_severity: { score: basePriorityScore, max: 15, reason: `Base priority: ${basePriority}` },
      financial_impact: { score: 10, max: 20, reason: 'Document review required' },
      stakeholder_importance: { score: 5, max: 15, reason: 'Standard shipment' },
    },
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          GENERATE DOCUMENT TASKS                                   ║');
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

  for (const config of DOCUMENT_TASK_CONFIGS) {
    console.log(`Processing ${config.documentType}...`);

    // Get shipments with this document type
    const { data: documents } = await supabase
      .from('shipment_documents')
      .select(`
        id,
        shipment_id,
        created_at,
        shipments!inner(
          id,
          booking_number,
          bl_number
        )
      `)
      .eq('document_type', config.documentType);

    if (!documents || documents.length === 0) {
      console.log(`  No ${config.documentType} documents found\n`);
      continue;
    }

    console.log(`  Found ${documents.length} ${config.documentType} documents`);

    for (const doc of documents) {
      const shipment = doc.shipments as any;
      if (!shipment) continue;

      const taskKey = `${shipment.id}:${config.templateCode}`;

      // Skip if task already exists
      if (existingTaskSet.has(taskKey)) {
        tasksSkipped++;
        continue;
      }

      // Calculate how many days old the document is
      const createdDate = new Date(doc.created_at);
      const now = new Date();
      const daysOld = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

      // Calculate due date (days from now based on config)
      const dueDate = new Date(now.getTime() + config.daysToReview * 24 * 60 * 60 * 1000);

      // Calculate priority
      const { score, priority, factors } = calculatePriorityScore(
        config.basePriority,
        daysOld,
        config.documentType
      );

      const bookingRef = shipment.booking_number || shipment.bl_number || 'Unknown';

      // Create task
      const { error } = await supabase
        .from('action_tasks')
        .insert({
          template_code: config.templateCode,
          shipment_id: shipment.id,
          // Note: document_lifecycle_id references document_lifecycle table, not shipment_documents
          // We only set shipment_id for document review tasks
          title: config.title(bookingRef, config.documentType),
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
        console.log(`  ✓ Created ${config.templateCode} task for ${bookingRef} (${daysOld} days old)`);
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
  const statusCounts: Record<string, number> = {};

  taskStats?.forEach(t => {
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });

  console.log('\nTasks by Priority:');
  Object.entries(priorityCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, c]) => console.log(`  ${p}: ${c}`));

  console.log('\nTasks by Category:');
  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, count]) => console.log(`  ${c}: ${count}`));

  console.log('\nTasks by Status:');
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => console.log(`  ${s}: ${c}`));
}

main().catch(console.error);
