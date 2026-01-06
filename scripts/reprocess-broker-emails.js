/**
 * Reprocess broker emails to test new extraction patterns
 * - Portside (portsidecustoms.com)
 * - Artemus (artemus.us, CHBentries@outlook.com)
 * - Seven Seas (sssusainc.com)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function reprocessBrokerEmails() {
  console.log('='.repeat(100));
  console.log('REPROCESSING BROKER EMAILS');
  console.log('='.repeat(100));

  // Find all broker emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, processing_status')
    .or('sender_email.ilike.%portside%,sender_email.ilike.%artemus%,sender_email.ilike.%sssusainc%,sender_email.ilike.%CHBentries%')
    .order('received_at', { ascending: false });

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`\nFound ${emails?.length || 0} broker emails\n`);

  // Group by broker
  const portside = emails?.filter(e => e.sender_email?.toLowerCase().includes('portside')) || [];
  const artemus = emails?.filter(e =>
    e.sender_email?.toLowerCase().includes('artemus') ||
    e.sender_email?.toLowerCase().includes('chbentries')
  ) || [];
  const sevenSeas = emails?.filter(e => e.sender_email?.toLowerCase().includes('sssusainc')) || [];

  console.log(`Portside: ${portside.length} emails`);
  console.log(`Artemus: ${artemus.length} emails`);
  console.log(`Seven Seas: ${sevenSeas.length} emails`);

  const allBrokerIds = emails?.map(e => e.id) || [];

  if (allBrokerIds.length === 0) {
    console.log('\nNo broker emails to reprocess');
    return;
  }

  // Step 1: Delete existing entity_extractions for these emails
  console.log('\n1. Clearing existing entity_extractions...');
  const { error: deleteEntitiesError } = await supabase
    .from('entity_extractions')
    .delete()
    .in('email_id', allBrokerIds);

  if (deleteEntitiesError) {
    console.error('   Error:', deleteEntitiesError.message);
  } else {
    console.log('   ✅ Cleared');
  }

  // Step 2: Delete existing document_classifications for these emails
  console.log('\n2. Clearing existing document_classifications...');
  const { error: deleteClassError } = await supabase
    .from('document_classifications')
    .delete()
    .in('email_id', allBrokerIds);

  if (deleteClassError) {
    console.error('   Error:', deleteClassError.message);
  } else {
    console.log('   ✅ Cleared');
  }

  // Step 3: Delete existing shipment_documents for these emails (orphan docs)
  console.log('\n3. Clearing existing shipment_documents...');
  const { error: deleteDocsError } = await supabase
    .from('shipment_documents')
    .delete()
    .in('email_id', allBrokerIds);

  if (deleteDocsError) {
    console.error('   Error:', deleteDocsError.message);
  } else {
    console.log('   ✅ Cleared');
  }

  // Step 4: Reset processing status to 'pending'
  console.log('\n4. Resetting processing status to pending...');
  const { error: updateError } = await supabase
    .from('raw_emails')
    .update({
      processing_status: 'pending',
      processing_error: null
    })
    .in('id', allBrokerIds);

  if (updateError) {
    console.error('   Error:', updateError.message);
  } else {
    console.log('   ✅ Reset', allBrokerIds.length, 'emails to pending');
  }

  // Step 5: Call the processing API
  console.log('\n5. Triggering email processing...');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const response = await fetch(`${baseUrl}/api/cron/process-emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'dev-secret'}`
      },
      body: JSON.stringify({ limit: 50 })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('   ✅ Processing triggered');
      console.log('   Result:', JSON.stringify(result, null, 2));
    } else {
      console.log('   ⚠️  API returned:', response.status);
      // Continue anyway - we can check results manually
    }
  } catch (fetchError) {
    console.log('   ⚠️  Could not call API (server may not be running)');
    console.log('   Emails are reset to pending - run cron job manually');
  }

  // Step 6: Check results after a delay
  console.log('\n6. Checking results (waiting 2 seconds)...');
  await new Promise(r => setTimeout(r, 2000));

  // Check entity_extractions
  const { data: newEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', allBrokerIds);

  console.log(`\n   Entity extractions created: ${newEntities?.length || 0}`);

  // Group by type
  const entityTypes = {};
  for (const e of newEntities || []) {
    entityTypes[e.entity_type] = (entityTypes[e.entity_type] || 0) + 1;
  }

  if (Object.keys(entityTypes).length > 0) {
    console.log('\n   By type:');
    for (const [type, count] of Object.entries(entityTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${type}: ${count}`);
    }
  }

  // Check document_classifications
  const { data: newClassifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, confidence_score')
    .in('email_id', allBrokerIds);

  console.log(`\n   Document classifications created: ${newClassifications?.length || 0}`);

  // Group by document type
  const docTypes = {};
  for (const c of newClassifications || []) {
    docTypes[c.document_type] = (docTypes[c.document_type] || 0) + 1;
  }

  if (Object.keys(docTypes).length > 0) {
    console.log('\n   By document type:');
    for (const [type, count] of Object.entries(docTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${type}: ${count}`);
    }
  }

  // Check shipment_documents (including orphans)
  const { data: newDocs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type, shipment_id, status')
    .in('email_id', allBrokerIds);

  console.log(`\n   Shipment documents created: ${newDocs?.length || 0}`);

  const linked = newDocs?.filter(d => d.shipment_id) || [];
  const orphan = newDocs?.filter(d => !d.shipment_id) || [];
  console.log(`     Linked to shipment: ${linked.length}`);
  console.log(`     Orphan (pending link): ${orphan.length}`);

  console.log('\n' + '='.repeat(100));
  console.log('REPROCESSING COMPLETE');
  console.log('='.repeat(100));
}

reprocessBrokerEmails().catch(console.error);
