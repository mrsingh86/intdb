require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function generateReport() {
  console.log('================================================================================');
  console.log('DETAILED WORKFLOW STATE DISTRIBUTION REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('================================================================================');

  // Get shipments
  const { data: shipments, error: shipErr } = await supabase
    .from('shipments')
    .select('*');

  if (shipErr) {
    console.log('Error fetching shipments:', shipErr.message);
  }

  console.log('\n## SHIPMENTS TABLE');
  console.log('Total shipments:', shipments?.length || 0);

  if (shipments && shipments.length > 0) {
    // Workflow state distribution
    const stateCount = {};
    const phaseCount = {};
    const statusCount = {};
    const carrierCount = {};

    for (const s of shipments) {
      const state = s.workflow_state || 'null';
      const phase = s.workflow_phase || 'null';
      const status = s.status || 'null';
      const carrier = s.carrier_name || 'unknown';

      stateCount[state] = (stateCount[state] || 0) + 1;
      phaseCount[phase] = (phaseCount[phase] || 0) + 1;
      statusCount[status] = (statusCount[status] || 0) + 1;
      carrierCount[carrier] = (carrierCount[carrier] || 0) + 1;
    }

    console.log('\n### By Workflow State');
    Object.entries(stateCount)
      .sort((a, b) => b[1] - a[1])
      .forEach(([state, count]) => {
        console.log('  ' + state.padEnd(40) + count.toString().padStart(5));
      });

    console.log('\n### By Workflow Phase');
    Object.entries(phaseCount)
      .sort((a, b) => b[1] - a[1])
      .forEach(([phase, count]) => {
        console.log('  ' + phase.padEnd(20) + count.toString().padStart(5));
      });

    console.log('\n### By Status');
    Object.entries(statusCount)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log('  ' + status.padEnd(20) + count.toString().padStart(5));
      });

    console.log('\n### By Carrier');
    Object.entries(carrierCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([carrier, count]) => {
        console.log('  ' + carrier.padEnd(25) + count.toString().padStart(5));
      });
  }

  // Get documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type, email_id');

  console.log('\n## SHIPMENT DOCUMENTS TABLE');
  console.log('Total documents:', docs?.length || 0);

  // Document type distribution
  const docTypeCount = {};
  for (const d of docs || []) {
    const type = d.document_type || 'null';
    docTypeCount[type] = (docTypeCount[type] || 0) + 1;
  }

  console.log('\n### By Document Type');
  Object.entries(docTypeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type.padEnd(35) + count.toString().padStart(5));
    });

  // Get emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, email_direction')
    .limit(5000);

  console.log('\n## RAW EMAILS TABLE');
  console.log('Total emails (sample):', emails?.length || 0);

  const emailMap = new Map();
  emails?.forEach(e => emailMap.set(e.id, e));

  // Direction distribution
  const dirCount = { inbound: 0, outbound: 0, null: 0 };
  for (const e of emails || []) {
    const dir = e.email_direction || 'null';
    dirCount[dir] = (dirCount[dir] || 0) + 1;
  }

  console.log('\n### By Direction');
  Object.entries(dirCount).forEach(([dir, count]) => {
    console.log('  ' + dir.padEnd(15) + count.toString().padStart(5));
  });

  // Document type by direction (for documents with linked emails)
  console.log('\n## DOCUMENT TYPE BY DIRECTION');
  console.log('-'.repeat(70));
  console.log('Document Type'.padEnd(35) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10) + 'No Dir'.padStart(10));
  console.log('-'.repeat(70));

  const docByDir = {};
  for (const d of docs || []) {
    const email = emailMap.get(d.email_id);
    const dir = email?.email_direction || 'null';
    const type = d.document_type || 'unknown';

    if (!docByDir[type]) docByDir[type] = { inbound: 0, outbound: 0, null: 0 };
    docByDir[type][dir] = (docByDir[type][dir] || 0) + 1;
  }

  Object.entries(docByDir)
    .map(([type, dirs]) => ({
      type,
      inbound: dirs.inbound || 0,
      outbound: dirs.outbound || 0,
      null: dirs.null || 0,
      total: (dirs.inbound || 0) + (dirs.outbound || 0) + (dirs.null || 0)
    }))
    .sort((a, b) => b.total - a.total)
    .forEach(row => {
      console.log(
        row.type.padEnd(35) +
        row.inbound.toString().padStart(10) +
        row.outbound.toString().padStart(10) +
        row.null.toString().padStart(10)
      );
    });

  // BC Analysis
  console.log('\n## BOOKING CONFIRMATION WORKFLOW ANALYSIS');
  console.log('-'.repeat(70));

  const bcDocs = (docs || []).filter(d =>
    d.document_type === 'booking_confirmation' || d.document_type === 'booking_amendment'
  );

  const bcShipmentsByDir = { inbound: new Set(), outbound: new Set() };

  for (const d of bcDocs) {
    const email = emailMap.get(d.email_id);
    if (!email) continue;
    const dir = email.email_direction;
    if (dir === 'inbound') bcShipmentsByDir.inbound.add(d.shipment_id);
    if (dir === 'outbound') bcShipmentsByDir.outbound.add(d.shipment_id);
  }

  const bcReceived = bcShipmentsByDir.inbound.size;
  const bcShared = bcShipmentsByDir.outbound.size;
  const bothBcStates = [...bcShipmentsByDir.inbound].filter(id => bcShipmentsByDir.outbound.has(id)).length;
  const onlyReceived = bcReceived - bothBcStates;
  const onlyShared = bcShared - bothBcStates;

  console.log('BC Received (inbound):'.padEnd(40) + bcReceived.toString().padStart(5));
  console.log('BC Shared (outbound):'.padEnd(40) + bcShared.toString().padStart(5));
  console.log('');
  console.log('Shipments with ONLY BC Received:'.padEnd(40) + onlyReceived.toString().padStart(5));
  console.log('Shipments with ONLY BC Shared:'.padEnd(40) + onlyShared.toString().padStart(5));
  console.log('Shipments with BOTH states:'.padEnd(40) + bothBcStates.toString().padStart(5));

  // Workflow state mapping explanation
  console.log('\n## WORKFLOW STATE MAPPING REFERENCE');
  console.log('-'.repeat(70));
  console.log('Document Type + Direction -> Workflow State\n');

  const mappings = [
    ['booking_confirmation', 'inbound', 'booking_confirmation_received'],
    ['booking_confirmation', 'outbound', 'booking_confirmation_shared'],
    ['booking_amendment', 'inbound', 'booking_confirmation_received'],
    ['booking_amendment', 'outbound', 'booking_confirmation_shared'],
    ['arrival_notice', 'inbound', 'arrival_notice_received'],
    ['arrival_notice', 'outbound', 'arrival_notice_shared'],
    ['bill_of_lading', 'inbound', 'bl_received'],
    ['bill_of_lading', 'outbound', 'hbl_shared'],
    ['invoice', 'inbound', 'commercial_invoice_received'],
    ['invoice', 'outbound', 'invoice_sent'],
    ['shipping_instruction', 'inbound', 'si_draft_received'],
    ['shipping_instruction', 'outbound', 'si_draft_sent'],
    ['vgm_confirmation', 'inbound', 'vgm_confirmed'],
    ['delivery_order', 'inbound', 'delivery_order_received'],
    ['pod', 'inbound', 'pod_received'],
  ];

  console.log('Doc Type'.padEnd(25) + 'Direction'.padEnd(12) + 'Workflow State');
  console.log('-'.repeat(70));
  for (const [docType, dir, state] of mappings) {
    console.log(docType.padEnd(25) + dir.padEnd(12) + state);
  }

  console.log('\n================================================================================');
}

generateReport().catch(console.error);
