/**
 * Investigate documents with no linkable identifiers
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function fetchAll<T = any>(table: string, select: string): Promise<T[]> {
  let allData: T[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      allData = allData.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return allData;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('        INVESTIGATING DOCUMENTS WITH NO LINKABLE IDENTIFIERS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const [classifications, entities, linkedDocs] = await Promise.all([
    fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id,document_type'),
    fetchAll<{ email_id: string; entity_type: string; entity_value: string }>('entity_extractions', 'email_id,entity_type,entity_value'),
    fetchAll<{ email_id: string }>('shipment_documents', 'email_id'),
  ]);

  const linkedEmailIds = new Set(linkedDocs.map(d => d.email_id));

  // Get emails with linkable identifiers
  const linkableTypes = ['booking_number', 'mbl_number', 'bl_number', 'hbl_number', 'container_number'];
  const emailsWithIdentifiers = new Set(
    entities.filter(e => linkableTypes.includes(e.entity_type)).map(e => e.email_id)
  );

  // Find unlinked docs with NO identifiers
  const noIdentifierDocs = classifications.filter(c =>
    !linkedEmailIds.has(c.email_id) && !emailsWithIdentifiers.has(c.email_id)
  );

  console.log('Total docs with no linkable identifiers:', noIdentifierDocs.length);
  console.log('');

  // Group by document type
  const byDocType: Record<string, number> = {};
  noIdentifierDocs.forEach(d => {
    byDocType[d.document_type] = (byDocType[d.document_type] || 0) + 1;
  });

  console.log('By Document Type:');
  console.log('─'.repeat(50));
  Object.entries(byDocType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log('  ' + type.padEnd(35) + count.toString().padStart(5));
  });

  // Check what entities DO exist on these docs
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('        OTHER ENTITIES ON THESE DOCS (potential linking candidates)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const entitiesByEmail = new Map<string, { entity_type: string; entity_value: string }[]>();
  for (const e of entities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push(e);
    entitiesByEmail.set(e.email_id, existing);
  }

  const otherEntities: Record<string, number> = {};
  const sampleValues: Record<string, string[]> = {};

  for (const doc of noIdentifierDocs) {
    const docEntities = entitiesByEmail.get(doc.email_id) || [];
    docEntities.forEach(e => {
      otherEntities[e.entity_type] = (otherEntities[e.entity_type] || 0) + 1;
      if (!sampleValues[e.entity_type]) sampleValues[e.entity_type] = [];
      if (sampleValues[e.entity_type].length < 3 && e.entity_value) {
        sampleValues[e.entity_type].push(e.entity_value.substring(0, 30));
      }
    });
  }

  console.log('');
  console.log('Entity Type'.padEnd(25) + 'Count'.padStart(8) + '  Sample Values');
  console.log('─'.repeat(80));
  Object.entries(otherEntities).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([type, count]) => {
    const samples = sampleValues[type]?.join(', ') || '';
    console.log(type.padEnd(25) + count.toString().padStart(8) + '  ' + samples.substring(0, 45));
  });

  // Sample booking_confirmation with no identifiers - this is concerning!
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('        SAMPLES: booking_confirmation with NO identifiers');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const bookingNoId = noIdentifierDocs.filter(d => d.document_type === 'booking_confirmation').slice(0, 5);
  for (const doc of bookingNoId) {
    const { data: email } = await supabase.from('raw_emails').select('subject,sender_email').eq('id', doc.email_id).single();
    const docEntities = entitiesByEmail.get(doc.email_id) || [];
    console.log('');
    console.log('  Subject: ' + (email?.subject || 'N/A').substring(0, 80));
    console.log('  Sender: ' + (email?.sender_email || 'N/A'));
    console.log('  Entities: ' + (docEntities.length > 0 ? docEntities.map(e => e.entity_type).join(', ') : 'NONE'));
  }

  // Sample arrival_notice with no identifiers
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('        SAMPLES: arrival_notice with NO identifiers');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const arrivalNoId = noIdentifierDocs.filter(d => d.document_type === 'arrival_notice').slice(0, 5);
  for (const doc of arrivalNoId) {
    const { data: email } = await supabase.from('raw_emails').select('subject,sender_email').eq('id', doc.email_id).single();
    const docEntities = entitiesByEmail.get(doc.email_id) || [];
    console.log('');
    console.log('  Subject: ' + (email?.subject || 'N/A').substring(0, 80));
    console.log('  Sender: ' + (email?.sender_email || 'N/A'));
    console.log('  Entities: ' + (docEntities.length > 0 ? docEntities.map(e => e.entity_type).join(', ') : 'NONE'));
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('        ANALYSIS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const docsWithNoEntities = noIdentifierDocs.filter(d => {
    const docEntities = entitiesByEmail.get(d.email_id) || [];
    return docEntities.length === 0;
  });

  const docsWithOtherEntities = noIdentifierDocs.filter(d => {
    const docEntities = entitiesByEmail.get(d.email_id) || [];
    return docEntities.length > 0;
  });

  console.log('Total no-identifier docs: ' + noIdentifierDocs.length);
  console.log('  - With NO entities at all: ' + docsWithNoEntities.length + ' (entity extraction never ran)');
  console.log('  - With OTHER entities: ' + docsWithOtherEntities.length + ' (has entities, just not linkable ones)');
  console.log('');

  // Check if job_number could be useful
  const jobNumberDocs = noIdentifierDocs.filter(d => {
    const docEntities = entitiesByEmail.get(d.email_id) || [];
    return docEntities.some(e => e.entity_type === 'job_number');
  });
  console.log('Docs with job_number (potential linking via job#): ' + jobNumberDocs.length);
}

main().catch(console.error);
