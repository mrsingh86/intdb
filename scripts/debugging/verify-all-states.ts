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
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'checklist_shipper_approved': 44,
  'checklist_approved': 46,
  'shipping_bill_received': 48,
  'si_submitted': 55,
  'si_confirmed': 60,
  'vgm_submitted': 65,
  'vgm_confirmed': 68,
  'container_gated_in': 72,
  'sob_received': 80,
  'sob_shared': 85,
  'vessel_departed': 90,
  'isf_filed': 100,
  'isf_confirmed': 105,
  'mbl_draft_received': 110,
  'mbl_approved': 115,
  'mbl_received': 118,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_approved': 125,
  'hbl_released': 130,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'invoice_paid': 140,
  'docs_sent_to_broker': 150,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_customer_approved': 159,
  'entry_approved': 162,
  'entry_filed': 165,
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'customs_cleared': 190,
  'cargo_released': 192,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'out_for_delivery': 225,
  'delivered': 230,
  'pod_received': 235,
  'empty_returned': 240,
  'shipment_closed': 245,
  'booking_cancelled': 999,
};

// New states you introduced
const NEW_STATES = [
  'si_draft_received',
  'checklist_received',
  'checklist_shared',
  'shipping_bill_received',
  'entry_draft_received',
  'entry_draft_shared',
  'entry_summary_received',
  'entry_summary_shared',
  'duty_invoice_received',
  'duty_summary_shared',
];

// Document types that map to these states
const STATE_TO_DOCUMENTS: Record<string, { types: string[]; direction: 'inbound' | 'outbound' }> = {
  'si_draft_received': { types: ['si_draft', 'shipping_instruction'], direction: 'inbound' },
  'checklist_received': { types: ['checklist'], direction: 'inbound' },
  'checklist_shared': { types: ['checklist'], direction: 'outbound' },
  'shipping_bill_received': { types: ['shipping_bill', 'leo_copy'], direction: 'inbound' },
  'entry_draft_received': { types: ['draft_entry', 'customs_document'], direction: 'inbound' },
  'entry_draft_shared': { types: ['draft_entry'], direction: 'outbound' },
  'entry_summary_received': { types: ['entry_summary'], direction: 'inbound' },
  'entry_summary_shared': { types: ['entry_summary'], direction: 'outbound' },
  'duty_invoice_received': { types: ['duty_invoice'], direction: 'inbound' },
  'duty_summary_shared': { types: ['duty_invoice'], direction: 'outbound' },
};

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
  console.log('=== VERIFY ALL WORKFLOW STATES ===\n');

  // Load data
  const [shipments, docs, emails] = await Promise.all([
    getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type'),
    getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, email_direction'),
  ]);

  console.log(`Loaded: ${shipments.length} shipments, ${docs.length} documents, ${emails.length} emails\n`);

  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Build document index: shipmentId -> Set of "docType:direction"
  const shipmentDocIndex = new Map<string, Set<string>>();
  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email);
    const key = `${doc.document_type}:${direction}`;
    if (!shipmentDocIndex.has(doc.shipment_id)) {
      shipmentDocIndex.set(doc.shipment_id, new Set());
    }
    shipmentDocIndex.get(doc.shipment_id)!.add(key);
  }

  // Count current workflow_state distribution
  const stateCountCurrent: Record<string, number> = {};
  for (const s of shipments) {
    const state = s.workflow_state || 'NULL';
    stateCountCurrent[state] = (stateCountCurrent[state] || 0) + 1;
  }

  console.log('=== CURRENT WORKFLOW_STATE DISTRIBUTION ===\n');
  console.log('Count  State                          Order');
  console.log('─'.repeat(55));
  Object.entries(stateCountCurrent)
    .sort((a, b) => (STATE_ORDER[a[0]] || 999) - (STATE_ORDER[b[0]] || 999))
    .forEach(([state, count]) => {
      const order = STATE_ORDER[state] || 'MISSING';
      const isNew = NEW_STATES.includes(state) ? ' ← NEW' : '';
      console.log(`${count.toString().padStart(5)}  ${state.padEnd(32)} ${order}${isNew}`);
    });

  // Count documents for new states
  console.log('\n=== NEW STATES: DOCUMENT-BASED COUNT ===\n');
  console.log('State                           Shipments w/Doc   Current State');
  console.log('─'.repeat(65));

  for (const state of NEW_STATES) {
    const docConfig = STATE_TO_DOCUMENTS[state];
    if (!docConfig) continue;

    // Count shipments that have the required document
    let withDoc = 0;
    for (const [shipmentId, docSet] of shipmentDocIndex) {
      for (const docType of docConfig.types) {
        const key = `${docType}:${docConfig.direction}`;
        if (docSet.has(key)) {
          withDoc++;
          break;
        }
      }
    }

    // Count shipments currently AT this state
    const atState = stateCountCurrent[state] || 0;

    console.log(`${state.padEnd(30)}  ${withDoc.toString().padStart(5)} docs       ${atState.toString().padStart(5)} current`);
  }

  // Count document types
  console.log('\n=== DOCUMENT TYPE DISTRIBUTION ===\n');
  const docTypeCounts: Record<string, { inbound: number; outbound: number }> = {};
  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email);
    if (!docTypeCounts[doc.document_type]) {
      docTypeCounts[doc.document_type] = { inbound: 0, outbound: 0 };
    }
    docTypeCounts[doc.document_type][direction]++;
  }

  // Show only relevant document types
  const relevantTypes = ['checklist', 'shipping_bill', 'leo_copy', 'draft_entry', 'entry_summary', 'duty_invoice', 'si_draft', 'shipping_instruction'];
  console.log('Document Type              Inbound  Outbound');
  console.log('─'.repeat(50));
  for (const docType of relevantTypes) {
    const counts = docTypeCounts[docType] || { inbound: 0, outbound: 0 };
    if (counts.inbound > 0 || counts.outbound > 0) {
      console.log(`${docType.padEnd(25)}  ${counts.inbound.toString().padStart(5)}     ${counts.outbound.toString().padStart(5)}`);
    }
  }

  // Show if any documents exist but aren't being counted
  console.log('\n=== ALL DOCUMENT TYPES ===\n');
  Object.entries(docTypeCounts)
    .sort((a, b) => (b[1].inbound + b[1].outbound) - (a[1].inbound + a[1].outbound))
    .forEach(([docType, counts]) => {
      console.log(`${docType.padEnd(30)}  ${(counts.inbound + counts.outbound).toString().padStart(4)} (in:${counts.inbound} out:${counts.outbound})`);
    });
}

run().catch(console.error);
