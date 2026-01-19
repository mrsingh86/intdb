/**
 * Investigate why classification/extraction failed for some emails
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; value: any }
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

async function investigate() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('INVESTIGATING CLASSIFICATION/EXTRACTION FAILURES');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Get overall stats
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const { count: classifiedEmails } = await supabase.from('document_classifications').select('*', { count: 'exact', head: true });
  const { count: linkedEmails } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });

  console.log('\n1. OVERALL STATS:');
  console.log(`   Total emails: ${totalEmails}`);
  console.log(`   Classified: ${classifiedEmails}`);
  console.log(`   Linked to shipments: ${linkedEmails}`);

  // 2. Find unclassified emails
  const allEmails = await fetchAll<{ id: string }>('raw_emails', 'id');
  const classifiedIds = await fetchAll<{ email_id: string }>('document_classifications', 'email_id');

  const classifiedSet = new Set(classifiedIds.map(c => c.email_id));
  const unclassified = allEmails.filter(e => !classifiedSet.has(e.id));

  console.log(`\n2. UNCLASSIFIED EMAILS: ${unclassified.length}`);

  // 3. Get samples of unclassified emails
  if (unclassified.length > 0) {
    const sampleIds = unclassified.slice(0, 10).map(e => e.id);
    const { data: samples } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, received_at, processing_status, processing_error')
      .in('id', sampleIds);

    console.log('\n   Sample unclassified emails:');
    for (const s of samples || []) {
      console.log('   ─────────────────────────────────────────');
      console.log(`   ID: ${s.id}`);
      console.log(`   Subject: ${(s.subject || '').substring(0, 60)}`);
      console.log(`   From: ${s.sender_email}`);
      console.log(`   Status: ${s.processing_status}`);
      console.log(`   Error: ${s.processing_error || 'none'}`);
    }
  }

  // 4. Processing status breakdown
  const statusBreakdown = await fetchAll<{ processing_status: string }>('raw_emails', 'processing_status');

  const statusCounts = new Map<string, number>();
  for (const r of statusBreakdown) {
    const status = r.processing_status || 'null';
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }

  console.log('\n3. PROCESSING STATUS BREAKDOWN:');
  [...statusCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });

  // 5. Classification type breakdown
  const classTypes = await fetchAll<{ document_type: string }>('document_classifications', 'document_type');

  const typeCounts = new Map<string, number>();
  for (const c of classTypes) {
    const type = c.document_type || 'unknown';
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }

  console.log('\n4. DOCUMENT TYPE BREAKDOWN:');
  [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  // 6. Find emails with NO entity extractions
  const extractedIds = await fetchAll<{ email_id: string }>('entity_extractions', 'email_id');
  const extractedSet = new Set(extractedIds.map(e => e.email_id));
  const noExtractions = allEmails.filter(e => !extractedSet.has(e.id));

  console.log(`\n5. EMAILS WITH NO EXTRACTIONS: ${noExtractions.length}`);

  // 7. Sample emails with no extractions
  if (noExtractions.length > 0) {
    const sampleIds = noExtractions.slice(0, 5).map(e => e.id);
    const { data: samples } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email')
      .in('id', sampleIds);

    // Check if they're classified
    const { data: sampleClassifications } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', sampleIds);

    const classMap = new Map(sampleClassifications?.map(c => [c.email_id, c.document_type]) || []);

    console.log('\n   Sample emails with no extractions:');
    for (const s of samples || []) {
      console.log('   ─────────────────────────────────────────');
      console.log(`   Subject: ${(s.subject || '').substring(0, 60)}`);
      console.log(`   Classified as: ${classMap.get(s.id) || 'NOT CLASSIFIED'}`);
    }
  }

  // 8. Check for processing errors
  const { data: errors } = await supabase
    .from('raw_emails')
    .select('processing_error')
    .not('processing_error', 'is', null)
    .limit(100);

  const errorCounts = new Map<string, number>();
  for (const e of errors || []) {
    const err = (e.processing_error || '').substring(0, 80);
    errorCounts.set(err, (errorCounts.get(err) || 0) + 1);
  }

  console.log('\n6. PROCESSING ERRORS:');
  if (errorCounts.size === 0) {
    console.log('   No processing errors found');
  } else {
    [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([err, count]) => {
      console.log(`   [${count}x] ${err}`);
    });
  }

  // 9. Emails classified but NOT extracted
  const classifiedButNotExtracted = classifiedIds.filter(c => !extractedSet.has(c.email_id));
  console.log(`\n7. CLASSIFIED BUT NO EXTRACTION: ${classifiedButNotExtracted.length}`);

  if (classifiedButNotExtracted.length > 0) {
    const sampleIds = classifiedButNotExtracted.slice(0, 5).map(c => c.email_id);
    const { data: samples } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .in('id', sampleIds);

    const { data: sampleClassifications } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', sampleIds);

    const classMap = new Map(sampleClassifications?.map(c => [c.email_id, c.document_type]) || []);

    console.log('\n   Sample classified but not extracted:');
    for (const s of samples || []) {
      console.log('   ─────────────────────────────────────────');
      console.log(`   Subject: ${(s.subject || '').substring(0, 60)}`);
      console.log(`   Type: ${classMap.get(s.id)}`);
    }
  }

  // 10. Check extraction methods
  const { data: extractionMethods } = await supabase
    .from('entity_extractions')
    .select('extraction_method')
    .limit(5000);

  const methodCounts = new Map<string, number>();
  for (const e of extractionMethods || []) {
    const method = e.extraction_method || 'unknown';
    methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
  }

  console.log('\n8. EXTRACTION METHODS:');
  [...methodCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([method, count]) => {
    console.log(`   ${method}: ${count}`);
  });
}

investigate().catch(console.error);
