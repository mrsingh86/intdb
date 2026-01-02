/**
 * Backfill Workflow States
 *
 * Updates workflow_state for all shipments based on their linked documents.
 * Uses direction-aware mapping and forceSetState to set the FINAL state
 * that each shipment should be in based on all its documents.
 */

import { createClient } from '@supabase/supabase-js';
import { WorkflowStateService } from '../lib/services/workflow-state-service';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Direction-aware document type to workflow state mapping.
 * Key format: {document_type}:{direction}
 */
const DIRECTION_WORKFLOW_MAPPING: Record<string, { state: string; order: number }> = {
  // ===== PRE_DEPARTURE =====
  'booking_confirmation:inbound': { state: 'booking_confirmation_received', order: 10 },
  'booking_amendment:inbound': { state: 'booking_confirmation_received', order: 10 },
  'booking_confirmation:outbound': { state: 'booking_confirmation_shared', order: 15 },
  'booking_amendment:outbound': { state: 'booking_confirmation_shared', order: 15 },

  // Cancellation (terminal state - always wins)
  'booking_cancellation:inbound': { state: 'booking_cancelled', order: 999 },

  'invoice:inbound': { state: 'commercial_invoice_received', order: 20 },
  'commercial_invoice:inbound': { state: 'commercial_invoice_received', order: 20 },
  'packing_list:inbound': { state: 'packing_list_received', order: 25 },

  'shipping_instruction:inbound': { state: 'si_draft_received', order: 30 },
  'si_draft:inbound': { state: 'si_draft_received', order: 30 },

  'checklist:inbound': { state: 'checklist_received', order: 40 },
  'checklist:outbound': { state: 'checklist_shared', order: 42 },
  'shipping_bill:inbound': { state: 'shipping_bill_received', order: 48 },
  'leo_copy:inbound': { state: 'shipping_bill_received', order: 48 },

  'si_submission:outbound': { state: 'si_submitted', order: 55 },
  'si_submission:inbound': { state: 'si_confirmed', order: 60 },
  'si_confirmation:inbound': { state: 'si_confirmed', order: 60 },

  'vgm_submission:outbound': { state: 'vgm_submitted', order: 65 },
  'vgm_submission:inbound': { state: 'vgm_confirmed', order: 68 },
  'vgm_confirmation:inbound': { state: 'vgm_confirmed', order: 68 },

  'gate_in_confirmation:inbound': { state: 'container_gated_in', order: 72 },
  'sob_confirmation:inbound': { state: 'sob_received', order: 80 },

  'departure_notice:inbound': { state: 'vessel_departed', order: 90 },
  'sailing_confirmation:inbound': { state: 'vessel_departed', order: 90 },

  // ===== IN_TRANSIT =====
  'isf_submission:outbound': { state: 'isf_filed', order: 100 },
  'isf_confirmation:inbound': { state: 'isf_confirmed', order: 105 },

  'bill_of_lading:inbound': { state: 'mbl_draft_received', order: 110 },
  'bill_of_lading:outbound': { state: 'hbl_released', order: 130 },
  'house_bl:outbound': { state: 'hbl_released', order: 130 },

  'freight_invoice:outbound': { state: 'invoice_sent', order: 135 },
  'invoice:outbound': { state: 'invoice_sent', order: 135 },
  'payment_confirmation:inbound': { state: 'invoice_paid', order: 140 },

  // ===== PRE_ARRIVAL =====
  'entry_summary:inbound': { state: 'entry_draft_received', order: 153 },
  'entry_summary:outbound': { state: 'entry_draft_shared', order: 156 },

  // ===== ARRIVAL =====
  'arrival_notice:inbound': { state: 'arrival_notice_received', order: 180 },
  'arrival_notice:outbound': { state: 'arrival_notice_shared', order: 185 },

  'customs_clearance:inbound': { state: 'customs_cleared', order: 190 },
  'customs_document:inbound': { state: 'duty_invoice_received', order: 195 },
  'duty_invoice:inbound': { state: 'duty_invoice_received', order: 195 },
  'customs_document:outbound': { state: 'duty_summary_shared', order: 200 },

  'delivery_order:inbound': { state: 'delivery_order_received', order: 205 },
  'delivery_order:outbound': { state: 'delivery_order_shared', order: 210 },

  // ===== DELIVERY =====
  'container_release:inbound': { state: 'container_released', order: 220 },
  'container_release:outbound': { state: 'container_released', order: 220 },
  'dispatch_notice:inbound': { state: 'out_for_delivery', order: 225 },
  'delivery_confirmation:inbound': { state: 'delivered', order: 230 },
  'pod:inbound': { state: 'pod_received', order: 235 },
  'proof_of_delivery:inbound': { state: 'pod_received', order: 235 },
  'empty_return_confirmation:inbound': { state: 'empty_returned', order: 240 },
};

