#!/usr/bin/env npx tsx
/**
 * Show Sample Shipment Journey
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function showJourney() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    SAMPLE SHIPMENT JOURNEY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get a shipment with journey events
  const { data: events } = await supabase
    .from('shipment_journey_events')
    .select('shipment_id')
    .limit(100);

  const shipmentIds = [...new Set(events?.map(e => e.shipment_id) || [])];
  const sampleId = shipmentIds[0];

  if (!sampleId) {
    console.log('No journey events found');
    return;
  }

  // Get shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('booking_number, bl_number, status, etd, eta, vessel_name')
    .eq('id', sampleId)
    .single();

  console.log('');
  console.log('SHIPMENT DETAILS:');
  console.log('─'.repeat(70));
  console.log(`  Booking:  ${shipment?.booking_number || 'N/A'}`);
  console.log(`  BL:       ${shipment?.bl_number || 'N/A'}`);
  console.log(`  Status:   ${shipment?.status}`);
  console.log(`  Vessel:   ${shipment?.vessel_name || 'N/A'}`);
  console.log(`  ETD:      ${shipment?.etd || 'N/A'}`);
  console.log(`  ETA:      ${shipment?.eta || 'N/A'}`);

  // Get journey events
  const { data: journeyEvents } = await supabase
    .from('shipment_journey_events')
    .select('event_type, event_date, milestone_type, source_document_type, notes')
    .eq('shipment_id', sampleId)
    .order('event_date', { ascending: true });

  console.log('');
  console.log(`JOURNEY EVENTS (${journeyEvents?.length || 0}):`);
  console.log('─'.repeat(70));
  for (const e of journeyEvents?.slice(0, 15) || []) {
    const date = e.event_date?.split('T')[0] || 'unknown';
    console.log(`  ${date}  ${(e.event_type || '').padEnd(20)} | ${(e.milestone_type || '').padEnd(15)} | ${e.source_document_type || ''}`);
  }
  if ((journeyEvents?.length || 0) > 15) {
    console.log(`  ... and ${(journeyEvents?.length || 0) - 15} more events`);
  }

  // Get blockers
  const { data: blockers } = await supabase
    .from('shipment_blockers')
    .select('blocker_type, severity, status, description')
    .eq('shipment_id', sampleId);

  if (blockers && blockers.length > 0) {
    console.log('');
    console.log(`BLOCKERS (${blockers.length}):`);
    console.log('─'.repeat(70));
    for (const b of blockers) {
      console.log(`  [${b.severity}] ${b.blocker_type} - ${b.status}`);
      console.log(`    ${(b.description || '').substring(0, 60)}`);
    }
  }

  // Get communications
  const { data: comms } = await supabase
    .from('stakeholder_communication_timeline')
    .select('communication_date, stakeholder_type, communication_type, summary')
    .eq('shipment_id', sampleId)
    .order('communication_date', { ascending: true })
    .limit(10);

  if (comms && comms.length > 0) {
    console.log('');
    console.log(`STAKEHOLDER COMMUNICATIONS (${comms.length}):`);
    console.log('─'.repeat(70));
    for (const c of comms) {
      const date = c.communication_date?.split('T')[0] || 'unknown';
      console.log(`  ${date}  ${(c.stakeholder_type || '').padEnd(15)} | ${(c.communication_type || '').padEnd(10)} | ${(c.summary || '').substring(0, 30)}`);
    }
  }

  // Get linked documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('document_type, email_id, link_confidence_score, link_method')
    .eq('shipment_id', sampleId);

  console.log('');
  console.log(`LINKED DOCUMENTS (${docs?.length || 0}):`);
  console.log('─'.repeat(70));

  const docTypeCounts: Record<string, number> = {};
  for (const d of docs || []) {
    docTypeCounts[d.document_type] = (docTypeCounts[d.document_type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(docTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

showJourney().catch(console.error);
