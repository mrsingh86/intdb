import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get NOT LINKED booking confirmations with 95% confidence
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, confidence_score')
    .eq('document_type', 'booking_confirmation')
    .gte('confidence_score', 90);

  console.log('Found', classifications?.length, 'high-confidence booking confirmations\n');

  let notLinkedCount = 0;
  let noShipmentCount = 0;

  for (const c of classifications || []) {
    // Check if linked
    const { data: doc } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', c.email_id)
      .single();

    if (!doc) {
      notLinkedCount++;
      
      // Get email details
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email')
        .eq('id', c.email_id)
        .single();

      // Extract booking number from subject
      const match = (email?.subject || '').match(/(\d{9})/);
      const bookingNum = match ? match[1] : null;

      if (bookingNum) {
        // Check if shipment exists
        const { data: shipment } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', bookingNum)
          .single();

        if (!shipment) {
          noShipmentCount++;
          console.log('NO SHIPMENT:', bookingNum);
          console.log('  Subject:', (email?.subject || '').substring(0, 50));
          console.log('  Sender:', email?.sender_email);
          console.log('');
        }
      }
    }
  }

  console.log('---');
  console.log('Not linked to documents:', notLinkedCount);
  console.log('No shipment exists:', noShipmentCount);
}
main().catch(console.error);
