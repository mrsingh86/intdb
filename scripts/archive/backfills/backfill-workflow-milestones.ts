/**
 * BACKFILL WORKFLOW STATES AND MILESTONES
 *
 * Initializes workflow states and milestones for existing shipments.
 * Analyzes linked documents to determine current state.
 *
 * Run with: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-workflow-milestones.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { WorkflowStateService } from '../lib/services/workflow-state-service';
import { MilestoneTrackingService } from '../lib/services/milestone-tracking-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const workflowService = new WorkflowStateService(supabase);
const milestoneService = new MilestoneTrackingService(supabase);

// Document type to workflow state mapping
const DOC_TYPE_TO_STATE: Record<string, string> = {
  'booking_confirmation': 'booking_confirmation_received',
  'si_draft': 'si_draft_received',
  'si_confirmation': 'si_confirmed',
  'house_bl': 'hbl_draft_sent',
  'arrival_notice': 'arrival_notice_received',
  'delivery_order': 'pod_received',
  'duty_summary': 'duty_summary_shared',
};

// Document type to milestone mapping
const DOC_TYPE_TO_MILESTONE: Record<string, string> = {
  'booking_confirmation': 'booking_confirmed',
  'vgm_confirmation': 'vgm_submitted',
  'si_confirmation': 'si_submitted',
  'house_bl': 'hbl_released',
  'arrival_notice': 'vessel_arrived',
  'delivery_order': 'delivered',
};

interface BackfillStats {
  shipments_processed: number;
  workflows_initialized: number;
  milestones_created: number;
  errors: string[];
}

async function backfillWorkflowAndMilestones() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              BACKFILL WORKFLOW STATES AND MILESTONES                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  const stats: BackfillStats = {
    shipments_processed: 0,
    workflows_initialized: 0,
    milestones_created: 0,
    errors: [],
  };

  try {
    // Get all shipments without workflow state
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        etd,
        eta,
        status,
        workflow_state,
        created_from_email_id
      `)
      .is('workflow_state', null)
      .order('created_at', { ascending: true });

    if (error) throw error;

    console.log(`📦 Found ${shipments?.length || 0} shipments without workflow state\n`);

    for (const shipment of shipments || []) {
      try {
        await processShipment(shipment, stats);
        stats.shipments_processed++;

        // Progress indicator
        if (stats.shipments_processed % 10 === 0) {
          console.log(`   Progress: ${stats.shipments_processed}/${shipments?.length}`);
        }

      } catch (err: any) {
        console.error(`❌ Error: ${shipment.booking_number}: ${err.message}`);
        stats.errors.push(`${shipment.booking_number}: ${err.message}`);
      }
    }

  } catch (err: any) {
    console.error('Fatal error:', err);
  } finally {
    printSummary(stats);
  }
}

async function processShipment(shipment: any, stats: BackfillStats) {
  console.log(`\n📦 ${shipment.booking_number || shipment.id.substring(0, 8)}`);

  // Get all linked documents for this shipment
  const { data: documents } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      email_id,
      document_type,
      created_at,
      raw_emails (
        id,
        received_at
      )
    `)
    .eq('shipment_id', shipment.id)
    .order('created_at', { ascending: true });

  // Also check document_classifications for the source email
  const { data: sourceClassification } = await supabase
    .from('document_classifications')
    .select('document_type')
    .eq('email_id', shipment.created_from_email_id)
    .single();

  // Determine the highest workflow state based on documents received
  let highestState = 'booking_confirmation_received';
  let highestStateOrder = 10;

  const receivedDocTypes = new Set<string>();

  // Add source document type
  if (sourceClassification?.document_type) {
    receivedDocTypes.add(sourceClassification.document_type);
  }

  // Add linked document types
  for (const doc of documents || []) {
    if (doc.document_type) {
      receivedDocTypes.add(doc.document_type);
    }
  }

  console.log(`   Documents: ${Array.from(receivedDocTypes).join(', ') || 'none'}`);

  // Get workflow states to determine order
  const { data: workflowStates } = await supabase
    .from('shipment_workflow_states')
    .select('state_code, state_order, requires_document_types')
    .order('state_order', { ascending: true });

  // Find highest state we can set based on received documents
  for (const state of workflowStates || []) {
    if (state.requires_document_types) {
      const hasRequiredDoc = state.requires_document_types.some((dt: string) =>
        receivedDocTypes.has(dt)
      );
      if (hasRequiredDoc && state.state_order > highestStateOrder) {
        highestState = state.state_code;
        highestStateOrder = state.state_order;
      }
    }
  }

  // Also check based on shipment status
  if (shipment.status === 'in_transit' && highestStateOrder < 70) {
    highestState = 'hbl_draft_sent';
    highestStateOrder = 70;
  } else if (shipment.status === 'arrived' && highestStateOrder < 100) {
    highestState = 'arrival_notice_received';
    highestStateOrder = 100;
  } else if (shipment.status === 'delivered') {
    highestState = 'pod_received';
    highestStateOrder = 150;
  }

  console.log(`   → Setting workflow state: ${highestState}`);

  // Initialize workflow at the determined state
  const result = await workflowService.transitionTo(shipment.id, highestState, {
    notes: 'Backfilled from existing documents',
    skip_validation: true,
  });

  if (result.success) {
    stats.workflows_initialized++;
  }

  // Initialize milestones
  console.log(`   → Initializing milestones...`);
  const milestones = await milestoneService.initializeMilestones(
    shipment.id,
    shipment.etd,
    shipment.eta
  );

  stats.milestones_created += milestones.length;

  // Mark achieved milestones based on received documents
  for (const docType of receivedDocTypes) {
    const milestoneCode = DOC_TYPE_TO_MILESTONE[docType];
    if (milestoneCode) {
      await milestoneService.recordMilestone(shipment.id, milestoneCode, {
        notes: 'Backfilled from existing document',
      });
    }
  }

  // Also set milestones based on workflow state
  const milestonesByState: Record<string, string[]> = {
    'booking_confirmation_received': ['booking_confirmed'],
    'si_confirmed': ['booking_confirmed', 'si_submitted'],
    'hbl_draft_sent': ['booking_confirmed', 'si_submitted', 'hbl_released'],
    'arrival_notice_received': ['booking_confirmed', 'si_submitted', 'hbl_released', 'vessel_arrived'],
    'pod_received': ['booking_confirmed', 'si_submitted', 'hbl_released', 'vessel_arrived', 'delivered'],
  };

  const milestonesToSet = milestonesByState[highestState] || [];
  for (const milestoneCode of milestonesToSet) {
    try {
      await milestoneService.recordMilestone(shipment.id, milestoneCode, {
        notes: 'Backfilled based on workflow state',
      });
    } catch {
      // Milestone might already exist
    }
  }

  console.log(`   ✅ Done`);
}

function printSummary(stats: BackfillStats) {
  console.log('\n\n' + '═'.repeat(80));
  console.log('                           BACKFILL SUMMARY');
  console.log('═'.repeat(80));
  console.log(`  Shipments Processed:    ${stats.shipments_processed}`);
  console.log(`  Workflows Initialized:  ${stats.workflows_initialized}`);
  console.log(`  Milestones Created:     ${stats.milestones_created}`);

  if (stats.errors.length > 0) {
    console.log(`\n  Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
  }

  console.log('═'.repeat(80));
  console.log('✅ Backfill complete!\n');
}

// Run
backfillWorkflowAndMilestones().catch(console.error);
