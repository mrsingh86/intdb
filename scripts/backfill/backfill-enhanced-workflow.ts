/**
 * Backfill Enhanced Workflow States
 *
 * Re-processes shipment documents through EnhancedWorkflowStateService
 * to populate the new workflow history columns:
 * - email_type
 * - sender_category
 * - trigger_type
 * - email_direction
 *
 * Uses classification metadata from document_classifications table.
 */

import { createClient } from '@supabase/supabase-js';
import { EnhancedWorkflowStateService, WorkflowTransitionInput } from '../lib/services/enhanced-workflow-state-service';
import { EmailType, SenderCategory } from '../lib/config/email-type-config';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const enhancedWorkflowService = new EnhancedWorkflowStateService(supabase);

interface ShipmentDoc {
  email_id: string;
  shipment_id: string;
  document_type: string;
  created_at: string;
}

interface Classification {
  email_id: string;
  document_type: string;
  email_type: string | null;
  sender_category: string | null;
  confidence_score: number;
}

interface Email {
  id: string;
  subject: string;
  sender_email: string;
  true_sender_email: string | null;
  received_at: string;
}

interface Shipment {
  id: string;
  booking_number: string;
  workflow_state: string | null;
}

async function backfillEnhancedWorkflow() {
  console.log('=== BACKFILL ENHANCED WORKFLOW STATES ===\n');

  // Get shipments to process
  const { data: shipments, error: shipError } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .not('booking_number', 'is', null)
    .order('created_at', { ascending: false });

  if (shipError || !shipments) {
    console.error('Failed to load shipments:', shipError);
    return;
  }

  console.log(`Found ${shipments.length} shipments to process\n`);

  let processed = 0;
  let transitioned = 0;
  let skipped = 0;
  let errors = 0;

  for (const shipment of shipments) {
    console.log(`\n[${shipment.booking_number}] Current state: ${shipment.workflow_state || 'none'}`);

    // Get documents linked to this shipment
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id, shipment_id, document_type, created_at')
      .eq('shipment_id', shipment.id)
      .not('email_id', 'is', null)
      .order('created_at', { ascending: true });

    if (!docs || docs.length === 0) {
      console.log(`  No documents linked`);
      skipped++;
      continue;
    }

    console.log(`  ${docs.length} documents to process`);

    // Process each document in chronological order
    for (const doc of docs) {
      // Get classification for this email
      const { data: classification } = await supabase
        .from('document_classifications')
        .select('email_id, document_type, email_type, sender_category, confidence_score')
        .eq('email_id', doc.email_id)
        .single();

      // Get email details
      const { data: email } = await supabase
        .from('raw_emails')
        .select('id, subject, sender_email, true_sender_email, received_at')
        .eq('id', doc.email_id)
        .single();

      if (!email) {
        console.log(`    ⚠ Email ${doc.email_id.substring(0, 8)} not found`);
        continue;
      }

      // Determine direction from sender
      const senderEmail = email.true_sender_email || email.sender_email || '';
      const isOutbound = senderEmail.toLowerCase().includes('@intoglo.com') ||
                         senderEmail.toLowerCase().includes('@intoglo.in');
      const direction: 'inbound' | 'outbound' = isOutbound ? 'outbound' : 'inbound';

      // Build transition input
      const transitionInput: WorkflowTransitionInput = {
        shipmentId: shipment.id,
        documentType: classification?.document_type || doc.document_type || 'unknown',
        emailType: (classification?.email_type as EmailType) || 'general_notification',
        direction,
        senderCategory: (classification?.sender_category as SenderCategory) || 'unknown',
        emailId: doc.email_id,
        subject: email.subject || '',
      };

      try {
        const result = await enhancedWorkflowService.transitionFromClassification(transitionInput);

        if (result.success) {
          console.log(`    ✓ ${result.previousState} → ${result.newState} (${result.triggeredBy}: ${transitionInput.documentType}/${transitionInput.emailType})`);
          transitioned++;
        } else if (result.skippedReason) {
          // Only log interesting skips
          if (!result.skippedReason.includes('No matching rule') &&
              !result.skippedReason.includes('already at or past')) {
            console.log(`    → Skipped: ${result.skippedReason}`);
          }
        }
      } catch (err: any) {
        console.log(`    ✗ Error: ${err.message}`);
        errors++;
      }

      processed++;
    }
  }

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`Shipments: ${shipments.length}`);
  console.log(`Documents processed: ${processed}`);
  console.log(`Transitions made: ${transitioned}`);
  console.log(`Shipments skipped (no docs): ${skipped}`);
  console.log(`Errors: ${errors}`);

  // Show sample of enhanced workflow history
  console.log('\n=== SAMPLE ENHANCED WORKFLOW HISTORY ===');
  const { data: history } = await supabase
    .from('shipment_workflow_history')
    .select('from_state, to_state, triggered_by_document_type, email_type, sender_category, trigger_type, email_direction, created_at')
    .not('email_type', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (history && history.length > 0) {
    for (const h of history) {
      console.log(`  ${h.from_state} → ${h.to_state}`);
      console.log(`    doc: ${h.triggered_by_document_type}, email: ${h.email_type}, sender: ${h.sender_category}, trigger: ${h.trigger_type}, dir: ${h.email_direction}`);
    }
  } else {
    console.log('  No enhanced workflow history entries yet');
  }
}

backfillEnhancedWorkflow()
  .then(() => {
    console.log('\n✅ Backfill complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  });
