#!/usr/bin/env npx tsx
/**
 * Deep dive into shipments - comprehensive analysis
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com', 'msc.com', 'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com', 'cosco.com', 'coscoshipping.com',
  'yangming.com', 'one-line.com', 'zim.com',
  'hmm21.com', 'pilship.com', 'wanhai.com', 'sitc.com',
];

function isDirectCarrier(trueSender: string | null, sender: string | null): boolean {
  if (trueSender) {
    const domain = trueSender.toLowerCase().split('@')[1] || '';
    if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) return true;
  }
  if (sender) {
    const domain = sender.toLowerCase().split('@')[1] || '';
    return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
  }
  return false;
}

async function deepDive() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         SHIPMENTS DEEP DIVE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 1. OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════════
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false });

  const total = shipments?.length || 0;

  console.log('1. OVERVIEW');
  console.log('─'.repeat(70));
  console.log(`   Total shipments: ${total}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 2. SOURCE ANALYSIS (Direct Carrier vs Forward)
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('2. SOURCE ANALYSIS');
  console.log('─'.repeat(70));

  let fromDirectCarrier = 0;
  let fromForward = 0;
  let noSourceEmail = 0;
  const carrierBreakdown: Record<string, number> = {};

  for (const s of shipments || []) {
    if (!s.created_from_email_id) {
      noSourceEmail++;
      continue;
    }

    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', s.created_from_email_id)
      .single();

    if (!email) {
      noSourceEmail++;
      continue;
    }

    if (isDirectCarrier(email.true_sender_email, email.sender_email)) {
      fromDirectCarrier++;
      // Track carrier
      const trueDomain = email.true_sender_email?.toLowerCase().split('@')[1] || '';
      const senderDomain = email.sender_email?.toLowerCase().split('@')[1] || '';
      const domain = trueDomain || senderDomain;

      if (domain.includes('maersk')) carrierBreakdown['Maersk'] = (carrierBreakdown['Maersk'] || 0) + 1;
      else if (domain.includes('hapag') || domain.includes('hlag')) carrierBreakdown['Hapag-Lloyd'] = (carrierBreakdown['Hapag-Lloyd'] || 0) + 1;
      else if (domain.includes('msc')) carrierBreakdown['MSC'] = (carrierBreakdown['MSC'] || 0) + 1;
      else if (domain.includes('cma')) carrierBreakdown['CMA CGM'] = (carrierBreakdown['CMA CGM'] || 0) + 1;
      else if (domain.includes('cosco')) carrierBreakdown['COSCO'] = (carrierBreakdown['COSCO'] || 0) + 1;
      else if (domain.includes('one-line')) carrierBreakdown['ONE'] = (carrierBreakdown['ONE'] || 0) + 1;
      else if (domain.includes('evergreen')) carrierBreakdown['Evergreen'] = (carrierBreakdown['Evergreen'] || 0) + 1;
      else carrierBreakdown['Other'] = (carrierBreakdown['Other'] || 0) + 1;
    } else {
      fromForward++;
    }
  }

  console.log(`   From direct carrier:  ${fromDirectCarrier} (${Math.round(fromDirectCarrier/total*100)}%)`);
  console.log(`   From forwards:        ${fromForward} (${Math.round(fromForward/total*100)}%)`);
  console.log(`   No source email:      ${noSourceEmail}`);
  console.log('');
  console.log('   Carrier breakdown (direct carrier shipments):');
  for (const [carrier, count] of Object.entries(carrierBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${carrier.padEnd(15)} ${count}`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 3. DATA COMPLETENESS
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('3. DATA COMPLETENESS');
  console.log('─'.repeat(70));

  const fields = {
    booking_number: 0,
    bl_number: 0,
    vessel_name: 0,
    voyage_number: 0,
    port_of_loading: 0,
    port_of_discharge: 0,
    etd: 0,
    eta: 0,
    si_cutoff: 0,
    vgm_cutoff: 0,
    cargo_cutoff: 0,
    gate_cutoff: 0,
    shipper_id: 0,
    consignee_id: 0,
    carrier_id: 0,
    container_number_primary: 0,
  };

  for (const s of shipments || []) {
    if (s.booking_number) fields.booking_number++;
    if (s.bl_number) fields.bl_number++;
    if (s.vessel_name) fields.vessel_name++;
    if (s.voyage_number) fields.voyage_number++;
    if (s.port_of_loading) fields.port_of_loading++;
    if (s.port_of_discharge) fields.port_of_discharge++;
    if (s.etd) fields.etd++;
    if (s.eta) fields.eta++;
    if (s.si_cutoff) fields.si_cutoff++;
    if (s.vgm_cutoff) fields.vgm_cutoff++;
    if (s.cargo_cutoff) fields.cargo_cutoff++;
    if (s.gate_cutoff) fields.gate_cutoff++;
    if (s.shipper_id) fields.shipper_id++;
    if (s.consignee_id) fields.consignee_id++;
    if (s.carrier_id) fields.carrier_id++;
    if (s.container_number_primary) fields.container_number_primary++;
  }

  console.log('   FIELD                    COUNT    COVERAGE');
  console.log('   ' + '─'.repeat(50));

  const categories = {
    'IDENTIFIERS': ['booking_number', 'bl_number', 'container_number_primary'],
    'VESSEL': ['vessel_name', 'voyage_number', 'carrier_id'],
    'ROUTING': ['port_of_loading', 'port_of_discharge'],
    'DATES': ['etd', 'eta'],
    'CUTOFFS': ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'],
    'STAKEHOLDERS': ['shipper_id', 'consignee_id'],
  };

  for (const [category, categoryFields] of Object.entries(categories)) {
    console.log(`   ${category}:`);
    for (const field of categoryFields) {
      const count = fields[field as keyof typeof fields];
      const pct = Math.round(count / total * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      console.log(`      ${field.padEnd(25)} ${String(count).padStart(4)}  ${bar} ${pct}%`);
    }
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 4. WORKFLOW STATUS
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('4. WORKFLOW STATUS');
  console.log('─'.repeat(70));

  const byStatus: Record<string, number> = {};
  const byWorkflowState: Record<string, number> = {};
  const byWorkflowPhase: Record<string, number> = {};

  for (const s of shipments || []) {
    byStatus[s.status || 'null'] = (byStatus[s.status || 'null'] || 0) + 1;
    byWorkflowState[s.workflow_state || 'null'] = (byWorkflowState[s.workflow_state || 'null'] || 0) + 1;
    byWorkflowPhase[s.workflow_phase || 'null'] = (byWorkflowPhase[s.workflow_phase || 'null'] || 0) + 1;
  }

  console.log('   By Status:');
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${status.padEnd(20)} ${count}`);
  }
  console.log('');

  console.log('   By Workflow State (top 10):');
  for (const [state, count] of Object.entries(byWorkflowState).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`      ${state.padEnd(30)} ${count}`);
  }
  console.log('');

  console.log('   By Workflow Phase:');
  for (const [phase, count] of Object.entries(byWorkflowPhase).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${phase.padEnd(20)} ${count}`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 5. LINKED DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('5. LINKED DOCUMENTS');
  console.log('─'.repeat(70));

  const { data: links } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type');

  const totalLinks = links?.length || 0;
  const shipmentsWithLinks = new Set(links?.map(l => l.shipment_id) || []).size;

  const linksByType: Record<string, number> = {};
  for (const l of links || []) {
    linksByType[l.document_type] = (linksByType[l.document_type] || 0) + 1;
  }

  console.log(`   Total email-shipment links: ${totalLinks}`);
  console.log(`   Shipments with linked docs: ${shipmentsWithLinks} / ${total} (${Math.round(shipmentsWithLinks/total*100)}%)`);
  console.log(`   Average docs per shipment:  ${(totalLinks / shipmentsWithLinks).toFixed(1)}`);
  console.log('');
  console.log('   By Document Type:');
  for (const [type, count] of Object.entries(linksByType).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`      ${type.padEnd(30)} ${count}`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 6. DATE RANGES
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('6. DATE RANGES');
  console.log('─'.repeat(70));

  const etds = (shipments || []).filter(s => s.etd).map(s => s.etd).sort();
  const etas = (shipments || []).filter(s => s.eta).map(s => s.eta).sort();
  const createdDates = (shipments || []).map(s => s.created_at?.split('T')[0]).sort();

  if (etds.length > 0) {
    console.log(`   ETD range: ${etds[0]} to ${etds[etds.length - 1]}`);
  }
  if (etas.length > 0) {
    console.log(`   ETA range: ${etas[0]} to ${etas[etas.length - 1]}`);
  }
  if (createdDates.length > 0) {
    console.log(`   Created range: ${createdDates[0]} to ${createdDates[createdDates.length - 1]}`);
  }
  console.log('');

  // By month
  const byMonth: Record<string, number> = {};
  for (const s of shipments || []) {
    const month = s.created_at?.substring(0, 7) || 'unknown';
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  console.log('   Shipments by Month Created:');
  for (const [month, count] of Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]))) {
    const bar = '█'.repeat(Math.min(Math.floor(count / 5), 30));
    console.log(`      ${month}  ${String(count).padStart(4)}  ${bar}`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 7. SAMPLE SHIPMENTS
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('7. SAMPLE SHIPMENTS (5 most recent)');
  console.log('─'.repeat(70));

  for (const s of (shipments || []).slice(0, 5)) {
    console.log('');
    console.log(`   BOOKING: ${s.booking_number || 'N/A'}`);
    console.log(`   ─────────────────────────────────────────────────────────────`);
    console.log(`   Status:        ${s.status || 'N/A'} | Workflow: ${s.workflow_state || 'N/A'}`);
    console.log(`   Vessel:        ${s.vessel_name || 'N/A'} / ${s.voyage_number || 'N/A'}`);
    console.log(`   Route:         ${s.port_of_loading || 'N/A'} → ${s.port_of_discharge || 'N/A'}`);
    console.log(`   Dates:         ETD: ${s.etd || 'N/A'} | ETA: ${s.eta || 'N/A'}`);
    console.log(`   Cutoffs:       SI: ${s.si_cutoff || '-'} | VGM: ${s.vgm_cutoff || '-'} | Cargo: ${s.cargo_cutoff || '-'}`);
    console.log(`   Stakeholders:  Shipper: ${s.shipper_id ? 'linked' : 'N/A'} | Consignee: ${s.consignee_id ? 'linked' : 'N/A'}`);
    console.log(`   Created:       ${s.created_at?.substring(0, 10) || 'N/A'}`);

    // Get linked doc count
    const { count: docCount } = await supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', s.id);

    console.log(`   Linked docs:   ${docCount || 0}`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════════
  // 8. DATA QUALITY ISSUES
  // ═══════════════════════════════════════════════════════════════════════════════
  console.log('8. DATA QUALITY CHECK');
  console.log('─'.repeat(70));

  let missingVessel = 0;
  let missingPorts = 0;
  let missingDates = 0;
  let missingCutoffs = 0;
  let missingStakeholders = 0;
  let suspiciousVessel = 0;

  for (const s of shipments || []) {
    if (!s.vessel_name) missingVessel++;
    if (!s.port_of_loading || !s.port_of_discharge) missingPorts++;
    if (!s.etd || !s.eta) missingDates++;
    if (!s.si_cutoff && !s.vgm_cutoff && !s.cargo_cutoff) missingCutoffs++;
    if (!s.shipper_id && !s.consignee_id) missingStakeholders++;

    // Check for suspicious vessel names (template text)
    if (s.vessel_name && (
      s.vessel_name.toLowerCase().includes('business day') ||
      s.vessel_name.toLowerCase().includes('email subject') ||
      s.vessel_name.toLowerCase().includes('ment number')
    )) {
      suspiciousVessel++;
    }
  }

  console.log('   ISSUE                           COUNT   % OF TOTAL');
  console.log('   ' + '─'.repeat(50));
  console.log(`   Missing vessel name             ${String(missingVessel).padStart(5)}   ${Math.round(missingVessel/total*100)}%`);
  console.log(`   Missing ports (POL or POD)      ${String(missingPorts).padStart(5)}   ${Math.round(missingPorts/total*100)}%`);
  console.log(`   Missing dates (ETD or ETA)      ${String(missingDates).padStart(5)}   ${Math.round(missingDates/total*100)}%`);
  console.log(`   Missing ALL cutoffs             ${String(missingCutoffs).padStart(5)}   ${Math.round(missingCutoffs/total*100)}%`);
  console.log(`   Missing ALL stakeholders        ${String(missingStakeholders).padStart(5)}   ${Math.round(missingStakeholders/total*100)}%`);
  console.log(`   Suspicious vessel names         ${String(suspiciousVessel).padStart(5)}   ${Math.round(suspiciousVessel/total*100)}%`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              END OF DEEP DIVE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

deepDive().catch(console.error);