async function backfillWorkflowStates() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const workflowService = new WorkflowStateService(supabase);

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              WORKFLOW STATE BACKFILL (Direction-Aware)');
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
      // Get linked documents with their email senders and subjects
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
        const senderEmail = (rawEmail.sender_email || '').toLowerCase();
        const trueSender = (rawEmail.true_sender_email || '').toLowerCase();
        const subject = (rawEmail.subject || '').toLowerCase();

        // CARRIER DOMAIN PATTERNS - Check BOTH sender_email and true_sender_email
        const carrierDomains = [
          '@maersk.com', '@hapag-lloyd.com', '@hlag.com',
          '@cma-cgm.com', '@cmacgm.com', '@customer.cmacgm-group.com',
          '@msc.com', '@evergreen-marine.com', '@oocl.com',
          '@coscon.com', '@cosco.com', '@yangming.com', '@one-line.com', '@zim.com'
        ];

        // If true_sender has a carrier domain, it's definitely INBOUND
        const trueSenderIsCarrier = carrierDomains.some(d => trueSender.includes(d));
        const senderIsCarrier = carrierDomains.some(d => senderEmail.includes(d));

        // Detect "via Operations" pattern in sender display name
        const isForwardedVia = senderEmail.includes('via operations') ||
          senderEmail.includes('via ops') ||
          senderEmail.includes('via pricing') ||
          senderEmail.includes('via nam');

        // Check for carrier name patterns in sender (display name)
        const carrierNamePatterns = [
          'maersk', 'hapag', 'hlag', 'cma-cgm', 'cmacgm', 'msc',
          'evergreen', 'oocl', 'cosco', 'yangming', 'one-line', 'zim',
          'in.export', 'in.import', 'booking.confirmation', 'cma cgm'
        ];
        const hasCarrierInDisplayName = carrierNamePatterns.some(p => senderEmail.includes(p));

        // SUBJECT PATTERNS that indicate carrier emails
        const carrierSubjectPatterns = [
          /^booking confirmation\s*:\s*\d+/i,          // Maersk: "Booking Confirmation : 263815227"
          /^bkg\s*#?\s*\d+/i,                          // "Bkg #263441600"
          /amendment.*booking/i,                        // "Amendment to Booking"
          /booking.*amendment/i,                        // "Booking Amendment"
          /^\[hapag/i,                                  // Hapag-Lloyd emails
          /^\[msc\]/i,                                  // MSC emails
          /^one booking/i,                              // ONE Line
          /^cosco shipping line/i,                      // COSCO: "Cosco Shipping Line Booking Confirmation"
          /^cma cgm -/i,                                // CMA CGM: "CMA CGM - Booking confirmation available"
        ];
        const isCarrierSubject = carrierSubjectPatterns.some(p => p.test(subject));

        // DIRECTION DETECTION - Prioritize carrier signals
        let direction: 'inbound' | 'outbound';

        if (trueSenderIsCarrier) {
          // TRUE SENDER has carrier domain = definitely INBOUND (forwarded carrier email)
          direction = 'inbound';
        } else if (senderIsCarrier) {
          // SENDER has carrier domain = definitely INBOUND (direct carrier email)
          direction = 'inbound';
        } else if (isForwardedVia || hasCarrierInDisplayName) {
          // "via Operations" or carrier name in display name = INBOUND
          direction = 'inbound';
        } else if (isCarrierSubject) {
          // Subject matches carrier pattern = INBOUND
          direction = 'inbound';
        } else {
          // Default: check if from Intoglo
          const isIntoglo = senderEmail.includes('@intoglo.com') || senderEmail.includes('@intoglo.in');
          direction = isIntoglo ? 'outbound' : 'inbound';
        }

        // Look up the state mapping
        const mappingKey = `${doc.document_type}:${direction}`;
        const mapping = DIRECTION_WORKFLOW_MAPPING[mappingKey];

        if (mapping) {
          // PRIORITY RULE: For same document type, inbound (received) takes precedence over outbound (shared)
          // This handles cases where same booking confirmation is both forwarded internally AND received from carrier
          const shouldUpdate = mapping.order > highestOrder ||
            (direction === 'inbound' && triggerDoc === doc.document_type);

          if (shouldUpdate) {
            highestOrder = mapping.order;
            targetState = mapping.state;
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
      const orderA = Object.values(DIRECTION_WORKFLOW_MAPPING).find(m => m.state === a[0])?.order || 999;
      const orderB = Object.values(DIRECTION_WORKFLOW_MAPPING).find(m => m.state === b[0])?.order || 999;
      return orderA - orderB;
    });

  for (const [state, count] of sortedStates) {
    console.log(`  ${state.padEnd(40)} ${count.toString().padStart(4)}`);
  }
  console.log('');
}

backfillWorkflowStates().catch(console.error);
