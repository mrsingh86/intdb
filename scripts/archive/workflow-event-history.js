require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Document type + direction → workflow state mapping
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

  // PRE_DEPARTURE - India Export
  'checklist:inbound': 'checklist_received',
  'checklist:outbound': 'checklist_shared',
  'shipping_bill:inbound': 'shipping_bill_received',
  'leo_copy:inbound': 'shipping_bill_received',

  // PRE_DEPARTURE - VGM
  'vgm_submission:inbound': 'vgm_confirmed',
  'vgm_submission:outbound': 'vgm_submitted',
  'vgm_confirmation:inbound': 'vgm_confirmed',
  'vgm_reminder:inbound': 'vgm_pending',

  // PRE_DEPARTURE - Gate/SOB
  'gate_in_confirmation:inbound': 'container_gated_in',
  'sob_confirmation:inbound': 'sob_received',
  'sob_confirmation:outbound': 'sob_shared',

  // IN_TRANSIT - ISF
  'isf_submission:outbound': 'isf_filed',
  'isf_confirmation:inbound': 'isf_confirmed',

  // IN_TRANSIT - BL
  'bill_of_lading:inbound': 'bl_received',
  'bill_of_lading:outbound': 'hbl_shared',
  'hbl_draft:inbound': 'hbl_draft_sent',
  'hbl_draft:outbound': 'hbl_draft_sent',
  'house_bl:outbound': 'hbl_released',

  // IN_TRANSIT - Invoice
  'freight_invoice:outbound': 'invoice_sent',
  'freight_invoice:inbound': 'commercial_invoice_received',
  'invoice:outbound': 'invoice_sent',

  // PRE_ARRIVAL - US Customs
  'draft_entry:inbound': 'entry_draft_received',
  'draft_entry:outbound': 'entry_draft_shared',
  'entry_summary:inbound': 'entry_summary_received',
  'entry_summary:outbound': 'entry_summary_shared',

  // ARRIVAL
  'arrival_notice:inbound': 'arrival_notice_received',
  'arrival_notice:outbound': 'arrival_notice_shared',
  // shipment_notice is FMC filing - NOT arrival notice
  'shipment_notice:inbound': 'fmc_filing_received',
  'shipment_notice:outbound': 'fmc_filing_sent',
  'customs_clearance:inbound': 'customs_cleared',
  'customs_document:inbound': 'duty_invoice_received',
  'customs_document:outbound': 'duty_summary_shared',
  'duty_invoice:inbound': 'duty_invoice_received',
  'duty_invoice:outbound': 'duty_summary_shared',
  'delivery_order:inbound': 'delivery_order_received',
  'delivery_order:outbound': 'delivery_order_shared',

  // DELIVERY
  'container_release:inbound': 'container_released',
  'container_release:outbound': 'container_released',
  'pickup_notification:inbound': 'container_released',
  'pod:inbound': 'pod_received',
  'proof_of_delivery:inbound': 'pod_received',
  'delivery_confirmation:inbound': 'delivered',
};

// State order for sorting
const STATE_ORDER = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'shipping_bill_received': 48,
  'si_submitted': 55,
  'si_confirmed': 60,
  'vgm_pending': 62,
  'vgm_submitted': 65,
  'vgm_confirmed': 68,
  'container_gated_in': 72,
  'sob_received': 80,
  'sob_shared': 85,
  'vessel_departed': 90,
  'isf_filed': 100,
  'isf_confirmed': 105,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_released': 130,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'invoice_paid': 140,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'customs_cleared': 190,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'delivered': 230,
  'pod_received': 235,
  'booking_cancelled': 999,
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

