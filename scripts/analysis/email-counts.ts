import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function getAllEmailIds(table: string, column: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    data.forEach((row: Record<string, string>) => ids.add(row[column]));
    offset += limit;

    if (data.length < limit) break;
  }

  return ids;
}

async function count() {
  // Total raw emails
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('id', { count: 'exact', head: true });

  // Emails with entity extractions (paginated)
  const emailsWithEntities = await getAllEmailIds('entity_extractions', 'email_id');

  // Emails linked to shipments (paginated)
  const linkedEmails = await getAllEmailIds('shipment_documents', 'email_id');

  // Emails with classifications
  const { count: classified } = await supabase
    .from('document_classifications')
    .select('id', { count: 'exact', head: true });

  // Count by identifier type
  const { data: bookingData } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'booking_number');
  const withBooking = new Set(bookingData?.map(e => e.email_id)).size;

  const { data: blData } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'bl_number');
  const withBL = new Set(blData?.map(e => e.email_id)).size;

  const { data: containerData } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'container_number');
  const withContainer = new Set(containerData?.map(e => e.email_id)).size;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    EMAIL COUNTS SUMMARY                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('TOTAL EMAILS:');
  console.log('─'.repeat(50));
  console.log('  raw_emails table:        ' + (totalEmails || 0).toString().padStart(5));
  console.log('');
  console.log('PROCESSING COVERAGE:');
  console.log('─'.repeat(50));
  console.log('  With classification:     ' + (classified || 0).toString().padStart(5) + '  (' + (((classified || 0) / (totalEmails || 1)) * 100).toFixed(1) + '%)');
  console.log('  With entity extraction:  ' + emailsWithEntities.size.toString().padStart(5) + '  (' + ((emailsWithEntities.size / (totalEmails || 1)) * 100).toFixed(1) + '%)');
  console.log('  Linked to shipments:     ' + linkedEmails.size.toString().padStart(5) + '  (' + ((linkedEmails.size / (totalEmails || 1)) * 100).toFixed(1) + '%)');
  console.log('');
  console.log('ENTITY EXTRACTION BY TYPE:');
  console.log('─'.repeat(50));
  console.log('  With booking_number:     ' + withBooking.toString().padStart(5));
  console.log('  With bl_number:          ' + withBL.toString().padStart(5));
  console.log('  With container_number:   ' + withContainer.toString().padStart(5));
  console.log('');
  console.log('GAPS:');
  console.log('─'.repeat(50));
  console.log('  Not classified:          ' + ((totalEmails || 0) - (classified || 0)).toString().padStart(5));
  console.log('  Not extracted:           ' + ((totalEmails || 0) - emailsWithEntities.size).toString().padStart(5));
  console.log('  Not linked:              ' + ((totalEmails || 0) - linkedEmails.size).toString().padStart(5));
}

count();
