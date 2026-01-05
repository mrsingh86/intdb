require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Workflow state mappings - focused on key states
const WORKFLOW_STATE_MAP = {
  // PRE_DEPARTURE - Booking
  'booking_confirmation:inbound': 'booking_confirmation_received',
  'booking_confirmation:outbound': 'booking_confirmation_shared',
  'booking_amendment:inbound': 'booking_confirmation_received',
  'booking_amendment:outbound': 'booking_confirmation_shared',
  'booking_cancellation:inbound': 'booking_cancelled',
  'booking_cancellation:outbound': 'booking_cancelled',

  // PRE_DEPARTURE - Commercial docs
  'invoice:inbound': 'commercial_invoice_received',
  'commercial_invoice:inbound': 'commercial_invoice_received',
  'packing_list:inbound': 'packing_list_received',

  // PRE_DEPARTURE - SI
  'si_draft:inbound': 'si_draft_received',
  'si_draft:outbound': 'si_draft_sent',
  'shipping_instruction:inbound': 'si_draft_received',
  'shipping_instruction:outbound': 'si_draft_sent',
  'si_submission:inbound': 'si_confirmed',
  'si_submission:outbound': 'si_submitted',
  'si_confirmation:inbound': 'si_confirmed',
  'si_confirmation:outbound': 'si_confirmed',

  // PRE_DEPARTURE - India Export
  'checklist:inbound': 'checklist_received',
  'checklist:outbound': 'checklist_shared',
  'shipping_bill:inbound': 'shipping_bill_received',
  'shipping_bill:outbound': 'shipping_bill_received',
  'leo_copy:inbound': 'shipping_bill_received',

  // PRE_DEPARTURE - VGM
  'vgm_submission:inbound': 'vgm_confirmed',
  'vgm_submission:outbound': 'vgm_submitted',
  'vgm_confirmation:inbound': 'vgm_confirmed',
  'vgm_reminder:inbound': 'vgm_pending',
  'vgm_reminder:outbound': 'vgm_pending',

  // PRE_DEPARTURE - Gate/SOB
  'gate_in_confirmation:inbound': 'container_gated_in',
  'gate_in_confirmation:outbound': 'container_gated_in',
  'sob_confirmation:inbound': 'sob_received',
  'sob_confirmation:outbound': 'sob_shared',

  // IN_TRANSIT - BL
  'bill_of_lading:inbound': 'bl_received',
  'bill_of_lading:outbound': 'hbl_shared',
  'hbl_draft:inbound': 'hbl_draft_sent',
  'hbl_draft:outbound': 'hbl_draft_sent',
  'house_bl:outbound': 'hbl_released',
  'house_bl:inbound': 'bl_received',

  // IN_TRANSIT - Invoice
  'freight_invoice:outbound': 'invoice_sent',
  'freight_invoice:inbound': 'commercial_invoice_received',
  'invoice:outbound': 'invoice_sent',

  // PRE_ARRIVAL - Entry (FOCUSED)
  'draft_entry:inbound': 'entry_draft_received',
  'draft_entry:outbound': 'entry_draft_shared',
  'entry_summary:inbound': 'entry_summary_received',
  'entry_summary:outbound': 'entry_summary_shared',
  'entry_summary:unknown': 'entry_summary_received',

  // ARRIVAL - Duty Invoice (FOCUSED - renamed from duty_summary)
  'duty_invoice:inbound': 'duty_invoice_received',
  'duty_invoice:outbound': 'duty_invoice_shared',
  'customs_document:inbound': 'duty_invoice_received',
  'customs_document:outbound': 'duty_invoice_shared',
  'customs_document:unknown': 'duty_invoice_received',
  'customs_clearance:inbound': 'customs_cleared',
  'customs_clearance:outbound': 'customs_cleared',
  'customs_clearance:unknown': 'customs_cleared',

  // ARRIVAL - Arrival Notice (FOCUSED)
  'arrival_notice:inbound': 'arrival_notice_received',
  'arrival_notice:outbound': 'arrival_notice_shared',
  'shipment_notice:inbound': 'arrival_notice_received',
  'shipment_notice:outbound': 'arrival_notice_shared',

  // ARRIVAL - Delivery Order
  'delivery_order:inbound': 'delivery_order_received',
  'delivery_order:outbound': 'delivery_order_shared',

  // DELIVERY - Container Release
  'container_release:inbound': 'container_released',
  'container_release:outbound': 'container_released',
  'pickup_notification:inbound': 'container_released',
  'pickup_notification:outbound': 'container_released',

  // DELIVERY - POD (FOCUSED)
  'pod:inbound': 'pod_received',
  'pod:outbound': 'pod_shared',
  'proof_of_delivery:inbound': 'pod_received',
  'proof_of_delivery:outbound': 'pod_shared',
  'delivery_confirmation:inbound': 'pod_received',
  'delivery_confirmation:outbound': 'pod_shared',
};

