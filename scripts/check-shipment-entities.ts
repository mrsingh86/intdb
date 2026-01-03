import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  // Get shipment 263825330
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .eq('booking_number', '263825330')
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('Shipment ID:', shipment.id);

  // Get linked documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type')
    .eq('shipment_id', shipment.id);

  console.log('\nLinked documents:', docs?.length || 0);
  docs?.forEach(d => console.log('  ', d.document_type, d.email_id?.substring(0,8)));

  // Get entity_extractions for linked emails
  const emailIds = docs?.map(d => d.email_id).filter(Boolean) || [];
  console.log('\nEmail IDs:', emailIds.length);

  if (emailIds.length > 0) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('email_id', emailIds)
      .in('entity_type', ['shipper', 'shipper_name', 'consignee', 'consignee_name', 'notify_party']);

    console.log('\nStakeholder entities:', entities?.length || 0);
    entities?.forEach(e => {
      console.log('  ', e.entity_type.padEnd(15), e.entity_value?.substring(0,50));
    });
  }
}
check();
