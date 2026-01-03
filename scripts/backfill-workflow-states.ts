/**
 * Backfill Workflow States
 *
 * Updates workflow_state for all shipments based on their linked documents.
 * Uses the unified classification service for direction detection and workflow state mapping.
 */

import { createClient } from '@supabase/supabase-js';
import { WorkflowStateService } from '../lib/services/workflow-state-service';
import { getWorkflowState } from '../lib/services/unified-classification-service';
import { detectDirection } from '../lib/utils/direction-detector';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Workflow state progression order.
 * Higher number = further in the shipment lifecycle.
 * Used to determine the "highest" state when multiple documents exist.
 */
const WORKFLOW_STATE_ORDER: Record<string, number> = {
  // ===== PRE_DEPARTURE =====
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'shipping_bill_received': 48,
  'customs_export_filed': 48,
  'customs_export_cleared': 50,
  'si_confirmed': 60,
  'vgm_pending': 62,
  'vgm_confirmed': 68,
  'gate_in_confirmed': 72,
  'sob_received': 80,
  'vessel_departed': 90,

  // ===== IN_TRANSIT =====
  'isf_filed': 100,
  'isf_confirmed': 105,
  'mbl_draft_received': 110,
  'hbl_draft_sent': 120,
  'hbl_released': 130,
  'invoice_sent': 135,
  'invoice_paid': 140,

  // ===== PRE_ARRIVAL =====
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_filed': 160,
  'entry_summary_shared': 165,

  // ===== ARRIVAL =====
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'customs_cleared': 190,
  'cargo_released': 192,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,

  // ===== DELIVERY =====
  'container_released': 220,
  'out_for_delivery': 225,
  'delivered': 230,
  'pod_received': 235,
  'empty_returned': 240,

  // Terminal states
  'booking_cancelled': 999,
  'customs_hold': 500,
};

async function backfillWorkflowStates() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const workflowService = new WorkflowStateService(supabase);

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('       WORKFLOW STATE BACKFILL (Using Unified Classification Service)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Clear workflow history for clean backfill
  console.log('Step 1: Clearing workflow history...');
  const { error: historyError } = await supabase
    .from('shipment_workflow_history')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (historyError) {
    console.error('   Failed:', historyError.message);
  } else {
    console.log('   Done');
  }

  // Step 2: Get all shipments with their documents and email senders
  console.log('\nStep 2: Fetching shipments and their documents...');

  const { data: shipments, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .order('created_at', { ascending: false });

  if (shipmentError) {
    console.error('   Failed to fetch shipments:', shipmentError);
    return;
  }

  console.log(`   Found ${shipments.length} shipments`);

  // Step 3: Process each shipment
  console.log('\nStep 3: Processing shipments...\n');

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const stateDistribution: Record<string, number> = {};

  for (const shipment of shipments) {
    try {
      // Get linked documents with their email senders
      const { data: documents } = await supabase
        .from('shipment_documents')
        .select(`
          document_type,
          email_id,
          raw_emails!inner(sender_email, true_sender_email, subject)
        `)
        .eq('shipment_id', shipment.id);

      if (!documents || documents.length === 0) {
        skipped++;
        continue;
      }

      // Determine the highest workflow state based on all documents
      let highestOrder = 0;
      let targetState: string | null = null;
      let triggerDoc: string | null = null;

      for (const doc of documents) {
        if (!doc.document_type) continue;

        // Get email data
        const rawEmail = (doc as any).raw_emails || {};
        const senderEmail = rawEmail.sender_email || rawEmail.true_sender_email || '';

        // Use unified classification service for direction detection
        const direction = detectDirection(senderEmail);

        // Use unified classification service for workflow state mapping
        const workflowState = getWorkflowState(doc.document_type, direction);

        if (workflowState) {
          const stateOrder = WORKFLOW_STATE_ORDER[workflowState] || 0;

          // PRIORITY RULE: Higher order wins, but inbound takes precedence for same doc type
          const shouldUpdate = stateOrder > highestOrder ||
            (direction === 'inbound' && triggerDoc === doc.document_type);

          if (shouldUpdate) {
            highestOrder = stateOrder;
            targetState = workflowState;
            triggerDoc = doc.document_type;
          }
        }
      }

      if (targetState) {
        // Only update if different from current state
        if (targetState !== shipment.workflow_state) {
          const result = await workflowService.forceSetState(shipment.id, targetState, {
            notes: `Backfill from ${triggerDoc}`,
          });

          if (result.success) {
            console.log(`[${shipment.booking_number}] ${shipment.workflow_state || 'null'} -> ${targetState}`);
            updated++;

            // Special handling: If cancelled, also update shipment status
            if (targetState === 'booking_cancelled') {
              await supabase
                .from('shipments')
                .update({ status: 'cancelled' })
                .eq('id', shipment.id);
              console.log(`[${shipment.booking_number}] Status -> cancelled`);
            }
          } else {
            console.error(`[${shipment.booking_number}] Failed: ${result.error}`);
            errors++;
          }
        } else {
          skipped++;
        }

        // Track distribution
        stateDistribution[targetState] = (stateDistribution[targetState] || 0) + 1;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[${shipment.booking_number}] Error:`, err);
      errors++;
    }
  }

  // Print summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Summary:');
  console.log('─'.repeat(60));
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log('');
  console.log('State Distribution:');
  console.log('─'.repeat(60));

  // Sort by state order
  const sortedStates = Object.entries(stateDistribution)
    .sort((a, b) => {
      const orderA = WORKFLOW_STATE_ORDER[a[0]] || 999;
      const orderB = WORKFLOW_STATE_ORDER[b[0]] || 999;
      return orderA - orderB;
    });

  for (const [state, count] of sortedStates) {
    console.log(`  ${state.padEnd(40)} ${count.toString().padStart(4)}`);
  }
  console.log('');
}

backfillWorkflowStates().catch(console.error);
