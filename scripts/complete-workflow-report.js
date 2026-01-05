require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Helper to get ALL rows (no pagination limit)
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
  console.log('COMPLETE WORKFLOW STATE REPORT (ALL DATA - NO PAGINATION)');
  console.log('Generated:', new Date().toISOString());
  console.log('================================================================================');

  // Get ALL workflow states from config table
  const { data: workflowStates } = await supabase
    .from('shipment_workflow_states')
    .select('*')
    .order('state_order', { ascending: true });

  console.log('\n## ALL WORKFLOW STATES (from shipment_workflow_states table)');
  console.log('='.repeat(100));
  console.log('Order'.padEnd(8) + 'Phase'.padEnd(18) + 'State Code'.padEnd(40) + 'State Name');
  console.log('-'.repeat(100));

  if (workflowStates) {
    let currentPhase = '';
    for (const ws of workflowStates) {
      if (ws.phase !== currentPhase) {
        currentPhase = ws.phase;
        console.log('\n--- ' + currentPhase.toUpperCase() + ' ---');
      }
      console.log(
        ws.state_order.toString().padEnd(8) +
        ws.phase.padEnd(18) +
        ws.state_code.padEnd(40) +
        (ws.state_name || '')
      );
    }
  }

  // Get ALL shipments
  const shipments = await getAllRows('shipments', '*');
  console.log('\n\n## DATA SUMMARY');
  console.log('='.repeat(80));
  console.log('Total Shipments:'.padEnd(30) + shipments.length.toString().padStart(8));

  // Get ALL documents
  const docs = await getAllRows('shipment_documents', 'shipment_id, document_type, email_id');
  console.log('Total Documents:'.padEnd(30) + docs.length.toString().padStart(8));

  // Get ALL emails
  const emails = await getAllRows('raw_emails', 'id, sender_email, subject, email_direction');
  console.log('Total Emails:'.padEnd(30) + emails.length.toString().padStart(8));

  const emailMap = new Map();
  emails.forEach(e => emailMap.set(e.id, e));

  // Workflow state distribution
  const stateCount = {};
  const phaseCount = {};

  for (const s of shipments) {
    const state = s.workflow_state || 'null';
    const phase = s.workflow_phase || 'null';

    stateCount[state] = (stateCount[state] || 0) + 1;
    phaseCount[phase] = (phaseCount[phase] || 0) + 1;
  }

  console.log('\n## PHASE DISTRIBUTION');
  console.log('-'.repeat(60));
  const phaseOrder = ['pre_departure', 'in_transit', 'pre_arrival', 'arrival', 'delivery', 'null'];
  phaseOrder.forEach(phase => {
    const count = phaseCount[phase] || 0;
    if (count > 0) {
      const pct = ((count / shipments.length) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / 2));
      console.log(phase.padEnd(18) + count.toString().padStart(6) + (' (' + pct + '%)').padStart(10) + '  ' + bar);
    }
  });

  console.log('\n## WORKFLOW STATE DISTRIBUTION (Grouped by Phase)');
  console.log('='.repeat(80));

  // Group states by phase
  const statesByPhase = {};
  if (workflowStates) {
    for (const ws of workflowStates) {
      if (!statesByPhase[ws.phase]) statesByPhase[ws.phase] = [];
      statesByPhase[ws.phase].push(ws);
    }
  }

  for (const phase of phaseOrder) {
    if (phase === 'null') continue;
    const states = statesByPhase[phase] || [];
    const phaseTotal = states.reduce((sum, ws) => sum + (stateCount[ws.state_code] || 0), 0);

    console.log('\n### ' + phase.toUpperCase() + ' (' + phaseTotal + ' shipments)');
    console.log('-'.repeat(70));

    for (const ws of states) {
      const count = stateCount[ws.state_code] || 0;
      if (count > 0) {
        const bar = '█'.repeat(Math.min(count, 50));
        console.log(
          ws.state_code.padEnd(40) +
          count.toString().padStart(5) + '  ' + bar
        );
      }
    }
  }

  // States with no shipments
  console.log('\n### STATES WITH NO SHIPMENTS');
  console.log('-'.repeat(70));
  if (workflowStates) {
    for (const ws of workflowStates) {
      if (!stateCount[ws.state_code]) {
        console.log('  ' + ws.state_code.padEnd(40) + ws.phase);
      }
    }
  }

  // Null states
  if (stateCount['null'] > 0) {
    console.log('\n### UNASSIGNED (no workflow state)');
    console.log('-'.repeat(70));
    console.log('null'.padEnd(40) + stateCount['null'].toString().padStart(5));
  }

  // Document type distribution
  const docTypeCount = {};
  for (const d of docs) {
    const type = d.document_type || 'null';
    docTypeCount[type] = (docTypeCount[type] || 0) + 1;
  }

  console.log('\n## DOCUMENT TYPE DISTRIBUTION');
  console.log('-'.repeat(60));
  Object.entries(docTypeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const bar = '█'.repeat(Math.min(Math.round(count / 10), 50));
      console.log(type.padEnd(35) + count.toString().padStart(6) + '  ' + bar);
    });

  // Direction distribution
  const dirCount = { inbound: 0, outbound: 0, null: 0 };
  for (const e of emails) {
    const dir = e.email_direction || 'null';
    dirCount[dir] = (dirCount[dir] || 0) + 1;
  }

  console.log('\n## EMAIL DIRECTION DISTRIBUTION');
  console.log('-'.repeat(60));
  Object.entries(dirCount).forEach(([dir, count]) => {
    const pct = ((count / emails.length) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / 50));
    console.log(dir.padEnd(15) + count.toString().padStart(6) + (' (' + pct + '%)').padStart(10) + '  ' + bar);
  });

  // Document type by direction
  console.log('\n## DOCUMENT TYPE BY DIRECTION');
  console.log('-'.repeat(80));
  console.log('Document Type'.padEnd(35) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10) + 'No Dir'.padStart(10) + 'Total'.padStart(10));
  console.log('-'.repeat(80));

  const docByDir = {};
  for (const d of docs) {
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
        row.null.toString().padStart(10) +
        row.total.toString().padStart(10)
      );
    });

  // BC Analysis
  console.log('\n## BOOKING CONFIRMATION ANALYSIS');
  console.log('='.repeat(80));

  const bcDocs = docs.filter(d =>
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
  const totalWithBc = new Set([...bcShipmentsByDir.inbound, ...bcShipmentsByDir.outbound]).size;

  console.log('');
  console.log('BC Received (inbound from carriers):'.padEnd(45) + bcReceived.toString().padStart(6));
  console.log('BC Shared (outbound to customers):'.padEnd(45) + bcShared.toString().padStart(6));
  console.log('');
  console.log('Shipments with ONLY BC Received:'.padEnd(45) + onlyReceived.toString().padStart(6));
  console.log('Shipments with ONLY BC Shared:'.padEnd(45) + onlyShared.toString().padStart(6));
  console.log('Shipments with BOTH BC states:'.padEnd(45) + bothBcStates.toString().padStart(6));
  console.log('Total unique shipments with BC:'.padEnd(45) + totalWithBc.toString().padStart(6));

  // Visual
  console.log('\n');
  console.log('BC Received:  ' + '█'.repeat(bcReceived) + ' ' + bcReceived);
  console.log('BC Shared:    ' + '█'.repeat(bcShared) + ' ' + bcShared);

  console.log('\n================================================================================');
}

generateReport().catch(console.error);
