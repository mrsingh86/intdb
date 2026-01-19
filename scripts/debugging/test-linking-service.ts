/**
 * Test script to process all emails through the shipment linking service
 *
 * This script:
 * 1. Fetches all emails from the database
 * 2. Processes each through the AI linking service
 * 3. Reports results: auto-linked, suggestions created, no match
 *
 * Run with: npx tsx scripts/test-linking-service.ts
 */

import { createClient } from '@supabase/supabase-js';
import { EmailRepository } from '../lib/repositories/email-repository';
import { ClassificationRepository } from '../lib/repositories/classification-repository';
import { EntityRepository } from '../lib/repositories/entity-repository';
import { ShipmentRepository } from '../lib/repositories/shipment-repository';
import { ShipmentDocumentRepository } from '../lib/repositories/shipment-document-repository';
import { ShipmentLinkCandidateRepository } from '../lib/repositories/shipment-link-candidate-repository';
import { ShipmentLinkingService } from '../lib/services/shipment-linking-service';

// Supabase connection
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing Supabase credentials');
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

interface LinkingStats {
  total: number;
  autoLinked: number;
  suggestionsCreated: number;
  noMatch: number;
  errors: number;
  alreadyLinked: number;
}

async function testLinkingService() {
  console.log('🚀 Starting Shipment Linking Service Test\n');
  console.log('='.repeat(60));

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Initialize repositories
  const emailRepo = new EmailRepository(supabase);
  const classificationRepo = new ClassificationRepository(supabase);
  const entityRepo = new EntityRepository(supabase);
  const shipmentRepo = new ShipmentRepository(supabase);
  const documentRepo = new ShipmentDocumentRepository(supabase);
  const linkCandidateRepo = new ShipmentLinkCandidateRepository(supabase);

  // Initialize linking service
  const linkingService = new ShipmentLinkingService(
    shipmentRepo,
    documentRepo,
    linkCandidateRepo,
    entityRepo
  );

  // Fetch all emails
  console.log('\n📧 Fetching all emails from database...');
  const emailResult = await emailRepo.findAll({}, { page: 1, limit: 1000 });
  const emails = emailResult.data;

  console.log(`✅ Found ${emails.length} emails\n`);
  console.log('='.repeat(60));

  const stats: LinkingStats = {
    total: emails.length,
    autoLinked: 0,
    suggestionsCreated: 0,
    noMatch: 0,
    errors: 0,
    alreadyLinked: 0,
  };

  // Process each email
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const emailNum = i + 1;

    console.log(`\n[${emailNum}/${emails.length}] Processing email: ${email.id}`);
    console.log(`  Subject: ${email.subject?.substring(0, 60) || 'No subject'}...`);

    try {
      // Check if already linked
      const existingLink = await documentRepo.findByEmailId(email.id);
      if (existingLink) {
        console.log(`  ⏭️  Already linked to shipment ${existingLink.shipment_id}`);
        stats.alreadyLinked++;
        continue;
      }

      // Get classification if exists
      const classifications = await classificationRepo.findByEmailIds([email.id]);
      const classificationId = classifications.length > 0 ? classifications[0].id : undefined;

      // Process email
      const result = await linkingService.processEmail(email.id, classificationId);

      // Categorize result
      if (result.matched && result.shipment_id) {
        console.log(`  ✅ AUTO-LINKED to shipment ${result.shipment_id}`);
        console.log(`     Confidence: ${result.confidence_score}%`);
        console.log(`     Type: ${result.link_type}`);
        console.log(`     Reasoning: ${result.reasoning}`);
        stats.autoLinked++;
      } else if (result.shipment_id && !result.matched) {
        console.log(`  🔍 SUGGESTION created for shipment ${result.shipment_id}`);
        console.log(`     Confidence: ${result.confidence_score}%`);
        console.log(`     Type: ${result.link_type}`);
        console.log(`     Reasoning: ${result.reasoning}`);
        stats.suggestionsCreated++;
      } else {
        console.log(`  ⚠️  NO MATCH`);
        console.log(`     Reasoning: ${result.reasoning}`);
        stats.noMatch++;
      }
    } catch (error: any) {
      console.log(`  ❌ ERROR: ${error.message}`);
      stats.errors++;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 LINKING SERVICE TEST RESULTS\n');
  console.log('='.repeat(60));
  console.log(`Total Emails:           ${stats.total}`);
  console.log(`Already Linked:         ${stats.alreadyLinked} (${Math.round((stats.alreadyLinked / stats.total) * 100)}%)`);
  console.log(`Auto-Linked (≥85%):     ${stats.autoLinked} (${Math.round((stats.autoLinked / stats.total) * 100)}%)`);
  console.log(`Suggestions (60-84%):   ${stats.suggestionsCreated} (${Math.round((stats.suggestionsCreated / stats.total) * 100)}%)`);
  console.log(`No Match (<60%):        ${stats.noMatch} (${Math.round((stats.noMatch / stats.total) * 100)}%)`);
  console.log(`Errors:                 ${stats.errors} (${Math.round((stats.errors / stats.total) * 100)}%)`);
  console.log('='.repeat(60));

  // Verify shipments created
  console.log('\n🚢 Verifying shipments in database...');
  const shipmentResult = await shipmentRepo.findAll({}, { page: 1, limit: 1000 });
  console.log(`✅ Total shipments: ${shipmentResult.data.length}`);

  // Verify link candidates created
  console.log('\n🔗 Verifying link candidates...');
  const candidates = await linkCandidateRepo.findPending();
  console.log(`✅ Pending link candidates: ${candidates.length}`);

  console.log('\n✅ Test complete!\n');
}

// Run the test
testLinkingService()
  .then(() => {
    console.log('✅ Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
