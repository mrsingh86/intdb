/**
 * Backfill workflow_state for new states based on linked documents
 */
import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Complete STATE_ORDER
const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'shipping_bill_received': 48,
  'si_confirmed': 60,
  'vgm_submitted': 65,
  'sob_received': 80,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'cargo_released': 192,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'pod_received': 235,
};

// Document type -> workflow state mapping (with direction)
const DOC_TO_STATE: Array<{
  docTypes: string[];
  direction: 'inbound' | 'outbound';
  state: string;
}> = [
  // Pre-Shipment
  { docTypes: ['booking_confirmation', 'booking_amendment'], direction: 'inbound', state: 'booking_confirmation_received' },
  { docTypes: ['booking_confirmation', 'booking_amendment'], direction: 'outbound', state: 'booking_confirmation_shared' },
  { docTypes: ['si_draft', 'shipping_instruction'], direction: 'inbound', state: 'si_draft_received' },
  { docTypes: ['si_draft', 'shipping_instruction'], direction: 'outbound', state: 'si_draft_sent' },
  { docTypes: ['checklist'], direction: 'inbound', state: 'checklist_received' },
  { docTypes: ['checklist'], direction: 'outbound', state: 'checklist_shared' },
  { docTypes: ['shipping_bill', 'leo_copy'], direction: 'inbound', state: 'shipping_bill_received' },
  { docTypes: ['si_submission', 'si_confirmation'], direction: 'inbound', state: 'si_confirmed' },
  { docTypes: ['vgm_submission', 'vgm_confirmation'], direction: 'inbound', state: 'vgm_submitted' },

  // In-Transit
  { docTypes: ['sob_confirmation'], direction: 'inbound', state: 'sob_received' },
  { docTypes: ['bill_of_lading', 'house_bl'], direction: 'inbound', state: 'bl_received' },
  { docTypes: ['bill_of_lading', 'house_bl', 'hbl_draft'], direction: 'outbound', state: 'hbl_shared' },
  { docTypes: ['invoice', 'freight_invoice'], direction: 'outbound', state: 'invoice_sent' },

  // Arrival & Customs
  { docTypes: ['arrival_notice', 'shipment_notice'], direction: 'inbound', state: 'arrival_notice_received' },
  { docTypes: ['arrival_notice'], direction: 'outbound', state: 'arrival_notice_shared' },
  { docTypes: ['draft_entry', 'customs_document'], direction: 'inbound', state: 'entry_draft_received' },
  { docTypes: ['draft_entry'], direction: 'outbound', state: 'entry_draft_shared' },
  { docTypes: ['entry_summary'], direction: 'inbound', state: 'entry_summary_received' },
  { docTypes: ['entry_summary'], direction: 'outbound', state: 'entry_summary_shared' },
  { docTypes: ['duty_invoice'], direction: 'inbound', state: 'duty_invoice_received' },
  { docTypes: ['duty_invoice', 'customs_document'], direction: 'outbound', state: 'duty_summary_shared' },

  // Delivery
  { docTypes: ['container_release'], direction: 'inbound', state: 'cargo_released' },
  { docTypes: ['delivery_order'], direction: 'inbound', state: 'delivery_order_received' },
  { docTypes: ['delivery_order'], direction: 'outbound', state: 'delivery_order_shared' },
  { docTypes: ['container_release'], direction: 'outbound', state: 'container_released' },
  { docTypes: ['proof_of_delivery', 'pod_confirmation'], direction: 'inbound', state: 'pod_received' },
];

interface Shipment {
  id: string;
  booking_number: string;
  workflow_state: string | null;
}

interface Doc {
  shipment_id: string;
  email_id: string;
  document_type: string;
}

interface Email {
  id: string;
  sender_email: string | null;
  email_direction: string | null;
}

function getDirection(email: Email): 'inbound' | 'outbound' {
  if (email.email_direction) {
    return email.email_direction as 'inbound' | 'outbound';
  }
  const sender = (email.sender_email || '').toLowerCase();
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    return 'outbound';
  }
  return 'inbound';
}

