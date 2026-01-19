import { supabase } from './lib/supabase';

async function main() {
  // Get hbl_draft classifications
  const { data: hblDrafts } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'hbl_draft');

  console.log('Total hbl_draft:', hblDrafts?.length);

  // Check if linked to shipments
  const emailIds = hblDrafts?.map(d => d.email_id) || [];
  const { data: linked } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id')
    .in('email_id', emailIds);

  console.log('Linked to shipments:', linked?.length);

  if (linked && linked.length > 0) {
    // Check shipment status
    const shipmentIds = linked.map(l => l.shipment_id);
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, status, booking_number')
      .in('id', shipmentIds);

    console.log('\nLinked shipments:');
    shipments?.forEach(s => console.log('  ', s.booking_number, '-', s.status));
  } else {
    console.log('\nNo hbl_draft emails are linked to shipments yet!');
    console.log('This is why hbl_draft_shared shows 0 in the distribution.');
  }
}
main();
