require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Get ALL rows with proper pagination
async function getAllRows(table, selectCols = '*') {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    allRows.push(...data);
    offset += batchSize;

    if (data.length < batchSize) break;
  }
  return allRows;
}

async function generateReport() {
  console.log('================================================================================');
  console.log('COMPLETE DOCUMENT DISTRIBUTION BY WORKFLOW STATE (FULL DATA)');
  console.log('================================================================================\n');

  // Get counts first
  const { count: shipmentCount } = await supabase.from('shipments').select('*', { count: 'exact', head: true });
  const { count: docCount } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });
  const { count: emailCount } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });

  console.log('EXPECTED COUNTS: Shipments=' + shipmentCount + ', Docs=' + docCount + ', Emails=' + emailCount);

  // Fetch ALL data
  const shipments = await getAllRows('shipments', 'id, workflow_state, workflow_phase');
  const docs = await getAllRows('shipment_documents', 'shipment_id, document_type, email_id');
  const emails = await getAllRows('raw_emails', 'id, email_direction');

  console.log('FETCHED COUNTS:  Shipments=' + shipments.length + ', Docs=' + docs.length + ', Emails=' + emails.length);

  if (shipments.length !== shipmentCount || docs.length !== docCount || emails.length !== emailCount) {
    console.log('\n*** WARNING: COUNTS DO NOT MATCH - PAGINATION ISSUE ***\n');
  } else {
    console.log('\n*** ALL DATA FETCHED SUCCESSFULLY ***\n');
  }

  // Build maps
  const shipmentMap = new Map();
  shipments.forEach(s => shipmentMap.set(s.id, s));

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  // Get workflow states config
  const { data: workflowStates } = await supabase
    .from('shipment_workflow_states')
    .select('*')
    .order('state_order', { ascending: true });

  // Build: workflow_state -> { docType -> { inbound, outbound, unknown, total } }
  const stateDocDist = {};
  const shipmentCountByState = {};

  // Count shipments per state
  for (const s of shipments) {
    const state = s.workflow_state || 'NULL';
    shipmentCountByState[state] = (shipmentCountByState[state] || 0) + 1;
  }

  // Process all documents
  for (const doc of docs) {
    const shipment = shipmentMap.get(doc.shipment_id);
    if (!shipment) continue;

    const state = shipment.workflow_state || 'NULL';
    const docType = doc.document_type || 'unknown';
    const email = emailMap.get(doc.email_id);
    const direction = email?.email_direction || 'unknown';

    if (!stateDocDist[state]) {
      stateDocDist[state] = { _total: 0, _inbound: 0, _outbound: 0, _unknown: 0 };
    }
    if (!stateDocDist[state][docType]) {
      stateDocDist[state][docType] = { inbound: 0, outbound: 0, unknown: 0, total: 0 };
    }

    stateDocDist[state][docType].total++;
    stateDocDist[state][docType][direction] = (stateDocDist[state][docType][direction] || 0) + 1;
    stateDocDist[state]._total++;

    if (direction === 'inbound') stateDocDist[state]._inbound++;
    else if (direction === 'outbound') stateDocDist[state]._outbound++;
    else stateDocDist[state]._unknown++;
  }

  // Print summary
  console.log('=' .repeat(110));
  console.log('SUMMARY: DOCUMENTS PER WORKFLOW STATE');
  console.log('='.repeat(110));
  console.log(
    'Workflow State'.padEnd(45) +
    'Shipments'.padStart(10) +
    'Docs'.padStart(10) +
    'Inbound'.padStart(10) +
    'Outbound'.padStart(10) +
    'Unknown'.padStart(10)
  );
  console.log('-'.repeat(110));

  let totalShipments = 0;
  let totalDocs = 0;
  let totalInbound = 0;
  let totalOutbound = 0;
  let totalUnknown = 0;

  // Print by workflow state order
  const stateOrder = workflowStates?.map(ws => ws.state_code) || [];

  for (const state of stateOrder) {
    const dist = stateDocDist[state];
    const sCount = shipmentCountByState[state] || 0;

    if (sCount === 0 && (!dist || dist._total === 0)) continue;

    const d = dist || { _total: 0, _inbound: 0, _outbound: 0, _unknown: 0 };

    console.log(
      state.padEnd(45) +
      sCount.toString().padStart(10) +
      d._total.toString().padStart(10) +
      d._inbound.toString().padStart(10) +
      d._outbound.toString().padStart(10) +
      d._unknown.toString().padStart(10)
    );

    totalShipments += sCount;
    totalDocs += d._total;
    totalInbound += d._inbound;
    totalOutbound += d._outbound;
    totalUnknown += d._unknown;
  }

  // NULL state
  if (stateDocDist['NULL']) {
    const d = stateDocDist['NULL'];
    const sCount = shipmentCountByState['NULL'] || 0;
    console.log(
      'NULL (no state)'.padEnd(45) +
      sCount.toString().padStart(10) +
      d._total.toString().padStart(10) +
      d._inbound.toString().padStart(10) +
      d._outbound.toString().padStart(10) +
      d._unknown.toString().padStart(10)
    );
    totalShipments += sCount;
    totalDocs += d._total;
    totalInbound += d._inbound;
    totalOutbound += d._outbound;
    totalUnknown += d._unknown;
  }

  console.log('-'.repeat(110));
  console.log(
    'TOTAL'.padEnd(45) +
    totalShipments.toString().padStart(10) +
    totalDocs.toString().padStart(10) +
    totalInbound.toString().padStart(10) +
    totalOutbound.toString().padStart(10) +
    totalUnknown.toString().padStart(10)
  );

  // Detailed breakdown per state
  console.log('\n\n');
  console.log('='.repeat(110));
  console.log('DETAILED DOCUMENT BREAKDOWN PER WORKFLOW STATE');
  console.log('='.repeat(110));

  for (const state of stateOrder) {
    const dist = stateDocDist[state];
    if (!dist || dist._total === 0) continue;

    const ws = workflowStates?.find(w => w.state_code === state);
    console.log('\n### ' + state + ' (' + (ws?.state_name || '') + ')');
    console.log('Shipments: ' + (shipmentCountByState[state] || 0) + ' | Docs: ' + dist._total + ' | In: ' + dist._inbound + ' | Out: ' + dist._outbound);
    console.log('-'.repeat(80));
    console.log('Document Type'.padEnd(35) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10) + 'Unknown'.padStart(10) + 'Total'.padStart(10));
    console.log('-'.repeat(80));

    const docTypes = Object.entries(dist)
      .filter(([k]) => !k.startsWith('_'))
      .map(([type, c]) => ({ type, ...c }))
      .sort((a, b) => b.total - a.total);

    for (const dt of docTypes) {
      console.log(
        dt.type.padEnd(35) +
        dt.inbound.toString().padStart(10) +
        dt.outbound.toString().padStart(10) +
        (dt.unknown || 0).toString().padStart(10) +
        dt.total.toString().padStart(10)
      );
    }
  }

  console.log('\n================================================================================');
}

generateReport().catch(console.error);
