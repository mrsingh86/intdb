import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkLinks() {
  // 1. Get a sample document_lifecycle
  const { data: lifecycles } = await supabase
    .from('document_lifecycle')
    .select('id, document_type, shipment_id')
    .limit(5);
  
  console.log('=== Document Lifecycles ===');
  console.log(JSON.stringify(lifecycles, null, 2));

  if (!lifecycles || lifecycles.length === 0) {
    console.log('No document_lifecycle records found!');
    return;
  }

  // 2. For first lifecycle, check shipment_documents
  const lifecycle = lifecycles[0];
  const { data: shipmentDocs } = await supabase
    .from('shipment_documents')
    .select('id, email_id, classification_id, document_type')
    .eq('shipment_id', lifecycle.shipment_id)
    .eq('document_type', lifecycle.document_type);

  console.log('\n=== Shipment Documents for lifecycle ===');
  console.log(`Looking for shipment_id=${lifecycle.shipment_id}, doc_type=${lifecycle.document_type}`);
  console.log(JSON.stringify(shipmentDocs, null, 2));

  // 3. Check what email_ids DO have entity extractions
  const { data: entityEmails } = await supabase
    .from('entity_extractions')
    .select('email_id, source_document_type')
    .not('email_id', 'is', null)
    .limit(20);

  console.log('\n=== Sample entity extractions (email_id, source_doc_type) ===');
  console.log(JSON.stringify(entityEmails, null, 2));

  // 4. Check if shipment_documents emails match entity_extraction emails
  const { data: allShipmentDocs } = await supabase
    .from('shipment_documents')
    .select('email_id')
    .not('email_id', 'is', null)
    .limit(50);

  const shipmentEmailIds = allShipmentDocs?.map(d => d.email_id) || [];
  const entityEmailIds = entityEmails?.map(e => e.email_id) || [];
  
  const overlap = shipmentEmailIds.filter(id => entityEmailIds.includes(id));
  console.log('\n=== Overlap Analysis ===');
  console.log(`Shipment doc email_ids (sample): ${shipmentEmailIds.length}`);
  console.log(`Entity extraction email_ids (sample): ${entityEmailIds.length}`);
  console.log(`Overlapping: ${overlap.length}`);
  if (overlap.length > 0) {
    console.log('Overlapping IDs:', overlap);
  }
}

checkLinks().catch(console.error);
