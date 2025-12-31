#!/usr/bin/env npx tsx
/**
 * Backfill Email-to-Shipment Links
 *
 * Links unlinked emails to existing shipments based on extracted entities.
 * DOES NOT create new shipments - only links to existing ones.
 *
 * Uses pagination to handle large datasets properly.
 */

import { createClient } from '@supabase/supabase-js';
import { ShipmentLinkingService } from '../lib/services/shipment-linking-service';
import { ShipmentRepository } from '../lib/repositories/shipment-repository';
import { ShipmentDocumentRepository } from '../lib/repositories/shipment-document-repository';
import { ShipmentLinkCandidateRepository } from '../lib/repositories/shipment-link-candidate-repository';
import { EntityRepository } from '../lib/repositories/entity-repository';
import { ClassificationRepository } from '../lib/repositories/classification-repository';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function backfillLinks() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              BACKFILL EMAIL-TO-SHIPMENT LINKS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Initialize repositories
  const shipmentRepo = new ShipmentRepository(supabase);
  const documentRepo = new ShipmentDocumentRepository(supabase);
  const linkCandidateRepo = new ShipmentLinkCandidateRepository(supabase);
  const entityRepo = new EntityRepository(supabase);
  const classificationRepo = new ClassificationRepository(supabase);

  // Initialize linking service
  const linkingService = new ShipmentLinkingService(
    shipmentRepo,
    documentRepo,
    linkCandidateRepo,
    entityRepo,
    classificationRepo
  );

  // Get current status
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const { count: totalShipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });
  const { count: currentLinks } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });

  console.log('BEFORE:');
  console.log('─'.repeat(60));
  console.log(`  Total emails:     ${totalEmails}`);
  console.log(`  Total shipments:  ${totalShipments} (only direct carrier confirmed)`);
  console.log(`  Current links:    ${currentLinks}`);
  console.log('');

  console.log('Starting backfill...');
  console.log('');

  // Run the backfill
  const result = await linkingService.processUnlinkedEmails({
    batchSize: 50,
    maxEmails: 5000,
  });

  console.log('');
  console.log('RESULTS:');
  console.log('─'.repeat(60));
  console.log(`  Emails processed: ${result.processed}`);
  console.log(`  Emails linked:    ${result.linked}`);
  console.log(`  Candidates:       ${result.candidates_created} (pending review)`);
  console.log(`  Errors:           ${result.errors}`);
  console.log('');

  // Get new status
  const { count: newLinks } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });

  // Get unique linked emails with pagination
  let linkedEmailIds = new Set<string>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    data.forEach(d => linkedEmailIds.add(d.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log('AFTER:');
  console.log('─'.repeat(60));
  console.log(`  Total links:      ${newLinks} (+${(newLinks || 0) - (currentLinks || 0)})`);
  console.log(`  Unique linked:    ${linkedEmailIds.size} / ${totalEmails} (${Math.round(linkedEmailIds.size / (totalEmails || 1) * 100)}%)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

backfillLinks().catch(console.error);
