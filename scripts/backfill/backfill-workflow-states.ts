/**
 * Backfill Workflow States
 *
 * Sets workflow_state and workflow_phase based on linked document types
 * for shipments that currently have NULL workflow_state
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Document type to workflow state mapping (in order of progression)
// Later documents in the lifecycle override earlier ones
const WORKFLOW_PROGRESSION: Array<{
  docTypes: string[];
  state: string;
  phase: string;
  priority: number;
}> = [
  // Booking phase
  { docTypes: ['booking_confirmation'], state: 'booking_confirmed', phase: 'booking', priority: 10 },
  { docTypes: ['booking_amendment'], state: 'booking_amended', phase: 'booking', priority: 15 },
  { docTypes: ['booking_cancellation'], state: 'booking_cancelled', phase: 'booking', priority: 5 },

  // Pre-departure phase
  { docTypes: ['shipping_instruction', 'si_draft', 'si_submission'], state: 'si_submitted', phase: 'pre_departure', priority: 20 },
  { docTypes: ['vgm_confirmation', 'vgm_submission'], state: 'vgm_submitted', phase: 'pre_departure', priority: 25 },
  { docTypes: ['gate_in_confirmation'], state: 'container_gated_in', phase: 'pre_departure', priority: 30 },
  { docTypes: ['hbl_draft'], state: 'hbl_draft_sent', phase: 'pre_departure', priority: 35 },
  { docTypes: ['draft_bl', 'bl_draft'], state: 'bl_draft_received', phase: 'pre_departure', priority: 40 },
  { docTypes: ['bill_of_lading', 'house_bl'], state: 'bl_received', phase: 'pre_departure', priority: 45 },
  { docTypes: ['sob_confirmation', 'shipment_notice'], state: 'departed', phase: 'pre_departure', priority: 50 },

  // In-transit phase
  { docTypes: ['isf_filing', 'isf_submission'], state: 'isf_filed', phase: 'in_transit', priority: 55 },
  { docTypes: ['arrival_notice'], state: 'arrival_notice_received', phase: 'in_transit', priority: 60 },

  // Arrival phase
  { docTypes: ['entry_summary', 'draft_entry'], state: 'customs_cleared', phase: 'arrival', priority: 65 },
  { docTypes: ['delivery_order'], state: 'delivery_order_received', phase: 'arrival', priority: 70 },
  { docTypes: ['container_release'], state: 'container_released', phase: 'arrival', priority: 75 },

  // Delivery phase
  { docTypes: ['delivery_appointment', 'delivery_notification'], state: 'delivery_scheduled', phase: 'delivery', priority: 80 },
  { docTypes: ['proof_of_delivery'], state: 'delivered', phase: 'delivery', priority: 85 },

  // Financial (doesn't change phase, just state)
  { docTypes: ['invoice', 'freight_invoice', 'commercial_invoice', 'duty_invoice'], state: 'invoice_sent', phase: '', priority: 90 },
];

async function backfillWorkflowStates(): Promise<void> {
  console.log('='.repeat(60));
  console.log('BACKFILL WORKFLOW STATES');
  console.log('='.repeat(60));

  // Get shipments with NULL workflow_state
  const { data: nullShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase')
    .is('workflow_state', null);

  console.log(`\nFound ${nullShipments?.length || 0} shipments with NULL workflow_state\n`);

  if (!nullShipments || nullShipments.length === 0) {
    console.log('No shipments need backfill!');
    return;
  }

  let updated = 0;
  let skipped = 0;
  const stateUpdates: Record<string, number> = {};

  for (const shipment of nullShipments) {
    // Get all linked documents for this shipment
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .eq('shipment_id', shipment.id);

    if (!docs || docs.length === 0) {
      skipped++;
      continue;
    }

    const docTypes = docs.map(d => d.document_type).filter(Boolean);

    // Find the highest priority matching workflow state
    let bestMatch: { state: string; phase: string; priority: number } | null = null;

    for (const rule of WORKFLOW_PROGRESSION) {
      const hasMatch = rule.docTypes.some(dt => docTypes.includes(dt));
      if (hasMatch) {
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = rule;
        }
      }
    }

    if (!bestMatch) {
      // Default to booking_confirmed if we have any documents
      bestMatch = { state: 'booking_confirmed', phase: 'booking', priority: 0 };
    }

    // Determine final phase (invoice doesn't change phase)
    let finalPhase = bestMatch.phase;
    if (!finalPhase && shipment.workflow_phase) {
      finalPhase = shipment.workflow_phase;
    } else if (!finalPhase) {
      // Determine phase based on document types
      if (docTypes.some(dt => ['proof_of_delivery'].includes(dt))) {
        finalPhase = 'delivery';
      } else if (docTypes.some(dt => ['delivery_order', 'container_release', 'entry_summary'].includes(dt))) {
        finalPhase = 'arrival';
      } else if (docTypes.some(dt => ['arrival_notice', 'isf_filing'].includes(dt))) {
        finalPhase = 'in_transit';
      } else if (docTypes.some(dt => ['sob_confirmation', 'bill_of_lading', 'shipping_instruction'].includes(dt))) {
        finalPhase = 'pre_departure';
      } else {
        finalPhase = 'booking';
      }
    }

    // Update the shipment
    const { error } = await supabase
      .from('shipments')
      .update({
        workflow_state: bestMatch.state,
        workflow_phase: finalPhase,
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipment.id);

    if (!error) {
      updated++;
      const key = `${bestMatch.state} / ${finalPhase}`;
      stateUpdates[key] = (stateUpdates[key] || 0) + 1;

      if (updated <= 5) {
        console.log(`${shipment.booking_number}: ${bestMatch.state} / ${finalPhase}`);
        console.log(`  Docs: ${docTypes.slice(0, 5).join(', ')}${docTypes.length > 5 ? '...' : ''}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (no docs): ${skipped}`);
  console.log('\nWorkflow state distribution:');
  for (const [state, count] of Object.entries(stateUpdates).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }
}

backfillWorkflowStates().catch(console.error);
