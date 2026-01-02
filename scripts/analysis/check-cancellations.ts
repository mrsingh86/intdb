/**
 * Check cancelled bookings
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get cancellation documents
  const { data: cancellations } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_cancellation');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         BOOKING CANCELLATION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Total cancellation emails classified:', cancellations?.length || 0);

  if (!cancellations || cancellations.length === 0) {
    console.log('No cancellation documents found.');
    return;
  }

  // Get cancellation emails with details
  const cancelEmailIds = cancellations.map(c => c.email_id);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, true_sender_email')
    .in('id', cancelEmailIds);

  console.log('');
  console.log('CANCELLATION EMAILS:');
  console.log('─'.repeat(70));
  for (const e of emails || []) {
    console.log('  Subject:', e.subject?.substring(0, 60));
    console.log('  From:', e.true_sender_email);
    console.log('');
  }

  // Get linked shipments via shipment_documents
  const { data: links } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id')
    .in('email_id', cancelEmailIds);

  const linkedShipmentIds = [...new Set((links || []).map(l => l.shipment_id))];
  console.log('Linked to shipments:', linkedShipmentIds.length);
  console.log('');

  if (linkedShipmentIds.length === 0) {
    console.log('No cancellation documents are linked to shipments.');
    return;
  }

  // Get shipment details one by one to avoid query issues
  console.log('CANCELLED SHIPMENTS:');
  console.log('─'.repeat(70));

  for (const shipmentId of linkedShipmentIds) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, booking_number, status, workflow_state, carrier_name')
      .eq('id', shipmentId)
      .single();

    if (shipment) {
      console.log('');
      console.log('  Booking:', shipment.booking_number);
      console.log('  Carrier:', shipment.carrier_name);
      console.log('  Status:', shipment.status);
      console.log('  Workflow State:', shipment.workflow_state);
    }
  }

  // Get total shipments for percentage
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY:');
  console.log('─'.repeat(70));
  console.log('  Total shipments:', totalShipments);
  console.log('  With cancellation notice:', linkedShipmentIds.length);
  console.log('  Cancellation rate:', ((linkedShipmentIds.length / (totalShipments || 1)) * 100).toFixed(1) + '%');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
