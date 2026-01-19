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
    .select('id, booking_number, created_from_email_id');

  // Get all existing document links
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id');

  // Find shipments with no linked documents
  const shipmentWithDocs = new Set((allDocs || []).map(d => d.shipment_id));
  const orphanShipments = (allShipments || []).filter(s =>
    !shipmentWithDocs.has(s.id) && s.created_from_email_id
  );

  console.log('ORPHAN SHIPMENTS (no linked documents):', orphanShipments.length);
  console.log(dryRun ? '(DRY RUN)\n' : '\n');

  if (orphanShipments.length === 0) {
    console.log('No orphan shipments found!');
    return;
  }

  // Get email details for these shipments
  const emailIds = orphanShipments.map(s => s.created_from_email_id);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, document_type, classification_confidence')
    .in('id', emailIds);

  const emailMap = new Map((emails || []).map(e => [e.id, e]));

  let fixed = 0;
  for (const shipment of orphanShipments) {
    const email = emailMap.get(shipment.created_from_email_id);
    if (!email) continue;

    const docType = email.document_type || 'booking_confirmation';

    if (!dryRun) {
      const { error } = await supabase
        .from('shipment_documents')
        .insert({
          shipment_id: shipment.id,
          email_id: shipment.created_from_email_id,
          document_type: docType,
          link_method: 'created_from_email',
          link_confidence_score: 100,
        });

      if (!error) {
        fixed++;
        if (fixed <= 5) {
          console.log('Linked:', shipment.booking_number, '←', docType);
        }
      }
    } else {
      fixed++;
      if (fixed <= 5) {
        console.log('Would link:', shipment.booking_number, '←', docType);
      }
    }
  }

  console.log('\nTotal fixed:', fixed);
  if (dryRun) {
    console.log('\nRun without --dry-run to apply fixes');
  }
}

main().catch(console.error);
