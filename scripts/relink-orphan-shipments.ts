import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Get all shipments
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, workflow_state');

  // Get all existing document links
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id');

  const shipmentWithDocs = new Set((allDocs || []).map(d => d.shipment_id));
  const orphanShipments = (allShipments || []).filter(s => !shipmentWithDocs.has(s.id));

  console.log('ORPHAN SHIPMENTS:', orphanShipments.length);
  console.log(dryRun ? '(DRY RUN)\n' : '\n');

  let linked = 0;
  let notFound = 0;

  for (const shipment of orphanShipments) {
    // Search for emails containing booking number in subject
    const { data: matchingEmails } = await supabase
      .from('raw_emails')
      .select('id, subject, document_type, classification_confidence')
      .ilike('subject', `%${shipment.booking_number}%`)
      .order('received_at', { ascending: true })
      .limit(10);

    if (matchingEmails && matchingEmails.length > 0) {
      // Link all matching emails
      for (const email of matchingEmails) {
        // Check if link already exists
        const { data: existing } = await supabase
          .from('shipment_documents')
          .select('id')
          .eq('shipment_id', shipment.id)
          .eq('email_id', email.id)
          .single();

        if (!existing) {
          if (!dryRun) {
            await supabase
              .from('shipment_documents')
              .insert({
                shipment_id: shipment.id,
                email_id: email.id,
                document_type: email.document_type || 'unknown',
                link_method: 'booking_number_search',
                link_confidence_score: email.classification_confidence || 80,
              });
          }
          linked++;
        }
      }

      if (linked <= 10 || matchingEmails.length > 0) {
        console.log(shipment.booking_number + ': Found ' + matchingEmails.length + ' emails');
      }
    } else {
      notFound++;
      if (notFound <= 5) {
        console.log(shipment.booking_number + ': No emails found');
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('Emails linked:', linked);
  console.log('Shipments with no matching emails:', notFound);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply');
  }
}

main().catch(console.error);
