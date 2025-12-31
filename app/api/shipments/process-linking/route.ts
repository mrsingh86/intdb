import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ShipmentRepository } from '@/lib/repositories/shipment-repository';
import { ShipmentDocumentRepository } from '@/lib/repositories/shipment-document-repository';
import { ShipmentLinkCandidateRepository } from '@/lib/repositories/shipment-link-candidate-repository';
import { EntityRepository } from '@/lib/repositories/entity-repository';
import { EmailRepository } from '@/lib/repositories/email-repository';
import { ClassificationRepository } from '@/lib/repositories/classification-repository';
import { ShipmentLinkingService } from '@/lib/services/shipment-linking-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * POST /api/shipments/process-linking
 *
 * Trigger AI linking service to process emails and link to shipments.
 * Can process single email or all unlinked emails.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Initialize repositories
    const shipmentRepo = new ShipmentRepository(supabase);
    const documentRepo = new ShipmentDocumentRepository(supabase);
    const linkCandidateRepo = new ShipmentLinkCandidateRepository(supabase);
    const entityRepo = new EntityRepository(supabase);
    const emailRepo = new EmailRepository(supabase);
    const classificationRepo = new ClassificationRepository(supabase);

    // Initialize linking service with classification repo for intelligent status
    const linkingService = new ShipmentLinkingService(
      shipmentRepo,
      documentRepo,
      linkCandidateRepo,
      entityRepo,
      classificationRepo
    );

    const body = await request.json();
    const { email_id } = body;

    // Process single email
    if (email_id) {
      const result = await linkingService.processEmail(email_id);

      return NextResponse.json({
        success: true,
        result,
      });
    }

    // Process all unlinked emails
    const result = await processAllEmails(linkingService, emailRepo, documentRepo);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API:POST /shipments/process-linking] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * Process all emails that haven't been linked yet
 */
async function processAllEmails(
  linkingService: ShipmentLinkingService,
  emailRepo: EmailRepository,
  documentRepo: ShipmentDocumentRepository
) {
  // Fetch all emails (increased limit for full backfill)
  const emailResult = await emailRepo.findAll({}, { page: 1, limit: 5000 });
  const emails = emailResult.data;

  let processed = 0;
  let linked = 0;
  let candidates_created = 0;
  const results: any[] = [];

  for (const email of emails) {
    if (!email.id) continue; // Skip emails without id

    // Check if already linked
    const existingLink = await documentRepo.findByEmailId(email.id);
    if (existingLink) {
      continue; // Skip already linked emails
    }

    // Process email
    const result = await linkingService.processEmail(email.id);
    processed++;

    if (result.matched) {
      linked++;
    } else if (result.shipment_id) {
      candidates_created++; // Link candidate created
    }

    results.push({
      email_id: email.id,
      subject: email.subject,
      result,
    });
  }

  return {
    processed,
    linked,
    candidates_created,
    results,
  };
}
