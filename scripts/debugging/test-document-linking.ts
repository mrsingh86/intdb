import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  // Get one shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id')
    .limit(1)
    .single();

  console.log('Sample shipment:', shipment);

  // Check if email_id is valid
  const { data: email, error: emailErr } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('id', shipment?.created_from_email_id || '')
    .single();

  console.log('Email exists:', email ? 'YES' : 'NO', 'Error:', emailErr?.message);

  if (!shipment?.id || !shipment?.created_from_email_id) {
    console.log('Missing shipment or email_id');
    return;
  }

  // Try to manually insert a document link
  const { error: insertError } = await supabase
    .from('shipment_documents')
    .insert({
      email_id: shipment.created_from_email_id,
      shipment_id: shipment.id,
      document_type: 'booking_confirmation',
      link_method: 'backfill',
      link_confidence_score: 100,
    });

  console.log('Manual insert error:', insertError?.message || 'SUCCESS');

  // Check if it was inserted
  const { data: docs, count } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact' });

  console.log('Total docs after insert:', count);
  if (docs && docs.length > 0) {
    console.log('Sample doc:', docs[0]);
  }
}

check().catch(console.error);
