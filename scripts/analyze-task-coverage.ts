#!/usr/bin/env npx tsx
/**
 * Analyze Task Coverage
 *
 * Analyzes shipments to understand why task generation is low
 * and identify opportunities for more task generation
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

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          ANALYZE TASK COVERAGE                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get total shipments
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`Total shipments: ${totalShipments}`);

  // Get shipments with tasks
  const { data: tasksData } = await supabase
    .from('action_tasks')
    .select('shipment_id');

  const shipmentsWithTasks = new Set(tasksData?.map(t => t.shipment_id).filter(Boolean) || []);
  console.log(`Shipments with tasks: ${shipmentsWithTasks.size} (${((shipmentsWithTasks.size / (totalShipments || 1)) * 100).toFixed(1)}%)`);

  // Analyze cutoff data
  console.log('\n--- Cutoff Analysis ---');
  const { data: cutoffData } = await supabase
    .from('shipments')
    .select('si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, etd, eta');

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let hasSiCutoff = 0, hasVgmCutoff = 0, hasCargoCutoff = 0, hasGateCutoff = 0;
  let siWithin7Days = 0, siPast = 0, siFuture = 0;
  let vgmWithin7Days = 0, vgmPast = 0, vgmFuture = 0;
  let cargoCutoffWithin7Days = 0, cargoCutoffPast = 0, cargoCutoffFuture = 0;
  let gateCutoffWithin7Days = 0, gateCutoffPast = 0, gateCutoffFuture = 0;

  cutoffData?.forEach(s => {
    if (s.si_cutoff) {
      hasSiCutoff++;
      const date = new Date(s.si_cutoff);
      if (date < now) siPast++;
      else if (date <= sevenDaysLater) siWithin7Days++;
      else siFuture++;
    }
    if (s.vgm_cutoff) {
      hasVgmCutoff++;
      const date = new Date(s.vgm_cutoff);
      if (date < now) vgmPast++;
      else if (date <= sevenDaysLater) vgmWithin7Days++;
      else vgmFuture++;
    }
    if (s.cargo_cutoff) {
      hasCargoCutoff++;
      const date = new Date(s.cargo_cutoff);
      if (date < now) cargoCutoffPast++;
      else if (date <= sevenDaysLater) cargoCutoffWithin7Days++;
      else cargoCutoffFuture++;
    }
    if (s.gate_cutoff) {
      hasGateCutoff++;
      const date = new Date(s.gate_cutoff);
      if (date < now) gateCutoffPast++;
      else if (date <= sevenDaysLater) gateCutoffWithin7Days++;
      else gateCutoffFuture++;
    }
  });

  console.log(`SI Cutoff: ${hasSiCutoff} total (${siPast} past, ${siWithin7Days} within 7 days, ${siFuture} future)`);
  console.log(`VGM Cutoff: ${hasVgmCutoff} total (${vgmPast} past, ${vgmWithin7Days} within 7 days, ${vgmFuture} future)`);
  console.log(`Cargo Cutoff: ${hasCargoCutoff} total (${cargoCutoffPast} past, ${cargoCutoffWithin7Days} within 7 days, ${cargoCutoffFuture} future)`);
  console.log(`Gate Cutoff: ${hasGateCutoff} total (${gateCutoffPast} past, ${gateCutoffWithin7Days} within 7 days, ${gateCutoffFuture} future)`);

  // Analyze shipment status
  console.log('\n--- Shipment Status Analysis ---');
  const { data: statusData } = await supabase
    .from('shipments')
    .select('status');

  const statusCounts: Record<string, number> = {};
  statusData?.forEach(s => {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  });

  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => console.log(`  ${status}: ${count}`));

  // Analyze document availability
  console.log('\n--- Document Analysis ---');
  const { data: documents } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type');

  const shipmentsWithDocs = new Set(documents?.map(d => d.shipment_id) || []);
  console.log(`Shipments with documents: ${shipmentsWithDocs.size} (${((shipmentsWithDocs.size / (totalShipments || 1)) * 100).toFixed(1)}%)`);

  const docTypeCounts: Record<string, number> = {};
  documents?.forEach(d => {
    docTypeCounts[d.document_type] = (docTypeCounts[d.document_type] || 0) + 1;
  });

  console.log('Document types:');
  Object.entries(docTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => console.log(`  ${type}: ${count}`));

  // Analyze notifications
  console.log('\n--- Notification Analysis ---');
  const { data: notifications } = await supabase
    .from('notifications')
    .select('shipment_id, notification_type, status');

  const shipmentsWithNotifications = new Set(notifications?.map(n => n.shipment_id).filter(Boolean) || []);
  console.log(`Shipments with notifications: ${shipmentsWithNotifications.size} (${((shipmentsWithNotifications.size / (totalShipments || 1)) * 100).toFixed(1)}%)`);

  const notificationTypeCounts: Record<string, number> = {};
  const notificationStatusCounts: Record<string, number> = {};
  notifications?.forEach(n => {
    notificationTypeCounts[n.notification_type] = (notificationTypeCounts[n.notification_type] || 0) + 1;
    notificationStatusCounts[n.status] = (notificationStatusCounts[n.status] || 0) + 1;
  });

  console.log('Notification types:');
  Object.entries(notificationTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => console.log(`  ${type}: ${count}`));

  console.log('Notification status:');
  Object.entries(notificationStatusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => console.log(`  ${status}: ${count}`));

  // Task generation opportunities
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          TASK GENERATION OPPORTUNITIES                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const opportunities = [];

  // Documents received without tasks
  const shipmentsWithDocsNoTasks = Array.from(shipmentsWithDocs).filter(id => !shipmentsWithTasks.has(id));
  opportunities.push({
    type: 'Document received tasks',
    count: shipmentsWithDocsNoTasks.length,
    description: 'Shipments with documents but no tasks (review, comparison)',
  });

  // Notifications without tasks
  const shipmentsWithNotificationsNoTasks = Array.from(shipmentsWithNotifications).filter(id => !shipmentsWithTasks.has(id));
  opportunities.push({
    type: 'Notification response tasks',
    count: shipmentsWithNotificationsNoTasks.length,
    description: 'Shipments with notifications requiring response',
  });

  // In-transit shipments
  const inTransitShipments = statusData?.filter(s => s.status === 'in_transit').length || 0;
  opportunities.push({
    type: 'In-transit milestone tasks',
    count: inTransitShipments,
    description: 'Shipments in transit (track milestones, arrival notices)',
  });

  // Shipments with no documents
  const shipmentsWithoutDocs = (totalShipments || 0) - shipmentsWithDocs.size;
  opportunities.push({
    type: 'Missing document tasks',
    count: shipmentsWithoutDocs,
    description: 'Shipments missing expected documents',
  });

  // Past cutoffs (overdue)
  const overdueOpportunities = siPast + vgmPast + cargoCutoffPast + gateCutoffPast;
  opportunities.push({
    type: 'Overdue deadline tasks',
    count: overdueOpportunities,
    description: 'Past cutoffs that need follow-up',
  });

  opportunities.forEach(opp => {
    console.log(`${opp.type}: ${opp.count}`);
    console.log(`  → ${opp.description}\n`);
  });

  const totalPotential = opportunities.reduce((sum, opp) => sum + opp.count, 0);
  console.log(`Total potential new tasks: ${totalPotential}`);
  console.log(`Current tasks: ${tasksData?.length || 0}`);
  console.log(`Potential total: ${(tasksData?.length || 0) + totalPotential}`);
}

main().catch(console.error);