async function getAllRows(table, selectCols = '*') {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table).select(selectCols).range(offset, offset + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allRows;
}

async function fixAndRebackfill() {
  console.log('='.repeat(80));
  console.log('RE-BACKFILL WORKFLOW EVENTS (Focused States)');
  console.log('='.repeat(80));

  // Fetch all data
  console.log('\nFetching data...');
  const docs = await getAllRows('shipment_documents', 'id, shipment_id, document_type, email_id, created_at');
  const emails = await getAllRows('raw_emails', 'id, email_direction, received_at');
  const shipments = await getAllRows('shipments', 'id, booking_number');

  console.log('  Shipments: ' + shipments.length);
  console.log('  Documents: ' + docs.length);
  console.log('  Emails: ' + emails.length);

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  const shipmentIds = new Set(shipments.map(s => s.id));

  // Build events
  const events = [];

  for (const doc of docs) {
    if (!shipmentIds.has(doc.shipment_id)) continue;

    const email = emailMap.get(doc.email_id);
    const direction = email?.email_direction || 'unknown';
    const docType = doc.document_type || 'unknown';
    const key = docType + ':' + direction;
    const workflowState = WORKFLOW_STATE_MAP[key];

    if (workflowState) {
      events.push({
        shipment_id: doc.shipment_id,
        workflow_state: workflowState,
        document_id: doc.id,
        email_id: doc.email_id,
        occurred_at: email?.received_at || doc.created_at,
        document_type: docType,
        email_direction: direction
      });
    }
  }

  console.log('\nEvents to insert: ' + events.length);

  // Clear and re-insert
  console.log('\nClearing existing events...');
  await supabase.from('shipment_workflow_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('Inserting events...');
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    await supabase.from('shipment_workflow_events').upsert(batch, { onConflict: 'shipment_id,workflow_state,document_id', ignoreDuplicates: true });
    inserted += batch.length;
    process.stdout.write('\r  Inserted: ' + inserted + ' / ' + events.length);
  }

  console.log('\n');

  // Show focused states
  const focusedStates = [
    'entry_draft_received', 'entry_draft_shared',
    'entry_summary_received', 'entry_summary_shared',
    'duty_invoice_received', 'duty_invoice_shared',
    'arrival_notice_received', 'arrival_notice_shared',
    'pod_received', 'pod_shared'
  ];

  console.log('='.repeat(80));
  console.log('FOCUSED STATES SUMMARY');
  console.log('='.repeat(80));

  const { data: allEvents } = await supabase
    .from('shipment_workflow_events')
    .select('workflow_state, shipment_id');

  const stateCounts = {};
  const shipmentsByState = {};

  if (allEvents) {
    for (const event of allEvents) {
      stateCounts[event.workflow_state] = (stateCounts[event.workflow_state] || 0) + 1;
      if (!shipmentsByState[event.workflow_state]) {
        shipmentsByState[event.workflow_state] = new Set();
      }
      shipmentsByState[event.workflow_state].add(event.shipment_id);
    }
  }

  console.log('\nState'.padEnd(35) + 'Events'.padStart(10) + 'Shipments'.padStart(12));
  console.log('-'.repeat(60));

  for (const state of focusedStates) {
    const events = stateCounts[state] || 0;
    const shipments = shipmentsByState[state]?.size || 0;
    const status = shipments > 0 ? '✅' : '❌';
    console.log(status + ' ' + state.padEnd(33) + events.toString().padStart(10) + shipments.toString().padStart(12));
  }

  // Also show all states for reference
  console.log('\n\n=== ALL STATES ===\n');

  const allStates = Object.entries(shipmentsByState)
    .map(([state, set]) => ({ state, shipments: set.size, events: stateCounts[state] }))
    .sort((a, b) => b.shipments - a.shipments);

  for (const { state, shipments, events } of allStates) {
    console.log(state.padEnd(40) + events.toString().padStart(8) + shipments.toString().padStart(10));
  }

  console.log('\n' + '='.repeat(80));
}

fixAndRebackfill().catch(console.error);
