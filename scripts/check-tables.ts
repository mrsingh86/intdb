import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkTables() {
  // Count all relevant tables
  const tables = [
    'document_lifecycle',
    'shipment_documents', 
    'entity_extractions',
    'document_classifications',
    'shipments',
    'raw_emails'
  ];

  console.log('=== Table Counts ===');
  for (const table of tables) {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    console.log(`${table}: ${count}`);
  }

  // Check shipment_documents with their document types
  const { data: docTypes } = await supabase
    .from('shipment_documents')
    .select('document_type')
    .limit(100);
  
  const typeCounts: Record<string, number> = {};
  docTypes?.forEach(d => {
    typeCounts[d.document_type] = (typeCounts[d.document_type] || 0) + 1;
  });
  console.log('\n=== Document Types in shipment_documents ===');
  console.log(typeCounts);

  // Check entity_extractions types
  const { data: entityTypes } = await supabase
    .from('entity_extractions')
    .select('entity_type')
    .limit(200);
  
  const entityCounts: Record<string, number> = {};
  entityTypes?.forEach(e => {
    entityCounts[e.entity_type] = (entityCounts[e.entity_type] || 0) + 1;
  });
  console.log('\n=== Entity Types in entity_extractions ===');
  console.log(entityCounts);
}

checkTables().catch(console.error);
