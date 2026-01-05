import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function backfillDocumentLifecycle() {
  console.log('=== Backfilling document_lifecycle from shipment_documents ===\n');

  // Get all unique shipment_id + document_type combinations from shipment_documents
  const { data: shipmentDocs, error: fetchError } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type, email_id, document_date, created_at')
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Error fetching shipment_documents:', fetchError);
    return;
  }

  const docCount = shipmentDocs?.length || 0;
  console.log(`Found ${docCount} shipment_documents`);

  if (!shipmentDocs || shipmentDocs.length === 0) {
    console.log('No shipment_documents to process');
    return;
  }

  // Group by shipment_id + document_type to get unique combinations
  const uniqueDocs = new Map<string, (typeof shipmentDocs)[0]>();
  for (const doc of shipmentDocs) {
    const key = `${doc.shipment_id}:${doc.document_type}`;
    if (!uniqueDocs.has(key)) {
      uniqueDocs.set(key, doc);
    }
  }

  console.log(`Unique shipment+doctype combinations: ${uniqueDocs.size}`);

  // Create document_lifecycle records
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const [key, doc] of uniqueDocs) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('document_lifecycle')
      .select('id')
      .eq('shipment_id', doc.shipment_id)
      .eq('document_type', doc.document_type)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    // Insert new lifecycle record
    const { error: insertError } = await supabase
      .from('document_lifecycle')
      .insert({
        shipment_id: doc.shipment_id,
        document_type: doc.document_type,
        lifecycle_status: 'draft',
        status_history: [{
          status: 'draft',
          changed_at: new Date().toISOString(),
          changed_by: 'system_backfill'
        }],
        quality_score: null,
        missing_fields: [],
        revision_count: 1,
        due_date: null
      });

    if (insertError) {
      console.error(`Error creating lifecycle for ${key}:`, insertError.message);
      errors++;
    } else {
      created++;
      process.stdout.write('.');
    }
  }

  console.log('\n\n=== Backfill Complete ===');
  console.log(`Created: ${created}`);
  console.log(`Skipped (already existed): ${skipped}`);
  console.log(`Errors: ${errors}`);

  // Verify count
  const { count } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal document_lifecycle records: ${count}`);
}

backfillDocumentLifecycle().catch(console.error);
