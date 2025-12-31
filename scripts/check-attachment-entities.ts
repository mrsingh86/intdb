import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  const missingBookings = ['263522475', '263522431', '263522385', '263522096'];

  console.log('=== ATTACHMENTS & ENTITY EXTRACTIONS FOR MISSING BOOKINGS ===\n');

  for (const bn of missingBookings) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('created_from_email_id')
      .eq('booking_number', bn)
      .single();

    if (!shipment) continue;

    // Get attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('id, filename, mime_type, extraction_status, extracted_text')
      .eq('email_id', shipment.created_from_email_id);

    // Get entities from this email (both body and attachments)
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, attachment_id')
      .eq('email_id', shipment.created_from_email_id);

    console.log('Booking:', bn);
    console.log('  Attachments:', attachments?.length || 0);
    attachments?.forEach(a => {
      console.log('    -', a.filename, '| mime:', a.mime_type, '| status:', a.extraction_status);
      console.log('      extracted_text length:', a.extracted_text?.length || 0);
    });
    console.log('  Entities:', entities?.length || 0);
    entities?.forEach(e => {
      const source = e.attachment_id ? 'attachment' : 'body';
      console.log('    -', e.entity_type, ':', e.entity_value, '(from', source + ')');
    });
    console.log('');
  }

  // Now check a GOOD booking with proper data
  console.log('\n=== GOOD BOOKING FOR COMPARISON ===\n');

  const { data: goodShipment } = await supabase
    .from('shipments')
    .select('booking_number, created_from_email_id, etd, eta, port_of_loading, port_of_discharge')
    .not('etd', 'is', null)
    .not('port_of_loading', 'is', null)
    .limit(1)
    .single();

  if (goodShipment) {
    console.log('Booking:', goodShipment.booking_number);
    console.log('  ETD:', goodShipment.etd);
    console.log('  ETA:', goodShipment.eta);
    console.log('  POL:', goodShipment.port_of_loading);
    console.log('  POD:', goodShipment.port_of_discharge);

    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('id, filename, extraction_status, extracted_text')
      .eq('email_id', goodShipment.created_from_email_id);

    console.log('  Attachments:', attachments?.length || 0);
    attachments?.forEach(a => {
      console.log('    -', a.filename, '| status:', a.extraction_status);
      console.log('      extracted_text preview:', a.extracted_text?.substring(0, 300));
    });

    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, attachment_id')
      .eq('email_id', goodShipment.created_from_email_id);

    console.log('  Entities:', entities?.length || 0);
    const relevant = entities?.filter(e =>
      ['etd', 'eta', 'port_of_loading', 'port_of_discharge', 'vessel_name'].includes(e.entity_type)
    );
    relevant?.forEach(e => {
      const source = e.attachment_id ? 'attachment' : 'body';
      console.log('    -', e.entity_type, ':', e.entity_value, '(from', source + ')');
    });
  }

  // Check extraction status distribution
  console.log('\n=== ATTACHMENT EXTRACTION STATUS DISTRIBUTION ===\n');

  const { data: statusDist } = await supabase
    .from('raw_attachments')
    .select('extraction_status');

  const counts: Record<string, number> = {};
  statusDist?.forEach(a => {
    const status = a.extraction_status || 'null';
    counts[status] = (counts[status] || 0) + 1;
  });

  Object.entries(counts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });

  // Check how many entities come from attachments vs body
  console.log('\n=== ENTITY SOURCE DISTRIBUTION ===\n');

  const { data: allEntities } = await supabase
    .from('entity_extractions')
    .select('attachment_id');

  let fromAttachment = 0;
  let fromBody = 0;
  allEntities?.forEach(e => {
    if (e.attachment_id) fromAttachment++;
    else fromBody++;
  });

  console.log(`  From attachments: ${fromAttachment}`);
  console.log(`  From email body: ${fromBody}`);
}

check().catch(console.error);
