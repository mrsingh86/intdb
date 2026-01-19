require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Document type + direction → workflow state mapping (comprehensive)
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
  'shipment_notice:inbound': 'arrival_notice_received',
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

async function analyzeAndBackfill() {
  console.log('='.repeat(100));
  console.log('SHIPMENT EVENT HISTORY - DETAILED ANALYSIS');
  console.log('='.repeat(100));

  // Fetch all data
  const docs = await getAllRows('shipment_documents', 'id, shipment_id, document_type, email_id, created_at');
  const emails = await getAllRows('raw_emails', 'id, email_direction, received_at, subject');
  const shipments = await getAllRows('shipments', 'id, booking_number, workflow_state, workflow_phase');

  console.log('\nData loaded: ' + shipments.length + ' shipments, ' + docs.length + ' documents, ' + emails.length + ' emails\n');

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  const shipmentMap = new Map();
  shipments.forEach(s => shipmentMap.set(s.id, s));

  // Build event history per shipment
  // Structure: { shipment_id: [ { state, document_id, email_id, timestamp, document_type, direction } ] }
  const shipmentEventHistory = new Map();
  const unmappedDocs = [];

  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    const direction = email?.email_direction || 'unknown';
    const docType = doc.document_type || 'unknown';
    const key = docType + ':' + direction;
    const workflowState = WORKFLOW_STATE_MAP[key];

    if (workflowState) {
      if (!shipmentEventHistory.has(doc.shipment_id)) {
        shipmentEventHistory.set(doc.shipment_id, []);
      }
      shipmentEventHistory.get(doc.shipment_id).push({
        state: workflowState,
        document_id: doc.id,
        email_id: doc.email_id,
        timestamp: email?.received_at || doc.created_at,
        document_type: docType,
        direction: direction,
        subject: email?.subject?.substring(0, 60) || ''
      });
    } else {
      unmappedDocs.push({ docType, direction, key, shipment_id: doc.shipment_id });
    }
  }

  // Sort events by timestamp within each shipment
  for (const [shipmentId, events] of shipmentEventHistory) {
    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  // Aggregate stats
  const stateStats = {};
  const stateFirstOccurrences = {}; // When state was first reached across all shipments

  for (const [shipmentId, events] of shipmentEventHistory) {
    const seenStates = new Set();
    for (const event of events) {
      if (!seenStates.has(event.state)) {
        seenStates.add(event.state);
        stateStats[event.state] = (stateStats[event.state] || 0) + 1;

        // Track earliest occurrence
        if (!stateFirstOccurrences[event.state] || new Date(event.timestamp) < new Date(stateFirstOccurrences[event.state].timestamp)) {
          stateFirstOccurrences[event.state] = {
            timestamp: event.timestamp,
            shipment_id: shipmentId,
            booking_number: shipmentMap.get(shipmentId)?.booking_number
          };
        }
      }
    }
  }

  // Print summary by state
  console.log('='.repeat(100));
  console.log('WORKFLOW STATE SUMMARY - SHIPMENTS THAT REACHED EACH STATE');
  console.log('='.repeat(100));
  console.log('\nState'.padEnd(40) + 'Shipments'.padStart(12) + '  First Occurrence');
  console.log('-'.repeat(100));

  const sortedStates = Object.entries(stateStats)
    .map(([state, count]) => ({ state, count, order: STATE_ORDER[state] || 500 }))
    .sort((a, b) => a.order - b.order);

  let currentPhase = '';
  for (const { state, count } of sortedStates) {
    const order = STATE_ORDER[state] || 500;
    let phase = '';
    if (order < 100) phase = 'PRE_DEPARTURE';
    else if (order < 150) phase = 'IN_TRANSIT';
    else if (order < 180) phase = 'PRE_ARRIVAL';
    else if (order < 220) phase = 'ARRIVAL';
    else if (order < 999) phase = 'DELIVERY';
    else phase = 'CANCELLED';

    if (phase !== currentPhase) {
      currentPhase = phase;
      console.log('\n--- ' + phase + ' ---');
    }

    const first = stateFirstOccurrences[state];
    const firstInfo = first ? `${first.booking_number || first.shipment_id.substring(0,8)} @ ${first.timestamp?.substring(0,10) || 'N/A'}` : '';
    console.log(state.padEnd(40) + count.toString().padStart(12) + '  ' + firstInfo);
  }

  // Detailed per-shipment event history
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('PER-SHIPMENT EVENT HISTORY (First 20 shipments)');
  console.log('='.repeat(100));

  let printed = 0;
  for (const [shipmentId, events] of shipmentEventHistory) {
    if (printed >= 20) break;
    const shipment = shipmentMap.get(shipmentId);
    console.log('\n### ' + (shipment?.booking_number || shipmentId.substring(0,8)) + ' (Current: ' + (shipment?.workflow_state || 'NULL') + ')');
    console.log('    Events: ' + events.length);
    console.log('    ' + '-'.repeat(90));

    for (const event of events) {
      const ts = event.timestamp?.substring(0, 10) || 'N/A';
      console.log('    ' + ts + '  ' + event.state.padEnd(35) + event.document_type.padEnd(25) + event.direction);
    }
    printed++;
  }

  // Unmapped documents analysis
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('UNMAPPED DOCUMENTS (No workflow state mapping)');
  console.log('='.repeat(100));

  const unmappedCounts = {};
  for (const u of unmappedDocs) {
    unmappedCounts[u.key] = (unmappedCounts[u.key] || 0) + 1;
  }

  console.log('\nDocument Type:Direction'.padEnd(50) + 'Count'.padStart(10));
  console.log('-'.repeat(60));
  Object.entries(unmappedCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, count]) => {
      console.log(key.padEnd(50) + count.toString().padStart(10));
    });

  // States that exist in config but have no events
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('STATES WITH NO DOCUMENT EVIDENCE (May need backfill or new classification)');
  console.log('='.repeat(100));

  const allConfiguredStates = Object.keys(STATE_ORDER);
  const statesWithEvents = new Set(Object.keys(stateStats));
  const statesWithoutEvents = allConfiguredStates.filter(s => !statesWithEvents.has(s));

  console.log('\nThese workflow states have NO documents mapped to them:');
  for (const state of statesWithoutEvents) {
    const order = STATE_ORDER[state];
    let phase = '';
    if (order < 100) phase = 'PRE_DEPARTURE';
    else if (order < 150) phase = 'IN_TRANSIT';
    else if (order < 180) phase = 'PRE_ARRIVAL';
    else if (order < 220) phase = 'ARRIVAL';
    else if (order < 999) phase = 'DELIVERY';
    else phase = 'CANCELLED';

    console.log('  [' + phase.padEnd(14) + '] ' + state);
  }

  // Backfill recommendations
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('BACKFILL RECOMMENDATIONS');
  console.log('='.repeat(100));

  console.log('\n1. STATES NEEDING DOCUMENT TYPE MAPPING:');
  for (const state of statesWithoutEvents) {
    console.log('   - ' + state + ': Add document types that trigger this state');
  }

  console.log('\n2. UNMAPPED DOCUMENT TYPES NEEDING WORKFLOW STATE:');
  Object.entries(unmappedCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([key, count]) => {
      console.log('   - ' + key + ' (' + count + ' docs): Map to appropriate workflow state');
    });

  // Generate backfill data for shipment_workflow_events table
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('EVENT HISTORY DATA READY FOR STORAGE');
  console.log('='.repeat(100));

  let totalEvents = 0;
  for (const [, events] of shipmentEventHistory) {
    totalEvents += events.length;
  }

  console.log('\nTotal shipments with events: ' + shipmentEventHistory.size);
  console.log('Total workflow events: ' + totalEvents);
  console.log('\nTo store this data, create table:');
  console.log(`
CREATE TABLE IF NOT EXISTS shipment_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id),
  workflow_state VARCHAR(50) NOT NULL,
  document_id UUID REFERENCES shipment_documents(id),
  email_id VARCHAR(200) REFERENCES raw_emails(gmail_message_id),
  occurred_at TIMESTAMP WITH TIME ZONE,
  document_type VARCHAR(50),
  email_direction VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(shipment_id, workflow_state, document_id)
);

CREATE INDEX idx_workflow_events_shipment ON shipment_workflow_events(shipment_id);
CREATE INDEX idx_workflow_events_state ON shipment_workflow_events(workflow_state);
CREATE INDEX idx_workflow_events_occurred ON shipment_workflow_events(occurred_at);
`);

  console.log('\n' + '='.repeat(100));
}

analyzeAndBackfill().catch(console.error);
