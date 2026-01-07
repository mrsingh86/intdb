import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function runComprehensiveBackfill() {
  console.log('='.repeat(60));
  console.log('COMPREHENSIVE LINKING BACKFILL');
  console.log('='.repeat(60));

  // Get all shipments with their identifiers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number');

  const shipmentCount = shipments ? shipments.length : 0;
  console.log(`Found ${shipmentCount} shipments`);

  let linked = 0;
  let skipped = 0;

  for (const shipment of shipments || []) {
    // Find emails with matching booking number
    if (shipment.booking_number) {
      const { data: matchingEmails } = await supabase
        .from('entity_extractions')
        .select('email_id')
        .eq('entity_type', 'booking_number')
        .eq('entity_value', shipment.booking_number);

      for (const match of matchingEmails || []) {
        // Check if already linked
        const { data: existing } = await supabase
          .from('shipment_documents')
          .select('id')
          .eq('email_id', match.email_id)
          .eq('shipment_id', shipment.id)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        // Get document type
        const { data: classification } = await supabase
          .from('document_classifications')
          .select('document_type')
          .eq('email_id', match.email_id)
          .single();

        // Insert link
        const { error } = await supabase.from('shipment_documents').insert({
          email_id: match.email_id,
          shipment_id: shipment.id,
          document_type: classification?.document_type || 'unknown',
          link_method: 'ai',
          link_confidence_score: 95,
        });

        if (!error) {
          linked++;
          if (linked % 10 === 0) console.log(`Linked ${linked} emails...`);
        }
      }
    }

    // Find emails with matching BL number
    if (shipment.bl_number) {
      const { data: matchingEmails } = await supabase
        .from('entity_extractions')
        .select('email_id')
        .eq('entity_type', 'bl_number')
        .eq('entity_value', shipment.bl_number);

      for (const match of matchingEmails || []) {
        const { data: existing } = await supabase
          .from('shipment_documents')
          .select('id')
          .eq('email_id', match.email_id)
          .eq('shipment_id', shipment.id)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        const { data: classification } = await supabase
          .from('document_classifications')
          .select('document_type')
          .eq('email_id', match.email_id)
          .single();

        const { error } = await supabase.from('shipment_documents').insert({
          email_id: match.email_id,
          shipment_id: shipment.id,
          document_type: classification?.document_type || 'unknown',
          link_method: 'ai',
          link_confidence_score: 90,
        });

        if (!error) {
          linked++;
          if (linked % 10 === 0) console.log(`Linked ${linked} emails...`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ New links created: ${linked}`);
  console.log(`⏭️  Already linked: ${skipped}`);
}

runComprehensiveBackfill().catch(console.error);