async function generateReport() {
  console.log('='.repeat(90));
  console.log('WORKFLOW EVENT HISTORY - SHIPMENTS THAT REACHED EACH STATE');
  console.log('(Based on document evidence, not current state)');
  console.log('='.repeat(90));

  // Fetch all data
  const docs = await getAllRows('shipment_documents', 'shipment_id, document_type, email_id');
  const emails = await getAllRows('raw_emails', 'id, email_direction');
  const shipments = await getAllRows('shipments', 'id, booking_number');

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  console.log('\nData: ' + shipments.length + ' shipments, ' + docs.length + ' documents, ' + emails.length + ' emails\n');

  // For each shipment, determine which workflow states it has evidence for
  const shipmentStates = new Map(); // shipment_id -> Set of states reached

  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    const direction = email?.email_direction || 'unknown';
    const docType = doc.document_type || 'unknown';

    const key = docType + ':' + direction;
    const workflowState = WORKFLOW_STATE_MAP[key];

    if (workflowState) {
      if (!shipmentStates.has(doc.shipment_id)) {
        shipmentStates.set(doc.shipment_id, new Set());
      }
      shipmentStates.get(doc.shipment_id).add(workflowState);
    }
  }

  // Count unique shipments per workflow state
  const stateShipmentCount = {};
  for (const [shipmentId, states] of shipmentStates) {
    for (const state of states) {
      stateShipmentCount[state] = (stateShipmentCount[state] || 0) + 1;
    }
  }

  // Sort by state order
  const sortedStates = Object.entries(stateShipmentCount)
    .map(([state, count]) => ({ state, count, order: STATE_ORDER[state] || 500 }))
    .sort((a, b) => a.order - b.order);

  // Group by phase
  const phases = {
    'PRE_DEPARTURE': sortedStates.filter(s => s.order < 100),
    'IN_TRANSIT': sortedStates.filter(s => s.order >= 100 && s.order < 150),
    'PRE_ARRIVAL': sortedStates.filter(s => s.order >= 150 && s.order < 180),
    'ARRIVAL': sortedStates.filter(s => s.order >= 180 && s.order < 220),
    'DELIVERY': sortedStates.filter(s => s.order >= 220 && s.order < 999),
    'CANCELLED': sortedStates.filter(s => s.order === 999),
  };

  console.log('Workflow State'.padEnd(45) + 'Shipments'.padStart(12) + '  Visual');
  console.log('='.repeat(90));

  for (const [phase, states] of Object.entries(phases)) {
    if (states.length === 0) continue;

    console.log('\n--- ' + phase + ' ---');

    for (const { state, count } of states) {
      const bar = '█'.repeat(Math.min(Math.round(count / 2), 50));
      console.log(state.padEnd(45) + count.toString().padStart(12) + '  ' + bar);
    }
  }

  // Funnel view
  console.log('\n\n');
  console.log('='.repeat(90));
  console.log('FUNNEL VIEW - SHIPMENT PROGRESSION');
  console.log('='.repeat(90));

  const funnelStates = [
    'booking_confirmation_received',
    'booking_confirmation_shared',
    'si_draft_received',
    'si_draft_sent',
    'si_confirmed',
    'vgm_submitted',
    'sob_received',
    'bl_received',
    'hbl_shared',
    'invoice_sent',
    // US Customs (broker)
    'entry_summary_received',
    'entry_summary_shared',
    // Arrival
    'arrival_notice_received',
    'arrival_notice_shared',
    'duty_invoice_received',
    'duty_summary_shared',
    'delivery_order_received',
    'delivery_order_shared',
    'container_released',
    'pod_received',
    'pod_shared',
  ];

  const maxCount = Math.max(...funnelStates.map(s => stateShipmentCount[s] || 0));

  console.log('\n');
  for (const state of funnelStates) {
    const count = stateShipmentCount[state] || 0;
    const barLen = Math.round((count / maxCount) * 50);
    const bar = '█'.repeat(barLen);
    const pct = ((count / shipments.length) * 100).toFixed(0);
    console.log(state.padEnd(35) + count.toString().padStart(5) + ' (' + pct.padStart(3) + '%)  ' + bar);
  }

  // Summary
  console.log('\n\n');
  console.log('='.repeat(90));
  console.log('KEY METRICS');
  console.log('='.repeat(90));

  const bcReceived = stateShipmentCount['booking_confirmation_received'] || 0;
  const bcShared = stateShipmentCount['booking_confirmation_shared'] || 0;
  const siReceived = stateShipmentCount['si_draft_received'] || 0;
  const siSent = stateShipmentCount['si_draft_sent'] || 0;
  const blReceived = stateShipmentCount['bl_received'] || 0;
  const hblShared = stateShipmentCount['hbl_shared'] || 0;
  const anReceived = stateShipmentCount['arrival_notice_received'] || 0;
  const anShared = stateShipmentCount['arrival_notice_shared'] || 0;
  const podReceived = stateShipmentCount['pod_received'] || 0;

  console.log('\nBooking Stage:');
  console.log('  BC Received:'.padEnd(30) + bcReceived.toString().padStart(5) + ' shipments');
  console.log('  BC Shared:'.padEnd(30) + bcShared.toString().padStart(5) + ' shipments');

  console.log('\nSI Stage:');
  console.log('  SI Received:'.padEnd(30) + siReceived.toString().padStart(5) + ' shipments');
  console.log('  SI Sent:'.padEnd(30) + siSent.toString().padStart(5) + ' shipments');

  console.log('\nBL Stage:');
  console.log('  BL Received:'.padEnd(30) + blReceived.toString().padStart(5) + ' shipments');
  console.log('  HBL Shared:'.padEnd(30) + hblShared.toString().padStart(5) + ' shipments');

  console.log('\nArrival Stage:');
  console.log('  AN Received:'.padEnd(30) + anReceived.toString().padStart(5) + ' shipments');
  console.log('  AN Shared:'.padEnd(30) + anShared.toString().padStart(5) + ' shipments');

  const entryReceived = stateShipmentCount['entry_summary_received'] || 0;
  const entryShared = stateShipmentCount['entry_summary_shared'] || 0;
  const dutyReceived = stateShipmentCount['duty_invoice_received'] || 0;
  const dutyShared = stateShipmentCount['duty_summary_shared'] || 0;
  const doReceived = stateShipmentCount['delivery_order_received'] || 0;
  const doShared = stateShipmentCount['delivery_order_shared'] || 0;

  console.log('\nUS Customs Stage:');
  console.log('  Entry Summary Received:'.padEnd(30) + entryReceived.toString().padStart(5) + ' shipments');
  console.log('  Entry Summary Shared:'.padEnd(30) + entryShared.toString().padStart(5) + ' shipments');
  console.log('  Duty Invoice Received:'.padEnd(30) + dutyReceived.toString().padStart(5) + ' shipments');
  console.log('  Duty Invoice Shared:'.padEnd(30) + dutyShared.toString().padStart(5) + ' shipments');

  console.log('\nDelivery Stage:');
  console.log('  DO Received:'.padEnd(30) + doReceived.toString().padStart(5) + ' shipments');
  console.log('  DO Shared:'.padEnd(30) + doShared.toString().padStart(5) + ' shipments');
  console.log('  POD Received:'.padEnd(30) + podReceived.toString().padStart(5) + ' shipments');

  console.log('\n' + '='.repeat(90));
}

generateReport().catch(console.error);
