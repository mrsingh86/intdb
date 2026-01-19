require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function summary() {
  console.log('='.repeat(100));
  console.log('BROKER EMAIL PROCESSING SUMMARY');
  console.log('='.repeat(100));

  // Get broker email IDs
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email')
    .or('sender_email.ilike.%portside%,sender_email.ilike.%artemus%,sender_email.ilike.%sssusainc%,sender_email.ilike.%CHBentries%');

  const brokerIds = emails?.map(e => e.id) || [];
  console.log('\nTotal broker emails:', brokerIds.length);

  // Classifications
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('document_type')
    .in('email_id', brokerIds);

  console.log('\n📋 DOCUMENT CLASSIFICATIONS:', classifications?.length || 0);
  const classTypes = {};
  for (const c of classifications || []) {
    classTypes[c.document_type] = (classTypes[c.document_type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(classTypes).sort((a, b) => b[1] - a[1])) {
    console.log('   ' + type.padEnd(25) + count);
  }

  // Entity extractions
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type')
    .in('email_id', brokerIds);

  console.log('\n📦 ENTITY EXTRACTIONS:', entities?.length || 0);
  const entityTypes = {};
  for (const e of entities || []) {
    entityTypes[e.entity_type] = (entityTypes[e.entity_type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(entityTypes).sort((a, b) => b[1] - a[1])) {
    console.log('   ' + type.padEnd(25) + count);
  }

  // Shipment documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, status, document_type')
    .in('email_id', brokerIds);

  console.log('\n📄 SHIPMENT DOCUMENTS:', docs?.length || 0);
  const linked = docs?.filter(d => d.shipment_id) || [];
  const orphan = docs?.filter(d => d.shipment_id === null) || [];
  console.log('   Linked to shipment:'.padEnd(25) + linked.length);
  console.log('   Orphan (pending):'.padEnd(25) + orphan.length);

  // Show linked documents
  if (linked.length > 0) {
    console.log('\n✅ SUCCESSFULLY LINKED TO SHIPMENTS:');
    for (const d of linked) {
      console.log('   - ' + d.document_type + ' -> shipment ' + d.shipment_id.substring(0, 8) + '...');
    }
  }

  // Orphan by type
  console.log('\n📋 ORPHAN DOCUMENTS BY TYPE:');
  const orphanTypes = {};
  for (const d of orphan) {
    orphanTypes[d.document_type] = (orphanTypes[d.document_type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(orphanTypes).sort((a, b) => b[1] - a[1])) {
    console.log('   ' + type.padEnd(25) + count);
  }

  console.log('\n' + '='.repeat(100));
}

summary().catch(console.error);
