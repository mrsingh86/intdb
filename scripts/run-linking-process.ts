/**
 * Run the shipment linking process for unlinked emails
 *
 * This will:
 * 1. Find all emails with identifiers that aren't linked to shipments
 * 2. Try to auto-link them (confidence >= 85%)
 * 3. Create link candidates for manual review (confidence 60-84%)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { ShipmentLinkingService } from '../lib/services/shipment-linking-service';
import { ShipmentRepository } from '../lib/repositories/shipment-repository';
import { ShipmentDocumentRepository } from '../lib/repositories/shipment-document-repository';
import { ShipmentLinkCandidateRepository } from '../lib/repositories/shipment-link-candidate-repository';
import { EntityRepository } from '../lib/repositories/entity-repository';
import { ClassificationRepository } from '../lib/repositories/classification-repository';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('RUNNING SHIPMENT LINKING PROCESS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

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

  // Get initial counts
  const { count: initialLinked } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  const { count: initialCandidates } = await supabase
    .from('shipment_link_candidates')
    .select('*', { count: 'exact', head: true });

  console.log('\n1. Initial state:');
  console.log(`   Documents linked: ${initialLinked}`);
  console.log(`   Link candidates: ${initialCandidates}`);

  // Run the linking process
  console.log('\n2. Processing unlinked emails...');
  const result = await linkingService.processUnlinkedEmails({
    batchSize: 50,
    maxEmails: 1000,
  });

  console.log('\n3. Processing complete:');
  console.log(`   Processed: ${result.processed}`);
  console.log(`   Auto-linked: ${result.linked}`);
  console.log(`   Candidates created: ${result.candidates_created}`);
  console.log(`   Errors: ${result.errors}`);

  // Get final counts
  const { count: finalLinked } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  const { count: finalCandidates } = await supabase
    .from('shipment_link_candidates')
    .select('*', { count: 'exact', head: true });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`\n   Documents linked: ${initialLinked} → ${finalLinked} (+${(finalLinked || 0) - (initialLinked || 0)})`);
  console.log(`   Link candidates: ${initialCandidates} → ${finalCandidates} (+${(finalCandidates || 0) - (initialCandidates || 0)})`);
}

main().catch(console.error);
