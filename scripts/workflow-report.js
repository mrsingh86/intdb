require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function generateReport() {
  // Get all shipment documents with emails
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type, email_id, created_at')
    .order('created_at', { ascending: true });

  // Get all emails with direction
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, email_direction, received_at')
    .limit(5000);

  const emailMap = new Map();
  emails?.forEach(e => emailMap.set(e.id, e));

  // Get shipments with current workflow state
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, workflow_state, workflow_phase, booking_number, carrier_name, status, created_at');

  const shipmentMap = new Map();
  shipments?.forEach(s => shipmentMap.set(s.id, s));

  // Build comprehensive state distribution
  const stateDistribution = {};
  const phaseDistribution = {};
  const docTypeByDirection = {};

  // Process each document to determine workflow state
  for (const doc of docs || []) {
    const email = emailMap.get(doc.email_id);
    const shipment = shipmentMap.get(doc.shipment_id);
    if (!shipment) continue;

    const direction = email?.email_direction || 'unknown';
    const docType = doc.document_type;

    // Track document type by direction
    const key = docType + ':' + direction;
    docTypeByDirection[key] = (docTypeByDirection[key] || 0) + 1;
  }

  // Get current workflow states from shipments
  for (const shipment of shipments || []) {
    const state = shipment.workflow_state || 'no_state';
    const phase = shipment.workflow_phase || 'unknown';

    stateDistribution[state] = (stateDistribution[state] || 0) + 1;
    phaseDistribution[phase] = (phaseDistribution[phase] || 0) + 1;
  }

  // Output report
  console.log('='.repeat(80));
  console.log('WORKFLOW STATE DISTRIBUTION REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(80));

  console.log('\n## SUMMARY');
  console.log('Total Shipments:', shipments?.length || 0);
  console.log('Total Documents:', docs?.length || 0);
  console.log('Total Emails:', emails?.length || 0);

  console.log('\n## PHASE DISTRIBUTION');
  console.log('-'.repeat(50));
  const phases = ['pre_departure', 'in_transit', 'pre_arrival', 'arrival', 'delivery', 'unknown'];
  phases.forEach(phase => {
    const count = phaseDistribution[phase] || 0;
    const pct = ((count / (shipments?.length || 1)) * 100).toFixed(1);
    console.log(phase.padEnd(20), count.toString().padStart(5), '(' + pct + '%)');
  });

  console.log('\n## WORKFLOW STATE DISTRIBUTION');
  console.log('-'.repeat(60));

  // Group states by phase
  const statePhaseMap = {
    'PRE_DEPARTURE': [
      'booking_confirmation_received', 'booking_confirmation_shared', 'booking_cancelled',
      'commercial_invoice_received', 'packing_list_received', 'si_draft_received', 'si_draft_sent',
      'si_submitted', 'si_confirmed', 'checklist_received', 'checklist_shared', 'shipping_bill_received',
      'vgm_pending', 'vgm_submitted', 'vgm_confirmed', 'container_gated_in', 'sob_received', 'vessel_departed'
    ],
    'IN_TRANSIT': [
      'isf_filed', 'isf_confirmed', 'mbl_draft_received', 'bl_received', 'hbl_draft_sent',
      'hbl_shared', 'hbl_released', 'invoice_sent', 'invoice_paid'
    ],
    'PRE_ARRIVAL': [
      'entry_draft_received', 'entry_draft_shared', 'entry_summary_received', 'entry_summary_shared', 'entry_filed'
    ],
    'ARRIVAL': [
      'arrival_notice_received', 'arrival_notice_shared', 'customs_cleared', 'customs_hold',
      'duty_invoice_received', 'duty_summary_shared', 'delivery_order_received', 'delivery_order_shared', 'cargo_released'
    ],
    'DELIVERY': [
      'container_released', 'out_for_delivery', 'delivered', 'pod_received', 'empty_returned', 'shipment_closed'
    ]
  };

  for (const [phase, states] of Object.entries(statePhaseMap)) {
    console.log('\n### ' + phase);
    let phaseTotal = 0;
    for (const state of states) {
      const count = stateDistribution[state] || 0;
      if (count > 0) {
        phaseTotal += count;
        console.log('  ' + state.padEnd(35), count.toString().padStart(5));
      }
    }
    if (phaseTotal === 0) {
      console.log('  (no shipments in this phase)');
    }
  }

  // Show no_state and null
  console.log('\n### UNASSIGNED');
  const noState = stateDistribution['no_state'] || 0;
  const nullState = stateDistribution['null'] || 0;
  console.log('  no_state'.padEnd(35), noState.toString().padStart(5));
  if (nullState > 0) console.log('  null'.padEnd(35), nullState.toString().padStart(5));

  console.log('\n## DOCUMENT TYPE BY DIRECTION');
  console.log('-'.repeat(60));

  // Group by document type
  const docTypes = {};
  for (const [key, count] of Object.entries(docTypeByDirection)) {
    const parts = key.split(':');
    const docType = parts[0];
    const direction = parts[1];
    if (!docTypes[docType]) docTypes[docType] = { inbound: 0, outbound: 0, unknown: 0 };
    docTypes[docType][direction] = count;
  }

  console.log('Document Type'.padEnd(30) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10) + 'Unknown'.padStart(10));
  console.log('-'.repeat(60));

  const sortedDocTypes = Object.entries(docTypes)
    .map(([type, dirs]) => ({ type, ...dirs, total: dirs.inbound + dirs.outbound + dirs.unknown }))
    .sort((a, b) => b.total - a.total);

  for (const dt of sortedDocTypes) {
    console.log(
      dt.type.padEnd(30) +
      dt.inbound.toString().padStart(10) +
      dt.outbound.toString().padStart(10) +
      dt.unknown.toString().padStart(10)
    );
  }

  // Calculate BC stats specifically
  console.log('\n## BOOKING CONFIRMATION ANALYSIS');
  console.log('-'.repeat(60));

  // Get BC documents linked to shipments
  const bcDocs = docs?.filter(d =>
    d.document_type === 'booking_confirmation' || d.document_type === 'booking_amendment'
  ) || [];

  const bcByDirection = { inbound: new Set(), outbound: new Set() };
  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const dir = email.email_direction || 'unknown';
    if (dir === 'inbound') bcByDirection.inbound.add(doc.shipment_id);
    if (dir === 'outbound') bcByDirection.outbound.add(doc.shipment_id);
  }

  console.log('BC Received (inbound):'.padEnd(35), bcByDirection.inbound.size.toString().padStart(5));
  console.log('BC Shared (outbound):'.padEnd(35), bcByDirection.outbound.size.toString().padStart(5));
  console.log('Total shipments with BC:'.padEnd(35),
    new Set([...bcByDirection.inbound, ...bcByDirection.outbound]).size.toString().padStart(5));

  console.log('\n' + '='.repeat(80));
}

generateReport().catch(console.error);
