import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
  ShipmentRepository,
  ShipmentLinkCandidateRepository,
  EmailRepository,
  EmailExtractionRepository,
  AttachmentExtractionRepository,
  EmailShipmentLinkRepository,
  AttachmentShipmentLinkRepository,
  EmailClassificationRepository,
  AttachmentClassificationRepository,
} from '@/lib/repositories';
import { ShipmentLinkingService } from '@/lib/services/shipment-linking-service';
import { WorkflowStateService } from '@/lib/services/workflow-state-service';
import { EnhancedWorkflowStateService } from '@/lib/services/enhanced-workflow-state-service';
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

    // Initialize repositories (split architecture)
    const shipmentRepo = new ShipmentRepository(supabase);
    const linkCandidateRepo = new ShipmentLinkCandidateRepository(supabase);
    const emailRepo = new EmailRepository(supabase);
    const emailExtractionRepo = new EmailExtractionRepository(supabase);
    const attachmentExtractionRepo = new AttachmentExtractionRepository(supabase);
    const emailLinkRepo = new EmailShipmentLinkRepository(supabase);
    const attachmentLinkRepo = new AttachmentShipmentLinkRepository(supabase);
    const emailClassificationRepo = new EmailClassificationRepository(supabase);
    const attachmentClassificationRepo = new AttachmentClassificationRepository(supabase);

    // Initialize linking service with split repositories
    const linkingService = new ShipmentLinkingService(
      supabase,
      shipmentRepo,
      linkCandidateRepo,
      emailExtractionRepo,
      attachmentExtractionRepo,
      emailLinkRepo,
      attachmentLinkRepo,
      emailClassificationRepo,
      attachmentClassificationRepo
    );

    // Wire up enhanced workflow service for dual-trigger transitions (document type + email type)
    const enhancedWorkflowService = new EnhancedWorkflowStateService(supabase);
    linkingService.setEnhancedWorkflowService(enhancedWorkflowService);

    // Legacy workflow service as fallback (deprecated)
    const workflowService = new WorkflowStateService(supabase);
    linkingService.setWorkflowService(workflowService);

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
    const result = await processAllEmails(linkingService, emailRepo, emailLinkRepo);

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
  emailLinkRepo: EmailShipmentLinkRepository
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
    const isLinked = await emailLinkRepo.isEmailLinked(email.id);
    if (isLinked) {
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
