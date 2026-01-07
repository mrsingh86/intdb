import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get shipments with MOST documents
  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .not('shipment_id', 'is', null);

  const counts: Record<string, number> = {};
  for (const d of shipmentDocs || []) {
    counts[d.shipment_id] = (counts[d.shipment_id] || 0) + 1;
  }

  const topShipments = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(e => e[0]);

  console.log('SHIPMENTS WITH MOST DOCUMENTS:\n');

  for (const shipmentId of topShipments) {
    const { data: s } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    if (!s) continue;

    console.log('='.repeat(70));
    console.log('SHIPMENT:', s.booking_number);
    console.log('='.repeat(70));
    console.log('BL:', s.bl_number || 'N/A');
    console.log('HBL:', s.hbl_number || 'N/A');
    console.log('Vessel:', s.vessel_name || 'N/A');
    console.log('ETD:', s.etd ? s.etd.split('T')[0] : 'N/A');
    console.log('Status:', s.status);
    console.log('Workflow State:', s.workflow_state || 'NULL');
    console.log('Workflow Phase:', s.workflow_phase || 'NULL');

    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type, link_method, created_at, email_id')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true });

    console.log('\nDocument Journey (' + (docs?.length || 0) + ' docs):');

    for (const d of docs || []) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('received_at, subject')
        .eq('id', d.email_id)
        .single();

      const date = email?.received_at ? email.received_at.split('T')[0] : 'N/A';
      const subject = email?.subject ? email.subject.substring(0, 50) : '';
      console.log('  ' + date + ' | ' + d.document_type.padEnd(25) + ' | ' + subject + '...');
    }
    console.log('');
  }

  // Check workflow state distribution
  console.log('\n' + '='.repeat(70));
  console.log('WORKFLOW STATE DISTRIBUTION:');
  console.log('='.repeat(70));

  const { data: states } = await supabase
    .from('shipments')
    .select('workflow_state, workflow_phase');

  const stateCounts: Record<string, number> = {};
  for (const s of states || []) {
    const key = (s.workflow_state || 'NULL') + ' / ' + (s.workflow_phase || 'NULL');
    stateCounts[key] = (stateCounts[key] || 0) + 1;
  }

  for (const [state, count] of Object.entries(stateCounts).sort((a,b) => b[1] - a[1])) {
    console.log('  ' + state + ': ' + count);
  }

  // Check document type distribution for linked docs
  console.log('\n' + '='.repeat(70));
  console.log('LINKED DOCUMENT TYPES:');
  console.log('='.repeat(70));

  const { data: docTypes } = await supabase
    .from('shipment_documents')
    .select('document_type');

  const docTypeCounts: Record<string, number> = {};
  for (const d of docTypes || []) {
    docTypeCounts[d.document_type || 'NULL'] = (docTypeCounts[d.document_type || 'NULL'] || 0) + 1;
  }

  for (const [docType, count] of Object.entries(docTypeCounts).sort((a,b) => b[1] - a[1])) {
    console.log('  ' + docType + ': ' + count);
  }
}

// Check for cross-linking issues
async function checkCrossLinking() {
  console.log('\n' + '='.repeat(70));
  console.log('CROSS-LINKING CHECK:');
  console.log('='.repeat(70));

  const { data: multiLinked } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id');

  const emailShipments: Record<string, Set<string>> = {};
  for (const d of multiLinked || []) {
    if (d.email_id === null) continue;
    if (!emailShipments[d.email_id]) emailShipments[d.email_id] = new Set();
    emailShipments[d.email_id].add(d.shipment_id);
  }

  let multiCount = 0;
  const examples: string[] = [];
  for (const [emailId, shipments] of Object.entries(emailShipments)) {
    if (shipments.size > 1) {
      multiCount++;
      if (examples.length < 3) examples.push(emailId);
    }
  }
  console.log('  Emails linked to MULTIPLE shipments: ' + multiCount);

  if (examples.length > 0) {
    console.log('\n  Examples of cross-linked emails:');
    for (const emailId of examples) {
      const { data: links } = await supabase
        .from('shipment_documents')
        .select('shipment_id, document_type')
        .eq('email_id', emailId);

      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject')
        .eq('id', emailId)
        .single();

      console.log('    Email: ' + (email?.subject || '').substring(0, 50) + '...');
      console.log('    Linked to ' + (links?.length || 0) + ' shipments');
    }
  }
}

main().then(() => checkCrossLinking()).catch(console.error);
