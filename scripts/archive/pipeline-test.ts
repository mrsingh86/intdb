import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runPipelineTests() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           INTDB PIPELINE TEST SUITE - ALL STAGES                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const results: { name: string; pass: boolean }[] = [];

  // ============================================
  // STAGE 1: RAW EMAIL INGESTION
  // ============================================
  console.log('═══ STAGE 1: RAW EMAIL INGESTION ═══');

  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const { data: emailStatusData } = await supabase
    .from('raw_emails')
    .select('processing_status');

  const emailStatusCounts: Record<string, number> = {};
  emailStatusData?.forEach(e => {
    const status = e.processing_status || 'NULL';
    emailStatusCounts[status] = (emailStatusCounts[status] || 0) + 1;
  });

  console.log('Total emails: ' + totalEmails);
  console.log('Processing status breakdown:');
  Object.entries(emailStatusCounts).forEach(([k, v]) =>
    console.log('  - ' + k + ': ' + v));

  // Check email_direction
  const { data: directionData } = await supabase
    .from('raw_emails')
    .select('email_direction');

  const dirCounts: Record<string, number> = { NULL: 0 };
  directionData?.forEach(e => {
    const dir = e.email_direction || 'NULL';
    dirCounts[dir] = (dirCounts[dir] || 0) + 1;
  });
  console.log('Email direction:');
  Object.entries(dirCounts).forEach(([k, v]) =>
    console.log('  - ' + k + ': ' + v));

  const test1_pass = (dirCounts['NULL'] || 0) === 0;
  console.log('\n✓ TEST 1.1 (Email direction populated): ' + (test1_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '1.1 Email direction', pass: test1_pass });

  // ============================================
  // STAGE 2: RAW ATTACHMENT INGESTION
  // ============================================
  console.log('\n═══ STAGE 2: RAW ATTACHMENT INGESTION ═══');

  const { count: totalAttachments } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });

  const { data: attData } = await supabase
    .from('raw_attachments')
    .select('extraction_status, is_business_document, is_signature_image, mime_type');

  console.log('Total attachments: ' + totalAttachments);

  // Extraction status
  const extStatusCounts: Record<string, number> = {};
  attData?.forEach(a => {
    const status = a.extraction_status || 'NULL';
    extStatusCounts[status] = (extStatusCounts[status] || 0) + 1;
  });
  console.log('Extraction status:');
  Object.entries(extStatusCounts).forEach(([k, v]) =>
    console.log('  - ' + k + ': ' + v));

  // Business vs signature
  const businessCount = attData?.filter(a => a.is_business_document === true).length || 0;
  const signatureCount = attData?.filter(a => a.is_signature_image === true).length || 0;
  const unflaggedCount = attData?.filter(a =>
    a.is_business_document === null && a.is_signature_image === null).length || 0;

  console.log('Business documents: ' + businessCount);
  console.log('Signature images: ' + signatureCount);
  console.log('Unflagged: ' + unflaggedCount);

  const test2_pass = unflaggedCount === 0;
  console.log('\n✓ TEST 2.1 (All attachments flagged): ' + (test2_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '2.1 Attachments flagged', pass: test2_pass });

  // PDF extraction
  const extractedCount = extStatusCounts['completed'] || 0;
  const pendingPdf = (extStatusCounts['pending'] || 0);

  const test2b_pass = pendingPdf === 0 || businessCount === extractedCount;
  console.log('✓ TEST 2.2 (PDFs extracted): ' + (test2b_pass ? 'PASS ✅' : 'FAIL ❌ (' + pendingPdf + ' pending)'));
  results.push({ name: '2.2 PDFs extracted', pass: test2b_pass });

  // ============================================
  // STAGE 3: EMAIL FLAGGING
  // ============================================
  console.log('\n═══ STAGE 3: EMAIL FLAGGING ═══');

  const { data: flagData } = await supabase
    .from('raw_emails')
    .select('is_response, clean_subject, true_sender_email, thread_position, content_hash');

  const flagCounts = {
    is_response_set: flagData?.filter(e => e.is_response !== null).length || 0,
    clean_subject_set: flagData?.filter(e => e.clean_subject !== null).length || 0,
    true_sender_set: flagData?.filter(e => e.true_sender_email !== null).length || 0,
    thread_position_set: flagData?.filter(e => e.thread_position !== null).length || 0,
    content_hash_set: flagData?.filter(e => e.content_hash !== null).length || 0,
  };

  console.log('is_response populated: ' + flagCounts.is_response_set + '/' + totalEmails);
  console.log('clean_subject populated: ' + flagCounts.clean_subject_set + '/' + totalEmails);
  console.log('true_sender populated: ' + flagCounts.true_sender_set + '/' + totalEmails);
  console.log('thread_position populated: ' + flagCounts.thread_position_set + '/' + totalEmails);
  console.log('content_hash populated: ' + flagCounts.content_hash_set + '/' + totalEmails);

  const test3_pass = flagCounts.clean_subject_set === totalEmails;
  console.log('\n✓ TEST 3.1 (Email flags computed): ' + (test3_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '3.1 Email flags computed', pass: test3_pass });

  // ============================================
  // STAGE 4: CLASSIFICATION
  // ============================================
  console.log('\n═══ STAGE 4: CLASSIFICATION ═══');

  const { count: emailClassCount } = await supabase
    .from('email_classifications')
    .select('*', { count: 'exact', head: true });

  const { count: attClassCount } = await supabase
    .from('attachment_classifications')
    .select('*', { count: 'exact', head: true });

  console.log('email_classifications: ' + (emailClassCount || 0) + ' records');
  console.log('attachment_classifications: ' + (attClassCount || 0) + ' records');

  // Check classification types
  const { data: emailClassTypes } = await supabase
    .from('email_classifications')
    .select('email_type')
    .limit(100);

  const emailTypeCounts: Record<string, number> = {};
  emailClassTypes?.forEach(e => {
    const type = e.email_type || 'NULL';
    emailTypeCounts[type] = (emailTypeCounts[type] || 0) + 1;
  });
  if (Object.keys(emailTypeCounts).length > 0) {
    console.log('Email types found:');
    Object.entries(emailTypeCounts).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
  }

  const { data: docClassTypes } = await supabase
    .from('attachment_classifications')
    .select('document_type')
    .limit(100);

  const docTypeCounts: Record<string, number> = {};
  docClassTypes?.forEach(d => {
    const type = d.document_type || 'NULL';
    docTypeCounts[type] = (docTypeCounts[type] || 0) + 1;
  });
  if (Object.keys(docTypeCounts).length > 0) {
    console.log('Document types found:');
    Object.entries(docTypeCounts).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
  }

  const test4a_pass = (emailClassCount || 0) > 0;
  const test4b_pass = (attClassCount || 0) > 0 || businessCount === 0;
  console.log('\n✓ TEST 4.1 (Email classifications exist): ' + (test4a_pass ? 'PASS ✅' : 'FAIL ❌'));
  console.log('✓ TEST 4.2 (Attachment classifications exist): ' + (test4b_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '4.1 Email classifications', pass: test4a_pass });
  results.push({ name: '4.2 Attachment classifications', pass: test4b_pass });

  // ============================================
  // STAGE 5: EXTRACTION
  // ============================================
  console.log('\n═══ STAGE 5: ENTITY EXTRACTION ═══');

  const { count: emailExtCount } = await supabase
    .from('email_extractions')
    .select('*', { count: 'exact', head: true });

  const { count: docExtCount } = await supabase
    .from('document_extractions')
    .select('*', { count: 'exact', head: true });

  console.log('email_extractions: ' + (emailExtCount || 0) + ' records');
  console.log('document_extractions: ' + (docExtCount || 0) + ' records');

  // Check entity types
  const { data: emailEntities } = await supabase
    .from('email_extractions')
    .select('entity_type')
    .limit(200);

  const emailEntityCounts: Record<string, number> = {};
  emailEntities?.forEach(e => {
    emailEntityCounts[e.entity_type] = (emailEntityCounts[e.entity_type] || 0) + 1;
  });
  if (Object.keys(emailEntityCounts).length > 0) {
    console.log('Email entity types:');
    Object.entries(emailEntityCounts).slice(0, 10).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
  }

  const { data: docEntities } = await supabase
    .from('document_extractions')
    .select('entity_type')
    .limit(200);

  const docEntityCounts: Record<string, number> = {};
  docEntities?.forEach(e => {
    docEntityCounts[e.entity_type] = (docEntityCounts[e.entity_type] || 0) + 1;
  });
  if (Object.keys(docEntityCounts).length > 0) {
    console.log('Document entity types:');
    Object.entries(docEntityCounts).slice(0, 10).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
  }

  const test5a_pass = (emailExtCount || 0) > 0;
  const test5b_pass = (docExtCount || 0) > 0 || extractedCount === 0;
  console.log('\n✓ TEST 5.1 (Email extractions exist): ' + (test5a_pass ? 'PASS ✅' : 'FAIL ❌'));
  console.log('✓ TEST 5.2 (Document extractions exist): ' + (test5b_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '5.1 Email extractions', pass: test5a_pass });
  results.push({ name: '5.2 Document extractions', pass: test5b_pass });

  // ============================================
  // STAGE 6: SHIPMENT LINKING
  // ============================================
  console.log('\n═══ STAGE 6: SHIPMENT LINKING ═══');

  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { data: linkData } = await supabase
    .from('email_shipment_links')
    .select('shipment_id, status, link_method');

  const linkedCount = linkData?.filter(l => l.shipment_id !== null).length || 0;
  const orphanCount = linkData?.filter(l => l.shipment_id === null).length || 0;

  console.log('Shipments created: ' + (shipmentCount || 0));
  console.log('Email links: ' + (linkData?.length || 0) + ' total');
  console.log('  - Linked to shipment: ' + linkedCount);
  console.log('  - Orphan (no shipment): ' + orphanCount);

  // Link methods
  const linkMethods: Record<string, number> = {};
  linkData?.forEach(l => {
    linkMethods[l.link_method || 'NULL'] = (linkMethods[l.link_method || 'NULL'] || 0) + 1;
  });
  if (Object.keys(linkMethods).length > 0) {
    console.log('Link methods:');
    Object.entries(linkMethods).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
  }

  const test6_pass = (shipmentCount || 0) > 0;
  console.log('\n✓ TEST 6.1 (Shipments created): ' + (test6_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '6.1 Shipments created', pass: test6_pass });

  // ============================================
  // STAGE 7: WORKFLOW STATE
  // ============================================
  console.log('\n═══ STAGE 7: WORKFLOW STATE ═══');

  const { data: workflowData } = await supabase
    .from('shipments')
    .select('workflow_state, workflow_phase')
    .limit(100);

  const workflowStates: Record<string, number> = {};
  const workflowPhases: Record<string, number> = {};
  workflowData?.forEach(s => {
    workflowStates[s.workflow_state || 'NULL'] = (workflowStates[s.workflow_state || 'NULL'] || 0) + 1;
    workflowPhases[s.workflow_phase || 'NULL'] = (workflowPhases[s.workflow_phase || 'NULL'] || 0) + 1;
  });

  if (Object.keys(workflowStates).length > 0) {
    console.log('Workflow states:');
    Object.entries(workflowStates).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
    console.log('Workflow phases:');
    Object.entries(workflowPhases).forEach(([k, v]) =>
      console.log('  - ' + k + ': ' + v));
  }

  const hasWorkflowStates = Object.keys(workflowStates).length > 0 && !workflowStates['NULL'];
  const test7_pass = hasWorkflowStates || (shipmentCount || 0) === 0;
  console.log('\n✓ TEST 7.1 (Workflow states assigned): ' + (test7_pass ? 'PASS ✅' : 'FAIL ❌'));
  results.push({ name: '7.1 Workflow states', pass: test7_pass });

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  const passed = results.filter(t => t.pass).length;
  const failed = results.filter(t => !t.pass).length;

  results.forEach(t => console.log((t.pass ? '✅' : '❌') + ' ' + t.name));

  console.log('\n═══ RESULT: ' + passed + '/' + results.length + ' tests passed ═══');

  if (failed > 0) {
    console.log('\n⚠️ CRITICAL ISSUES TO FIX:');
    results.filter(t => !t.pass).forEach(t => console.log('  - ' + t.name));
  }
}

runPipelineTests().catch(console.error);
