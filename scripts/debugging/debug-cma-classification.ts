import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, processing_status, created_at, updated_at')
    .ilike('subject', '%CAD0851262%')
    .single();

  if (!email) {
    console.log('Email not found');
    return;
  }
  console.log('Email:', email.id);
  console.log('Status:', email.processing_status);
  console.log('Created:', email.created_at);
  console.log('Updated:', email.updated_at);
  console.log('');

  // Get PDF attachment
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('id, filename, extraction_status, created_at, updated_at')
    .eq('email_id', email.id)
    .ilike('filename', '%.pdf')
    .single();

  if (att) {
    console.log('PDF:', att.filename);
    console.log('Extraction status:', att.extraction_status);
    console.log('Attachment created:', att.created_at);
    console.log('Attachment updated:', att.updated_at);
    console.log('');
  }

  // Get classification
  const { data: cls } = await supabase
    .from('attachment_classifications')
    .select('id, document_type, confidence, classification_source, created_at')
    .eq('email_id', email.id);

  console.log('Classifications:', cls?.length || 0);
  if (cls) {
    cls.forEach(c => {
      const docType = c.document_type || 'null';
      const conf = c.confidence || 'null';
      const source = c.classification_source || 'null';
      console.log(`- ${docType}, conf: ${conf}, source: ${source}, created: ${c.created_at}`);
    });
  }

  // Check the shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, created_at, carrier_id')
    .eq('booking_number', 'CAD0851262')
    .single();

  if (shipment) {
    console.log('');
    console.log('Shipment:', shipment.booking_number);
    console.log('Carrier ID:', shipment.carrier_id);
    console.log('Created:', shipment.created_at);
  }

  // Check email_extractions
  const { data: extr } = await supabase
    .from('email_extractions')
    .select('entity_type, entity_value, created_at')
    .eq('email_id', email.id);

  console.log('');
  console.log('Extractions:', extr?.length || 0);
  if (extr) {
    extr.forEach(e => {
      console.log(`- ${e.entity_type}: ${e.entity_value} (${e.created_at})`);
    });
  }
}

check().catch(console.error);
