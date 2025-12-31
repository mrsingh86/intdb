#!/usr/bin/env npx tsx
/**
 * Check Linkage & Journey Status
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkLinkage() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    LINKAGE & JOURNEY STATUS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Email-Shipment Links
  const { count: totalLinks } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });
  const { data: links } = await supabase.from('shipment_documents').select('email_id, shipment_id');
  const uniqueEmails = new Set(links?.map(l => l.email_id) || []);
  const uniqueShipments = new Set(links?.map(l => l.shipment_id) || []);

  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const { count: totalShipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });

  console.log('EMAIL-SHIPMENT LINKAGE:');
  console.log('─'.repeat(60));
  console.log(`  Total links:           ${totalLinks}`);
  console.log(`  Unique emails linked:  ${uniqueEmails.size} / ${totalEmails} (${Math.round(uniqueEmails.size/(totalEmails || 1)*100)}%)`);
  console.log(`  Shipments with emails: ${uniqueShipments.size} / ${totalShipments}`);
  console.log('');

  // 2. Check link metadata
  const { data: linkMeta } = await supabase
    .from('shipment_documents')
    .select('link_confidence_score, link_method, link_identifier_type')
    .limit(5000);

  const hasConfidence = linkMeta?.filter(l => l.link_confidence_score != null).length || 0;
  const hasMethod = linkMeta?.filter(l => l.link_method != null).length || 0;
  const hasIdentifier = linkMeta?.filter(l => l.link_identifier_type != null).length || 0;

  console.log('LINK METADATA:');
  console.log('─'.repeat(60));
  console.log(`  With confidence_score: ${hasConfidence} / ${linkMeta?.length || 0}`);
  console.log(`  With link_method:      ${hasMethod}`);
  console.log(`  With identifier_type:  ${hasIdentifier}`);
  console.log('');

  // 3. Check journey tables
  const tables = ['shipment_journey_events', 'shipment_blockers', 'stakeholder_communication_timeline'];
  console.log('JOURNEY TABLES:');
  console.log('─'.repeat(60));

  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${table}: NOT EXISTS or ERROR`);
    } else {
      console.log(`  ${table}: ${count} records`);
    }
  }
  console.log('');

  // 4. Sample journey for one shipment
  console.log('SAMPLE SHIPMENT JOURNEY:');
  console.log('─'.repeat(60));

  // Get a shipment with many documents
  const { data: richShipment } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .limit(500);

  const shipmentCounts: Record<string, number> = {};
  for (const doc of richShipment || []) {
    shipmentCounts[doc.shipment_id] = (shipmentCounts[doc.shipment_id] || 0) + 1;
  }

  const topShipment = Object.entries(shipmentCounts).sort((a, b) => b[1] - a[1])[0];

  if (topShipment) {
    const [shipmentId, docCount] = topShipment;

    // Get shipment details
    const { data: shipment } = await supabase
      .from('shipments')
      .select('booking_number, bl_number, status')
      .eq('id', shipmentId)
      .single();

    console.log(`  Shipment: ${shipment?.booking_number || 'N/A'}`);
    console.log(`  BL: ${shipment?.bl_number || 'N/A'}`);
    console.log(`  Status: ${shipment?.status || 'N/A'}`);
    console.log(`  Linked docs: ${docCount}`);
    console.log('');

    // Get document timeline
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type, email_id')
      .eq('shipment_id', shipmentId);

    // Get email dates
    const emailIds = docs?.map(d => d.email_id) || [];
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, received_at, subject')
      .in('id', emailIds)
      .order('received_at', { ascending: true });

    const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

    // Build timeline
    const timeline: { date: string; type: string; subject: string }[] = [];
    for (const doc of docs || []) {
      const email = emailMap.get(doc.email_id);
      if (email) {
        timeline.push({
          date: email.received_at?.split('T')[0] || 'unknown',
          type: doc.document_type,
          subject: (email.subject || '').substring(0, 40)
        });
      }
    }

    // Sort by date
    timeline.sort((a, b) => a.date.localeCompare(b.date));

    console.log('  JOURNEY TIMELINE:');
    for (const item of timeline.slice(0, 15)) {
      console.log(`    ${item.date}  ${item.type.padEnd(25)} ${item.subject}`);
    }
    if (timeline.length > 15) {
      console.log(`    ... and ${timeline.length - 15} more documents`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

checkLinkage().catch(console.error);
