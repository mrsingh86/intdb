import { supabase, isIntoglo } from './lib/supabase';

async function main() {
  // Get active shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id')
    .not('status', 'in', '(cancelled,completed,delivered)');

  const shipmentIds = shipments?.map(s => s.id) || [];
  console.log('Active shipments:', shipmentIds.length);

  // Get shipment_documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type, shipment_id')
    .in('shipment_id', shipmentIds);

  console.log('Total docs:', docs?.length);

  // Filter hbl_draft
  const hblDrafts = docs?.filter(d => d.document_type === 'hbl_draft');
  console.log('hbl_draft docs:', hblDrafts?.length);

  if (hblDrafts && hblDrafts.length > 0) {
    // Get senders
    const emailIds = hblDrafts.map(d => d.email_id);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email')
      .in('id', emailIds);

    console.log('\nhbl_draft breakdown:');
    emails?.forEach(e => {
      const out = isIntoglo(e.sender_email);
      const state = out ? 'hbl_draft_shared' : 'hbl_draft_received';
      console.log(' ', state, '-', e.sender_email);
    });
  }

  // Also check si_draft
  const siDrafts = docs?.filter(d => d.document_type === 'si_draft');
  console.log('\nsi_draft docs:', siDrafts?.length);

  if (siDrafts && siDrafts.length > 0) {
    const emailIds = siDrafts.map(d => d.email_id);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email')
      .in('id', emailIds);

    console.log('si_draft breakdown:');
    let received = 0, shared = 0;
    emails?.forEach(e => {
      if (isIntoglo(e.sender_email)) shared++;
      else received++;
    });
    console.log('  si_draft_received:', received);
    console.log('  si_draft_shared:', shared);
  }
}
main();
