require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getAllRows(table, selectCols = '*') {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .range(offset, offset + batchSize - 1);

    if (error) break;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allRows;
}

async function generateReport() {
  console.log('================================================================================');
  console.log('DOCUMENT DISTRIBUTION BY WORKFLOW STATE');
  console.log('Generated:', new Date().toISOString());
  console.log('================================================================================');

  // Get all workflow states config
  const { data: workflowStates } = await supabase
    .from('shipment_workflow_states')
    .select('*')
    .order('state_order', { ascending: true });

  // Get all shipments
  const shipments = await getAllRows('shipments', 'id, workflow_state, workflow_phase, booking_number');
  const shipmentMap = new Map();
  shipments.forEach(s => shipmentMap.set(s.id, s));

  // Get all documents
  const docs = await getAllRows('shipment_documents', 'shipment_id, document_type, email_id');

  // Get all emails for direction
  const emails = await getAllRows('raw_emails', 'id, email_direction');
  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  // Build: workflow_state -> { docType -> { inbound, outbound, total } }
  const stateDocDistribution = {};

  for (const doc of docs) {
    const shipment = shipmentMap.get(doc.shipment_id);
    if (!shipment) continue;

    const state = shipment.workflow_state || 'null';
    const docType = doc.document_type || 'unknown';
    const email = emailMap.get(doc.email_id);
    const direction = email?.email_direction || 'unknown';

    if (!stateDocDistribution[state]) {
      stateDocDistribution[state] = { _total: 0, _inbound: 0, _outbound: 0 };
    }
    if (!stateDocDistribution[state][docType]) {
      stateDocDistribution[state][docType] = { inbound: 0, outbound: 0, total: 0 };
    }

    stateDocDistribution[state][docType].total++;
    stateDocDistribution[state][docType][direction] = (stateDocDistribution[state][docType][direction] || 0) + 1;
    stateDocDistribution[state]._total++;
    if (direction === 'inbound') stateDocDistribution[state]._inbound++;
    if (direction === 'outbound') stateDocDistribution[state]._outbound++;
  }

  // Group states by phase
  const statePhaseMap = {};
  const stateNameMap = {};
  if (workflowStates) {
    for (const ws of workflowStates) {
      statePhaseMap[ws.state_code] = ws.phase;
      stateNameMap[ws.state_code] = ws.state_name;
    }
  }

  // Print by phase
  const phases = ['pre_departure', 'in_transit', 'pre_arrival', 'arrival', 'delivery'];

  for (const phase of phases) {
    const phaseStates = workflowStates?.filter(ws => ws.phase === phase) || [];

    console.log('\n' + '='.repeat(100));
    console.log('PHASE: ' + phase.toUpperCase());
    console.log('='.repeat(100));

    for (const ws of phaseStates) {
      const state = ws.state_code;
      const dist = stateDocDistribution[state];

      if (!dist || dist._total === 0) continue;

      console.log('\n### ' + state + ' (' + (ws.state_name || '') + ')');
      console.log('Total Documents: ' + dist._total + ' | Inbound: ' + dist._inbound + ' | Outbound: ' + dist._outbound);
      console.log('-'.repeat(80));
      console.log('Document Type'.padEnd(35) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10) + 'Total'.padStart(10));
      console.log('-'.repeat(80));

      const docTypes = Object.entries(dist)
        .filter(([k]) => !k.startsWith('_'))
        .map(([type, counts]) => ({
          type,
          inbound: counts.inbound || 0,
          outbound: counts.outbound || 0,
          total: counts.total || 0
        }))
        .sort((a, b) => b.total - a.total);

      for (const dt of docTypes) {
        console.log(
          dt.type.padEnd(35) +
          dt.inbound.toString().padStart(10) +
          dt.outbound.toString().padStart(10) +
          dt.total.toString().padStart(10)
        );
      }
    }
  }

  // Summary table
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY: DOCUMENTS PER WORKFLOW STATE');
  console.log('='.repeat(100));
  console.log('Workflow State'.padEnd(45) + 'Shipments'.padStart(10) + 'Docs'.padStart(10) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10));
  console.log('-'.repeat(100));

  // Count shipments per state
  const shipmentCountByState = {};
  for (const s of shipments) {
    const state = s.workflow_state || 'null';
    shipmentCountByState[state] = (shipmentCountByState[state] || 0) + 1;
  }

  const allStates = workflowStates?.map(ws => ws.state_code) || [];
  for (const state of allStates) {
    const dist = stateDocDistribution[state];
    const shipmentCount = shipmentCountByState[state] || 0;

    if (shipmentCount === 0 && (!dist || dist._total === 0)) continue;

    console.log(
      state.padEnd(45) +
      shipmentCount.toString().padStart(10) +
      (dist?._total || 0).toString().padStart(10) +
      (dist?._inbound || 0).toString().padStart(10) +
      (dist?._outbound || 0).toString().padStart(10)
    );
  }

  // Null state
  if (stateDocDistribution['null']) {
    const dist = stateDocDistribution['null'];
    console.log(
      'null (no workflow state)'.padEnd(45) +
      (shipmentCountByState['null'] || 0).toString().padStart(10) +
      dist._total.toString().padStart(10) +
      dist._inbound.toString().padStart(10) +
      dist._outbound.toString().padStart(10)
    );
  }

  console.log('-'.repeat(100));
  const totalDocs = docs.length;
  const totalInbound = Object.values(stateDocDistribution).reduce((sum, d) => sum + (d._inbound || 0), 0);
  const totalOutbound = Object.values(stateDocDistribution).reduce((sum, d) => sum + (d._outbound || 0), 0);
  console.log(
    'TOTAL'.padEnd(45) +
    shipments.length.toString().padStart(10) +
    totalDocs.toString().padStart(10) +
    totalInbound.toString().padStart(10) +
    totalOutbound.toString().padStart(10)
  );

  console.log('\n================================================================================');
}

generateReport().catch(console.error);
