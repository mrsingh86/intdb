/**
 * Analyze Entity Extraction Gap
 *
 * Why do so many classified documents not have booking numbers extracted?
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 1000;

async function fetchAll<T = any>(table: string, select: string = '*'): Promise<T[]> {
  let allData: T[] = [];
  let page = 0;
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
  console.log('              ENTITY EXTRACTION GAP ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get classifications and entities
  const classifications = await fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id,document_type');
  const entities = await fetchAll<{ email_id: string; entity_type: string }>('entity_extractions', 'email_id,entity_type');

  console.log(`Classifications: ${classifications.length}`);
  console.log(`Entities: ${entities.length}`);
  console.log('');

  // Get emails with booking number entities
  const emailsWithBooking = new Set(
    entities.filter(e => e.entity_type === 'booking_number').map(e => e.email_id)
  );

  // Key document types that SHOULD have booking numbers
  const keyTypes = ['bill_of_lading', 'shipping_instruction', 'invoice', 'arrival_notice', 'booking_confirmation', 'booking_amendment', 'freight_invoice', 'delivery_order'];

  console.log('Document Type'.padEnd(30) + 'Total'.padStart(8) + 'Has BKG#'.padStart(10) + 'Missing'.padStart(10) + '%Missing'.padStart(10));
  console.log('─'.repeat(68));

  for (const docType of keyTypes) {
    const docsOfType = classifications.filter(c => c.document_type === docType);
    const withBooking = docsOfType.filter(c => emailsWithBooking.has(c.email_id)).length;
    const missing = docsOfType.length - withBooking;
    const pctMissing = docsOfType.length > 0 ? ((missing / docsOfType.length) * 100).toFixed(0) : '0';

    console.log(
      docType.padEnd(30) +
      docsOfType.length.toString().padStart(8) +
      withBooking.toString().padStart(10) +
      missing.toString().padStart(10) +
      (pctMissing + '%').padStart(10)
    );
  }

  // Sample some BL documents without booking numbers
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE: BL docs WITHOUT booking numbers');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const blWithoutBooking = classifications
    .filter(c => c.document_type === 'bill_of_lading')
    .filter(c => !emailsWithBooking.has(c.email_id))
    .slice(0, 8);

  for (const bl of blWithoutBooking) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', bl.email_id)
      .single();

    // Check what entities DO exist for this email
    const emailEntities = entities.filter(e => e.email_id === bl.email_id);

    console.log('Email: ' + bl.email_id.substring(0, 8) + '...');
    console.log('  Subject: ' + (email?.subject || 'N/A').substring(0, 80));
    console.log('  Sender: ' + (email?.sender_email || 'N/A'));
    console.log('  Entities: ' + (emailEntities.length > 0 ? emailEntities.map(e => e.entity_type).join(', ') : 'NONE'));
    console.log('');
  }

  // Sample some SI documents without booking numbers
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE: SI docs WITHOUT booking numbers');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const siWithoutBooking = classifications
    .filter(c => c.document_type === 'shipping_instruction')
    .filter(c => !emailsWithBooking.has(c.email_id))
    .slice(0, 5);

  for (const si of siWithoutBooking) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', si.email_id)
      .single();

    console.log('Email: ' + si.email_id.substring(0, 8) + '...');
    console.log('  Subject: ' + (email?.subject || 'N/A').substring(0, 80));
    console.log('');
  }
}

main().catch(console.error);
