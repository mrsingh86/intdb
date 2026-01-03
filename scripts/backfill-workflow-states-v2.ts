/**
 * Backfill Workflow States v2
 *
 * Uses the updated logic that distinguishes SI sources:
 * - SI from shipper/client → si_draft_received
 * - SI confirmation from carrier → si_confirmed
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Carrier sender patterns
const CARRIER_SENDER_PATTERNS = [
  /maersk/i,
  /hlag|hapag/i,
  /cosco|coscon/i,
  /cma.?cgm/i,
  /one-line|ocean network express/i,
  /evergreen/i,
  /\bmsc\b|mediterranean shipping/i,
  /yang.?ming|yml/i,
  /\bzim\b/i,
  /oocl/i,
  /apl\b/i,
  /noreply@hlag/i,
  /donotreply@maersk/i,
  /do_not_reply/i,
  /donotreply/i,
  /@service\.hlag/i,
];

function isCarrierSender(senderEmail: string | null | undefined): boolean {
  if (!senderEmail) return false;
  const sender = senderEmail.toLowerCase();
  return CARRIER_SENDER_PATTERNS.some(pattern => pattern.test(sender));
}

function isIntogloSender(senderEmail: string | null | undefined): boolean {
  if (!senderEmail) return false;
  const sender = senderEmail.toLowerCase();
  // Direct Intoglo sender (not via group forward)
  if (sender.includes(' via ')) return false;
  return sender.includes('@intoglo.com') || sender.includes('@intoglo.in');
}

// State order for comparison
const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 35,
  'si_submitted': 38,
  'si_confirmed': 40,
  'vgm_submitted': 50,
  'vgm_confirmed': 55,
  'container_gated_in': 58,
  'sob_received': 60,
  'vessel_departed': 65,
  'isf_filed': 70,
  'isf_confirmed': 75,
  'mbl_draft_received': 80,
  'hbl_draft_sent': 85,
  'hbl_released': 90,
  'invoice_sent': 95,
  'invoice_paid': 100,
  'arrival_notice_received': 110,
  'arrival_notice_shared': 115,
  'entry_draft_received': 120,
  'entry_filed': 125,
  'duty_invoice_received': 130,
  'duty_summary_shared': 135,
  'customs_cleared': 140,
  'delivery_order_received': 150,
  'cargo_released': 160,
  'out_for_delivery': 180,
  'delivered': 190,
  'pod_received': 200,
  'booking_cancelled': 999,
};

// Document type to workflow state mapping with sender awareness
function getWorkflowState(
  documentType: string,
  direction: 'inbound' | 'outbound',
  senderEmail: string | null
): string | null {
  const fromCarrier = isCarrierSender(senderEmail);
  const fromIntoglo = isIntogloSender(senderEmail);

  // SI documents - special handling
  const siDocTypes = ['shipping_instruction', 'si_draft', 'si_submission'];
  if (siDocTypes.includes(documentType)) {
    if (direction === 'inbound') {
      if (documentType === 'si_submission' || fromCarrier) {
        return 'si_confirmed';
      } else {
        return 'si_draft_received';
      }
    } else {
      // outbound
      if (documentType === 'si_submission') {
        return 'si_submitted';
      }
      return 'si_draft_sent';
    }
  }

  // Standard mappings
  const mappings: Record<string, string> = {
    // Booking
    'booking_confirmation:inbound': 'booking_confirmation_received',
    'booking_amendment:inbound': 'booking_confirmation_received',
    'booking_confirmation:outbound': 'booking_confirmation_shared',
    'booking_amendment:outbound': 'booking_confirmation_shared',

    // Cancellation
    'booking_cancellation:inbound': 'booking_cancelled',

    // Documentation
    'invoice:inbound': 'commercial_invoice_received',
    'commercial_invoice:inbound': 'commercial_invoice_received',
    'packing_list:inbound': 'packing_list_received',

    // VGM
    'vgm_submission:inbound': 'vgm_confirmed',
    'vgm_submission:outbound': 'vgm_submitted',
    'vgm_confirmation:inbound': 'vgm_confirmed',

    // Gate-in & SOB
    'gate_in_confirmation:inbound': 'container_gated_in',
    'sob_confirmation:inbound': 'sob_received',

    // Departure
    'departure_notice:inbound': 'vessel_departed',
    'sailing_confirmation:inbound': 'vessel_departed',

    // ISF
    'isf_submission:outbound': 'isf_filed',
    'isf_confirmation:inbound': 'isf_confirmed',

    // BL
    'mbl_draft:inbound': 'mbl_draft_received',
    'bill_of_lading:inbound': 'mbl_draft_received',
    'hbl_draft:outbound': 'hbl_draft_sent',
    'hbl_release:outbound': 'hbl_released',
    'bill_of_lading:outbound': 'hbl_released',
    'house_bl:outbound': 'hbl_released',

    // Invoice
    'freight_invoice:outbound': 'invoice_sent',
    'invoice:outbound': 'invoice_sent',
    'payment_confirmation:inbound': 'invoice_paid',

    // Arrival
    'arrival_notice:inbound': 'arrival_notice_received',
    'arrival_notice:outbound': 'arrival_notice_shared',
    'shipment_notice:inbound': 'arrival_notice_received',

    // Customs
    'customs_clearance:inbound': 'customs_cleared',
    'customs_document:inbound': 'duty_invoice_received',
    'duty_invoice:inbound': 'duty_invoice_received',
    'duty_invoice:outbound': 'duty_summary_shared',
    'customs_document:outbound': 'duty_summary_shared',

    // Delivery
    'delivery_order:inbound': 'delivery_order_received',
    'container_release:inbound': 'cargo_released',
    'dispatch_notice:inbound': 'out_for_delivery',
    'delivery_confirmation:inbound': 'delivered',
    'pod:inbound': 'pod_received',
    'proof_of_delivery:inbound': 'pod_received',
  };

  const key = `${documentType}:${direction}`;
  return mappings[key] || null;
}

interface Shipment {
  id: string;
  booking_number: string;
  workflow_state: string | null;
}

interface Doc {
  shipment_id: string;
  email_id: string;
  document_type: string;
  created_at: string;
}

interface Email {
  id: string;
  sender_email: string;
  email_direction: string;
}

async function backfillWorkflowStates() {
  console.log('='.repeat(80));
  console.log('BACKFILL WORKFLOW STATES v2');
  console.log('Using updated SI logic (shipper vs carrier distinction)');
  console.log('='.repeat(80));
  console.log('');

  // Load all data
  console.log('Loading data...');
  const shipments = await getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const docs = await getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type, created_at');
  const emails = await getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, email_direction');

  const emailMap = new Map(emails.map(e => [e.id, e]));

  console.log('Shipments:', shipments.length);
  console.log('Documents:', docs.length);
  console.log('Emails:', emails.length);
  console.log('');

  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  const changes: Array<{
    booking: string;
    oldState: string | null;
    newState: string;
    reason: string;
  }> = [];

  for (const shipment of shipments) {
    // Get all documents for this shipment, sorted by date
    const shipDocs = docs
      .filter(d => d.shipment_id === shipment.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (shipDocs.length === 0) continue;

    // Calculate the highest workflow state from all documents
    let highestState: string | null = null;
    let highestOrder = 0;
    let triggerDoc: { type: string; sender: string } | null = null;

    for (const doc of shipDocs) {
      const email = emailMap.get(doc.email_id);
      if (!email) continue;

      const direction = (email.email_direction || 'inbound') as 'inbound' | 'outbound';
      const state = getWorkflowState(doc.document_type, direction, email.sender_email);

      if (state) {
        const order = STATE_ORDER[state] || 0;
        if (order > highestOrder) {
          highestOrder = order;
          highestState = state;
          triggerDoc = { type: doc.document_type, sender: email.sender_email?.substring(0, 40) || 'N/A' };
        }
      }
    }

    if (!highestState) continue;

    const currentOrder = STATE_ORDER[shipment.workflow_state || ''] || 0;

    // Only update if we found a higher state
    if (highestOrder > currentOrder) {
      const { error } = await supabase
        .from('shipments')
        .update({
          workflow_state: highestState,
          workflow_state_updated_at: new Date().toISOString(),
        })
        .eq('id', shipment.id);

      if (error) {
        console.error(`Error updating ${shipment.booking_number}:`, error.message);
        errors++;
      } else {
        changes.push({
          booking: shipment.booking_number,
          oldState: shipment.workflow_state,
          newState: highestState,
          reason: `${triggerDoc?.type} from ${triggerDoc?.sender}`,
        });
        updated++;
      }
    } else {
      unchanged++;
    }
  }

  // Print results
  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log('Updated:', updated);
  console.log('Unchanged:', unchanged);
  console.log('Errors:', errors);
  console.log('');

  if (changes.length > 0) {
    console.log('='.repeat(80));
    console.log('CHANGES MADE');
    console.log('='.repeat(80));
    console.log('');

    // Group by state transition
    const byTransition: Record<string, typeof changes> = {};
    for (const change of changes) {
      const key = `${change.oldState || 'null'} → ${change.newState}`;
      if (!byTransition[key]) byTransition[key] = [];
      byTransition[key].push(change);
    }

    for (const [transition, items] of Object.entries(byTransition)) {
      console.log(`${transition} (${items.length} shipments)`);
      items.slice(0, 5).forEach(item => {
        console.log(`  - ${item.booking}: ${item.reason}`);
      });
      if (items.length > 5) {
        console.log(`  ... and ${items.length - 5} more`);
      }
      console.log('');
    }
  }

  // Show current distribution
  console.log('='.repeat(80));
  console.log('NEW WORKFLOW STATE DISTRIBUTION');
  console.log('='.repeat(80));

  const { data: updatedShipments } = await supabase
    .from('shipments')
    .select('workflow_state');

  const stateCounts: Record<string, number> = {};
  (updatedShipments || []).forEach(s => {
    const state = s.workflow_state || 'null';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  });

  const sortedStates = Object.entries(stateCounts)
    .sort((a, b) => (STATE_ORDER[a[0]] || 0) - (STATE_ORDER[b[0]] || 0));

  console.log('');
  console.log('State'.padEnd(40) + 'Count');
  console.log('-'.repeat(50));
  for (const [state, count] of sortedStates) {
    console.log(state.padEnd(40) + count);
  }
}

backfillWorkflowStates().catch(console.error);
