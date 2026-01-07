import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
  ShipmentRepository,
  ShipmentLinkCandidateRepository,
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
 * POST /api/shipments/resync
 *
 * Resync shipment fields from extracted entities.
 * Use when shipments have missing data that exists in entity extractions.
 * Also recalculates status based on document types and dates.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Initialize repositories (split architecture)
    const shipmentRepo = new ShipmentRepository(supabase);
    const linkCandidateRepo = new ShipmentLinkCandidateRepository(supabase);
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

    const body = await request.json().catch(() => ({}));
    const { shipment_id } = body;

    // Resync single shipment
    if (shipment_id) {
      const result = await linkingService.resyncShipmentFromLinkedEmails(shipment_id);
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    // Resync ALL shipments
    const result = await linkingService.resyncAllShipments();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API:POST /shipments/resync] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