async function run() {
  console.log('=== BACKFILL WORKFLOW STATES FROM DOCUMENTS ===\n');

  // Load data
  console.log('Loading data...');
  const [shipments, docs, emails] = await Promise.all([
    getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type'),
    getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, email_direction'),
  ]);

  console.log(`  Shipments: ${shipments.length}`);
  console.log(`  Documents: ${docs.length}`);
  console.log(`  Emails: ${emails.length}\n`);

  const emailMap = new Map(emails.map(e => [e.id, e]));
  const shipmentMap = new Map(shipments.map(s => [s.id, s]));

  // Build document index: shipmentId -> list of {docType, direction}
  const shipmentDocs = new Map<string, Array<{ docType: string; direction: 'inbound' | 'outbound' }>>();
  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email);
    if (!shipmentDocs.has(doc.shipment_id)) {
      shipmentDocs.set(doc.shipment_id, []);
    }
    shipmentDocs.get(doc.shipment_id)!.push({ docType: doc.document_type, direction });
  }

  // Determine highest state for each shipment
  console.log('Processing shipments...\n');
  const updates: Array<{ id: string; booking: string; oldState: string; newState: string }> = [];

  for (const shipment of shipments) {
    const docList = shipmentDocs.get(shipment.id) || [];

    // Find all matching states
    const matchedStates: string[] = [];
    for (const docInfo of docList) {
      for (const mapping of DOC_TO_STATE) {
        if (mapping.docTypes.includes(docInfo.docType) && mapping.direction === docInfo.direction) {
          matchedStates.push(mapping.state);
        }
      }
    }

    // Find highest state
    let highestState = '';
    let highestOrder = 0;
    for (const state of matchedStates) {
      const order = STATE_ORDER[state] || 0;
      if (order > highestOrder) {
        highestOrder = order;
        highestState = state;
      }
    }

    // Compare with current
    const currentOrder = STATE_ORDER[shipment.workflow_state || ''] || 0;

    if (highestOrder > currentOrder) {
      updates.push({
        id: shipment.id,
        booking: shipment.booking_number,
        oldState: shipment.workflow_state || 'NULL',
        newState: highestState,
      });
    }
  }

  console.log(`Found ${updates.length} shipments to update\n`);

  if (updates.length === 0) {
    console.log('No updates needed.');
    return;
  }

  // Show updates
  console.log('Updates to apply:');
  updates.slice(0, 30).forEach(u => {
    console.log(`  ${u.booking}: ${u.oldState} → ${u.newState}`);
  });
  if (updates.length > 30) {
    console.log(`  ... and ${updates.length - 30} more`);
  }

  // Apply updates
  console.log('\nApplying updates...');
  let updated = 0;
  let errors = 0;

  for (const u of updates) {
    const { error } = await supabase
      .from('shipments')
      .update({ workflow_state: u.newState })
      .eq('id', u.id);

    if (error) {
      errors++;
      console.error(`  Error updating ${u.booking}: ${error.message}`);
    } else {
      updated++;
    }
  }

  console.log(`\nUpdated: ${updated}`);
  console.log(`Errors: ${errors}`);

  // Final distribution
  console.log('\n=== FINAL WORKFLOW STATE DISTRIBUTION ===\n');
  const { data: finalShipments } = await supabase
    .from('shipments')
    .select('workflow_state');

  const stateCounts: Record<string, number> = {};
  finalShipments?.forEach(s => {
    const state = s.workflow_state || 'NULL';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  });

  Object.entries(stateCounts)
    .sort((a, b) => (STATE_ORDER[a[0]] || 999) - (STATE_ORDER[b[0]] || 999))
    .forEach(([state, count]) => {
      console.log(`  ${count.toString().padStart(4)} ${state}`);
    });
}

run().catch(console.error);
