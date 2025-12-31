#!/usr/bin/env npx tsx
/**
 * Update Shipment Workflow States
 * Updates workflow states based on documents received
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Workflow state progression based on documents
// IMPORTANT: Only RELEASED documents should trigger hbl_released state
// Drafts should trigger hbl_draft_sent state
const DOC_TO_STATE: Record<string, { state: string; phase: string; status: string }> = {
  // BL Release documents - ONLY these trigger hbl_released
  'bl_released': { state: 'hbl_released', phase: 'in_transit', status: 'in_transit' },
  'hbl_released': { state: 'hbl_released', phase: 'in_transit', status: 'in_transit' },
  'telex_release': { state: 'hbl_released', phase: 'in_transit', status: 'in_transit' },

  // BL Draft documents - trigger draft state, NOT released
  'bl_draft': { state: 'hbl_draft_sent', phase: 'pre_departure', status: 'booked' },
  'hbl_draft': { state: 'hbl_draft_sent', phase: 'pre_departure', status: 'booked' },
  'bill_of_lading': { state: 'hbl_draft_sent', phase: 'pre_departure', status: 'booked' },

  // SI documents
  'shipping_instruction': { state: 'si_confirmed', phase: 'pre_departure', status: 'booked' },
  'si_draft': { state: 'si_draft_received', phase: 'pre_departure', status: 'booked' },
  'si_submission': { state: 'si_confirmed', phase: 'pre_departure', status: 'booked' },
  'bl_instruction': { state: 'si_confirmed', phase: 'pre_departure', status: 'booked' },

  // VGM documents
  'vgm_confirmation': { state: 'vgm_confirmed', phase: 'pre_departure', status: 'booked' },
  'vgm_submission': { state: 'vgm_confirmed', phase: 'pre_departure', status: 'booked' },

  // Pre-departure documents
  'commercial_invoice': { state: 'invoice_received', phase: 'pre_departure', status: 'booked' },
  'packing_list': { state: 'packing_received', phase: 'pre_departure', status: 'booked' },
  'sob_confirmation': { state: 'si_confirmed', phase: 'pre_departure', status: 'booked' },

  // Arrival documents
  'arrival_notice': { state: 'arrival_notice_received', phase: 'arrival', status: 'in_transit' },
  'customs_clearance': { state: 'customs_received', phase: 'arrival', status: 'in_transit' },
  'delivery_order': { state: 'delivery_ordered', phase: 'arrival', status: 'in_transit' },
};

// Priority order (higher = later in workflow)
// hbl_released (8) should ONLY be reached via actual release documents
// hbl_draft_sent (7) is for drafts - NOT released yet
const STATE_PRIORITY: Record<string, number> = {
  'booking_confirmed': 1,
  'booking_confirmation_received': 1,
  'invoice_received': 2,
  'packing_received': 3,
  'si_draft_received': 4,
  'si_confirmed': 5,
  'vgm_confirmed': 6,
  'hbl_draft_sent': 7,       // BL draft received - NOT released
  'hbl_released': 8,          // ONLY via bl_released/hbl_released/telex_release
  'arrival_notice_received': 9,
  'customs_received': 10,
  'delivery_ordered': 11,
  'pod_received': 12,
};

async function updateWorkflows() {
  console.log('============================================================');
  console.log('UPDATE WORKFLOW STATES BASED ON DOCUMENTS');
  console.log('============================================================');

  // Get all document lifecycle entries grouped by shipment
  const { data: docs } = await supabase
    .from('document_lifecycle')
    .select('shipment_id, document_type');

  // Group by shipment
  const shipmentDocs = new Map<string, string[]>();
  for (const d of docs || []) {
    if (!d.shipment_id) continue;
    if (!shipmentDocs.has(d.shipment_id)) {
      shipmentDocs.set(d.shipment_id, []);
    }
    shipmentDocs.get(d.shipment_id)!.push(d.document_type);
  }

  console.log(`Shipments with documents: ${shipmentDocs.size}`);

  let updated = 0;
  const stateUpdates: Record<string, number> = {};

  for (const [shipmentId, docTypes] of shipmentDocs) {
    // Find the highest priority document type
    let bestState = { state: 'booking_confirmation_received', phase: 'pre_shipment', status: 'booked' };
    let bestPriority = 1;

    for (const docType of docTypes) {
      const stateInfo = DOC_TO_STATE[docType];
      if (stateInfo) {
        const priority = STATE_PRIORITY[stateInfo.state] || 0;
        if (priority > bestPriority) {
          bestState = stateInfo;
          bestPriority = priority;
        }
      }
    }

    // Track updates
    stateUpdates[bestState.state] = (stateUpdates[bestState.state] || 0) + 1;

    // Update shipment
    const { error } = await supabase
      .from('shipments')
      .update({
        workflow_state: bestState.state,
        workflow_phase: bestState.phase,
        status: bestState.status
      })
      .eq('id', shipmentId);

    if (!error) updated++;
  }

  console.log(`\nUpdated: ${updated} shipments`);
  console.log('\nState updates distribution:');
  for (const [state, count] of Object.entries(stateUpdates).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }

  // Show final distribution
  const { data: states } = await supabase.from('shipments').select('workflow_state, workflow_phase');
  const finalCounts: Record<string, number> = {};
  const phaseCounts: Record<string, number> = {};

  for (const s of states || []) {
    finalCounts[s.workflow_state] = (finalCounts[s.workflow_state] || 0) + 1;
    phaseCounts[s.workflow_phase] = (phaseCounts[s.workflow_phase] || 0) + 1;
  }

  console.log('\n============================================================');
  console.log('FINAL WORKFLOW DISTRIBUTION');
  console.log('============================================================');

  console.log('\nBy State:');
  for (const [state, count] of Object.entries(finalCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state}: ${count}`);
  }

  console.log('\nBy Phase:');
  for (const [phase, count] of Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${phase}: ${count}`);
  }
}

updateWorkflows().catch(console.error);
