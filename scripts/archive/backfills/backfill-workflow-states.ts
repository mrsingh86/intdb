/**
 * Backfill Workflow States (FORWARD ONLY)
 *
 * Only advances workflow states, never regresses.
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// State order lookup
const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'si_draft_received': 30,
  'si_draft_sent': 35,
  'si_confirmed': 40,
  'sob_received': 60,
  'mbl_draft_received': 80,
  'hbl_draft_sent': 85,
  'hbl_released': 90,
  'invoice_sent': 95,
  'arrival_notice_received': 110,
  'arrival_notice_shared': 115,
  'duty_invoice_received': 130,
  'duty_summary_shared': 135,
  'cargo_released': 160,
  'pod_received': 200,
  'booking_cancelled': 999,
};

// Direction-aware document type to workflow state mapping
const DIRECTION_WORKFLOW_MAPPING: Record<string, string> = {
  'booking_confirmation:inbound': 'booking_confirmation_received',
  'booking_confirmation:outbound': 'booking_confirmation_shared',
  'booking_cancellation:inbound': 'booking_cancelled',
  'invoice:inbound': 'commercial_invoice_received',
  'shipping_instruction:inbound': 'si_draft_received',
  'si_draft:inbound': 'si_draft_received',
  'si_draft:outbound': 'si_draft_sent',
  'si_confirmation:inbound': 'si_confirmed',
  'sob_confirmation:inbound': 'sob_received',
  'mbl_draft:inbound': 'mbl_draft_received',
  'bill_of_lading:inbound': 'mbl_draft_received',
  'hbl_draft:outbound': 'hbl_draft_sent',
  'bill_of_lading:outbound': 'hbl_released',
  'house_bl:outbound': 'hbl_released',
  'freight_invoice:outbound': 'invoice_sent',
  'invoice:outbound': 'invoice_sent',
  'arrival_notice:inbound': 'arrival_notice_received',
  'arrival_notice:outbound': 'arrival_notice_shared',
  'customs_document:inbound': 'duty_invoice_received',
  'duty_invoice:outbound': 'duty_summary_shared',
  'container_release:inbound': 'cargo_released',
  'pod:inbound': 'pod_received',
};

const STATE_PHASES: Record<string, string> = {
  'booking_confirmation_received': 'pre_departure',
  'booking_confirmation_shared': 'pre_departure',
  'si_draft_received': 'pre_departure',
  'si_confirmed': 'pre_departure',
  'sob_received': 'pre_departure',
  'mbl_draft_received': 'in_transit',
  'hbl_released': 'in_transit',
  'invoice_sent': 'in_transit',
  'arrival_notice_received': 'arrival',
  'arrival_notice_shared': 'arrival',
  'duty_invoice_received': 'arrival',
  'duty_summary_shared': 'arrival',
  'cargo_released': 'arrival',
  'pod_received': 'delivery',
  'booking_cancelled': 'pre_departure',
};

interface ShipmentDocument {
  shipment_id: string;
  document_type: string;
  email_id: string;
}

async function backfillWorkflowStates() {
  console.log('=== WORKFLOW STATE BACKFILL (FORWARD ONLY) ===\n');

  const shipments = await getAllRows<{id: string; booking_number: string; workflow_state: string}>(
    supabase, 'shipments', 'id, booking_number, workflow_state'
  );
  console.log(`Shipments: ${shipments.length}`);

  const docs = await getAllRows<ShipmentDocument>(
    supabase, 'shipment_documents', 'shipment_id, document_type, email_id'
  );
  console.log(`Documents: ${docs.length}`);

  const emails = await getAllRows<{id: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, email_direction'
  );
  const dirMap = new Map(emails.map(e => [e.id, e.email_direction]));

  const docsByShipment = new Map<string, ShipmentDocument[]>();
  docs.forEach(doc => {
    const arr = docsByShipment.get(doc.shipment_id) || [];
    arr.push(doc);
    docsByShipment.set(doc.shipment_id, arr);
  });

  let updated = 0, unchanged = 0, skipped = 0;
  const changes: string[] = [];

  for (const ship of shipments) {
    const shipDocs = docsByShipment.get(ship.id) || [];
    if (shipDocs.length === 0) { unchanged++; continue; }

    const currentOrder = STATE_ORDER[ship.workflow_state] || 0;
    let maxOrder = 0;
    let targetState = '';

    for (const doc of shipDocs) {
      const dir = dirMap.get(doc.email_id) || 'inbound';
      const key = `${doc.document_type}:${dir}`;
      const state = DIRECTION_WORKFLOW_MAPPING[key];
      if (state) {
        const order = STATE_ORDER[state] || 0;
        if (order > maxOrder) {
          maxOrder = order;
          targetState = state;
        }
      }
    }

    // Only advance, never regress
    if (maxOrder <= currentOrder || !targetState) {
      unchanged++;
      continue;
    }

    const { error } = await supabase
      .from('shipments')
      .update({
        workflow_state: targetState,
        workflow_phase: STATE_PHASES[targetState] || 'pre_departure',
      })
      .eq('id', ship.id);

    if (!error) {
      updated++;
      changes.push(`${ship.booking_number}: ${ship.workflow_state} → ${targetState}`);
    }
  }

  console.log(`\nUpdated: ${updated}, Unchanged: ${unchanged}`);
  if (changes.length > 0) {
    console.log('\nChanges (forward only):');
    changes.forEach(c => console.log(`  ${c}`));
  }
}

backfillWorkflowStates().catch(console.error);
