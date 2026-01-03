import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ShipmentLinkCandidateRepository } from '@/lib/repositories/shipment-link-candidate-repository';
import { ShipmentDocumentRepository } from '@/lib/repositories/shipment-document-repository';
import { ShipmentRepository } from '@/lib/repositories/shipment-repository';
import { ClassificationRepository } from '@/lib/repositories/classification-repository';
import { WorkflowStateService } from '@/lib/services/workflow-state-service';
import { withAuth } from '@/lib/auth/server-auth';
import { ShipmentStatus } from '@/types/shipment';
import { DocumentType } from '@/types/email-intelligence';

/**
 * GET /api/shipments/link-candidates
 *
 * Get all pending link candidates for review.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const candidateRepo = new ShipmentLinkCandidateRepository(supabase);

    // Use new method that includes email data for deduplication
    const candidates = await candidateRepo.findPendingWithEmailData();

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error('[API:GET /link-candidates] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * Determine shipment status from document type and dates
 * IMPORTANT: Requires ETA to have passed before marking as "arrived"
 * This prevents misclassified documents from incorrectly updating status
 */
function determineStatusFromDocument(
  documentType: string,
  etd?: string | null,
  eta?: string | null,
  currentStatus?: string
): ShipmentStatus {
  const now = new Date();
  const etdDate = etd ? new Date(etd) : null;
  const etaDate = eta ? new Date(eta) : null;

  // Helper: Check if vessel has likely arrived (ETA passed)
  const hasEtaPassed = etaDate ? etaDate < now : false;

  // Document-based status
  switch (documentType) {
    case 'proof_of_delivery':
    case 'pod_confirmation':
      // POD is definitive proof - trust regardless of dates
      return 'delivered';
    case 'delivery_order':
    case 'arrival_notice':
    case 'container_release':
      // Only mark arrived if ETA has passed or no ETA set
      // Prevents misclassified documents from incorrectly marking arrived
      if (hasEtaPassed) return 'arrived';
      if (!etaDate) return 'arrived'; // No ETA to validate against
      return 'in_transit'; // ETA in future, stay in_transit
    case 'bill_of_lading':
    case 'cargo_manifest':
      if (etdDate && etdDate < now) return 'in_transit';
      return 'booked';
    case 'booking_confirmation':
    case 'booking_amendment':
    case 'shipping_instruction':
      return 'booked';
  }

  // Date-based fallback
  if (etaDate && etaDate < now) return 'arrived';
  if (etdDate && etdDate < now) return 'in_transit';

  return (currentStatus as ShipmentStatus) || 'draft';
}

/**
 * POST /api/shipments/link-candidates
 *
 * Confirm or reject a link candidate.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const candidateRepo = new ShipmentLinkCandidateRepository(supabase);
    const documentRepo = new ShipmentDocumentRepository(supabase);
    const shipmentRepo = new ShipmentRepository(supabase);
    const classificationRepo = new ClassificationRepository(supabase);

    const body = await request.json();
    const { candidate_id, user_id, action, reason } = body;

    if (action === 'reject') {
      // Reject the link candidate
      const result = await candidateRepo.reject(candidate_id, reason);
      return NextResponse.json({ success: true, result });
    }

    // Confirm the link candidate
    // 1. Get candidate details
    const { data: candidate } = await supabase
      .from('shipment_link_candidates')
      .select('*')
      .eq('id', candidate_id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    // 2. Get document type from classification
    let documentType: DocumentType = 'booking_confirmation';
    const classification = await classificationRepo.findByEmailId(candidate.email_id);
    if (classification?.document_type) {
      documentType = classification.document_type as DocumentType;
    }

    // 3. Create shipment_document record
    await documentRepo.create({
      shipment_id: candidate.shipment_id,
      email_id: candidate.email_id,
      document_type: documentType,
      link_confidence_score: candidate.confidence_score,
      link_method: 'manual',
    });

    // 4. Update shipment status based on document type
    const shipment = await shipmentRepo.findById(candidate.shipment_id);
    const newStatus = determineStatusFromDocument(
      documentType,
      shipment.etd,
      shipment.eta,
      shipment.status
    );

    const statusPriority: Record<string, number> = {
      draft: 0, booked: 1, in_transit: 2, arrived: 3, delivered: 4, cancelled: -1
    };

    if (statusPriority[newStatus] > statusPriority[shipment.status || 'draft']) {
      await shipmentRepo.update(candidate.shipment_id, { status: newStatus });
      console.log(`[LinkConfirm] Updated shipment ${candidate.shipment_id} status: ${shipment.status} -> ${newStatus}`);
    }

    // 5. Auto-transition workflow state based on document type
    const workflowService = new WorkflowStateService(supabase);
    try {
      const workflowResult = await workflowService.autoTransitionFromDocument(
        candidate.shipment_id,
        documentType,
        candidate.email_id
      );
      if (workflowResult?.success) {
        console.log(`[LinkConfirm] Workflow: ${workflowResult.from_state || 'none'} -> ${workflowResult.to_state}`);
      }
    } catch (err) {
      console.warn(`[LinkConfirm] Workflow transition failed:`, err);
    }

    // 6. Mark candidate as confirmed
    const result = await candidateRepo.confirm(candidate_id, user_id);

    return NextResponse.json({
      success: true,
      result,
      document_created: true,
      status_updated: statusPriority[newStatus] > statusPriority[shipment.status || 'draft'],
      new_status: newStatus,
    });
  } catch (error) {
    console.error('[API:POST /link-candidates] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
