require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Document type + direction → workflow state mapping (comprehensive + fixes)
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
  'vgm_reminder:outbound': 'vgm_pending',  // FIX: outbound reminder also indicates pending

  // PRE_DEPARTURE - Gate/SOB
  'gate_in_confirmation:inbound': 'container_gated_in',
  'gate_in_confirmation:outbound': 'container_gated_in',  // FIX: outbound shared also counts
  'sob_confirmation:inbound': 'sob_received',
  'sob_confirmation:outbound': 'sob_shared',

  // IN_TRANSIT - ISF
  'isf_submission:outbound': 'isf_filed',
  'isf_submission:inbound': 'isf_confirmed',  // FIX: inbound ISF = confirmed
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

async function backfillWorkflowEvents() {
  console.log('='.repeat(80));
  console.log('BACKFILLING SHIPMENT WORKFLOW EVENTS');
  console.log('='.repeat(80));

  // Check if table exists
  const { error: checkError } = await supabase.from('shipment_workflow_events').select('id').limit(1);
  if (checkError && checkError.code === '42P01') {
    console.log('\n❌ Table shipment_workflow_events does not exist!');
    console.log('Please create it first using the SQL provided.');
    return;
  }

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

  // Build events to insert
  const events = [];
  const unmapped = {};

  for (const doc of docs) {
    // Skip if shipment doesn't exist
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
    } else {
      unmapped[key] = (unmapped[key] || 0) + 1;
    }
  }

  console.log('\nEvents to insert: ' + events.length);
  console.log('Unmapped documents: ' + Object.values(unmapped).reduce((a, b) => a + b, 0));

  // Clear existing data
  console.log('\nClearing existing events...');
  const { error: deleteError } = await supabase.from('shipment_workflow_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (deleteError) {
    console.log('Warning: Could not clear table:', deleteError.message);
  }

  // Insert in batches
  console.log('\nInserting events in batches...');
  const batchSize = 500;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const { error: insertError } = await supabase
      .from('shipment_workflow_events')
      .upsert(batch, { onConflict: 'shipment_id,workflow_state,document_id', ignoreDuplicates: true });

    if (insertError) {
      console.log('  Batch error:', insertError.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted: ${inserted} / ${events.length}`);
    }
  }

  console.log('\n');

  // Verify
  const { count } = await supabase.from('shipment_workflow_events').select('*', { count: 'exact', head: true });
  console.log('='.repeat(80));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log('\nTotal events in table: ' + count);
  console.log('Errors: ' + errors);

  // Summary by state
  console.log('\n--- Events by Workflow State ---');
  const { data: summary } = await supabase
    .from('shipment_workflow_events')
    .select('workflow_state');

  const stateCounts = {};
  if (summary) {
    for (const row of summary) {
      stateCounts[row.workflow_state] = (stateCounts[row.workflow_state] || 0) + 1;
    }
  }

  Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log('  ' + state.padEnd(40) + count.toString().padStart(6));
    });

  // Unique shipments per state
  console.log('\n--- Unique Shipments per State ---');
  const { data: uniqueShipments } = await supabase
    .from('shipment_workflow_events')
    .select('workflow_state, shipment_id');

  const shipmentsByState = {};
  if (uniqueShipments) {
    for (const row of uniqueShipments) {
      if (!shipmentsByState[row.workflow_state]) {
        shipmentsByState[row.workflow_state] = new Set();
      }
      shipmentsByState[row.workflow_state].add(row.shipment_id);
    }
  }

  Object.entries(shipmentsByState)
    .map(([state, set]) => [state, set.size])
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log('  ' + state.padEnd(40) + count.toString().padStart(6) + ' shipments');
    });

  console.log('\n' + '='.repeat(80));
}

backfillWorkflowEvents().catch(console.error);
