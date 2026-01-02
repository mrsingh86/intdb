/**
 * Sync shipment_documents.document_type from document_classifications
 */
import { supabase, fetchAll } from './lib/supabase';

async function main() {
  console.log('Syncing shipment_documents.document_type from document_classifications...\n');

  // Get all document_classifications
  const classifications = await fetchAll<{ email_id: string; document_type: string }>(
    'document_classifications',
    'email_id, document_type'
  );

  console.log('Classifications:', classifications.length);

  // Create lookup
  const classMap = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // Get all shipment_documents
  const shipmentDocs = await fetchAll<{ id: string; email_id: string; document_type: string }>(
    'shipment_documents',
    'id, email_id, document_type'
  );

  console.log('Shipment documents:', shipmentDocs.length);

  // Find mismatches
  const updates: Array<{ id: string; oldType: string; newType: string }> = [];

  for (const doc of shipmentDocs) {
    const correctType = classMap.get(doc.email_id);
    if (correctType && correctType !== doc.document_type) {
      updates.push({
        id: doc.id,
        oldType: doc.document_type,
        newType: correctType,
      });
    }
  }

  console.log('\nMismatches found:', updates.length);

  if (updates.length === 0) {
    console.log('All document types are in sync!');
    return;
  }

  // Group by change type
  const byChange: Record<string, number> = {};
  for (const u of updates) {
    const key = `${u.oldType} → ${u.newType}`;
    byChange[key] = (byChange[key] || 0) + 1;
  }

  console.log('\nChanges to apply:');
  Object.entries(byChange)
    .sort((a, b) => b[1] - a[1])
    .forEach(([change, count]) => {
      console.log(`  ${change}: ${count}`);
    });

  // Apply updates in batches
  console.log('\nApplying updates...');
  let updated = 0;

  for (const u of updates) {
    const { error } = await supabase
      .from('shipment_documents')
      .update({ document_type: u.newType })
      .eq('id', u.id);

    if (!error) updated++;
  }

  console.log(`\n✓ Updated ${updated} shipment_documents`);
}

main().catch(console.error);
