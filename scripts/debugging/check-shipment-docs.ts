import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkShipmentDocs() {
  // Direct query to get shipments
  const { data: shipments, error: shipErr } = await supabase
    .from('shipments')
    .select('id, booking_number, status')
    .limit(15);

  if (shipErr) {
    console.error('Error fetching shipments:', shipErr.message);
    return;
  }

  console.log(`Found ${shipments?.length || 0} shipments\n`);

  // Get all shipment_documents
  const { data: allDocs, error: docErr } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id');

  if (docErr) {
    console.error('Error fetching documents:', docErr.message);
  }

  console.log(`Total linked documents: ${allDocs?.length || 0}\n`);

  // Get all classifications
  const { data: allClassifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  const classificationMap = new Map(
    allClassifications?.map(c => [c.email_id, c.document_type]) || []
  );

  console.log('Shipment details:\n');

  for (const s of shipments || []) {
    const linkedDocs = allDocs?.filter(d => d.shipment_id === s.id) || [];
    const docCount = linkedDocs.length;

    const docTypes = linkedDocs
      .map(d => classificationMap.get(d.email_id))
      .filter(Boolean);

    const booking = s.booking_number || 'N/A';
    console.log(`${booking.padEnd(25)} | status=${s.status.padEnd(10)} | docs=${docCount} | types=[${docTypes.join(', ') || 'none'}]`);
  }

  // Check doc type distribution
  console.log('\n=== Document Type Distribution ===');
  const typeCount: Record<string, number> = {};
  allClassifications?.forEach(c => {
    const t = c.document_type || 'null';
    typeCount[t] = (typeCount[t] || 0) + 1;
  });
  Object.entries(typeCount).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`${type}: ${count}`);
  });
}

checkShipmentDocs().catch(console.error);
