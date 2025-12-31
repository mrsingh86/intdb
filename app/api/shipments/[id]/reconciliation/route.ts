import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { SIReconciliationService } from '@/lib/services/si-reconciliation-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/reconciliation
 *
 * Get SI reconciliation status for a shipment.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const reconciliationService = new SIReconciliationService(supabase);

    const status = await reconciliationService.getReconciliationStatus(id);
    const canSubmit = await reconciliationService.canSubmitSI(id);

    return NextResponse.json({
      ...status,
      can_submit_si: canSubmit.can_submit,
      submit_block_reason: canSubmit.reason,
      pending_reconciliations: canSubmit.pending_reconciliations,
    });
  } catch (error: unknown) {
    console.error('[API:GET /shipments/[id]/reconciliation] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reconciliation status' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/shipments/[id]/reconciliation
 *
 * Run SI reconciliation.
 * Requires authentication.
 *
 * Body:
 * - si_draft_email_id: string (required)
 * - comparison_document_type: 'checklist' | 'house_bl' (required)
 * - comparison_email_id: string (required)
 */
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const reconciliationService = new SIReconciliationService(supabase);

    const body = await request.json();
    const { si_draft_email_id, comparison_document_type, comparison_email_id } = body;

    if (!si_draft_email_id || !comparison_document_type || !comparison_email_id) {
      return NextResponse.json(
        { error: 'si_draft_email_id, comparison_document_type, and comparison_email_id are required' },
        { status: 400 }
      );
    }

    if (!['checklist', 'house_bl'].includes(comparison_document_type)) {
      return NextResponse.json(
        { error: 'comparison_document_type must be either "checklist" or "house_bl"' },
        { status: 400 }
      );
    }

    const result = await reconciliationService.reconcile(
      id,
      si_draft_email_id,
      comparison_document_type,
      comparison_email_id
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[API:POST /shipments/[id]/reconciliation] Error:', error);
    return NextResponse.json(
      { error: 'Failed to run reconciliation' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/shipments/[id]/reconciliation
 *
 * Resolve discrepancies manually.
 * Requires authentication.
 *
 * Body:
 * - record_id: string (required)
 * - resolved_by: string (required)
 * - notes: string (required)
 */
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const reconciliationService = new SIReconciliationService(supabase);

    const body = await request.json();
    const { record_id, resolved_by, notes } = body;

    if (!record_id || !resolved_by || !notes) {
      return NextResponse.json(
        { error: 'record_id, resolved_by, and notes are required' },
        { status: 400 }
      );
    }

    await reconciliationService.resolveDiscrepancies(record_id, resolved_by, notes);

    // Return updated status
    const status = await reconciliationService.getReconciliationStatus(id);

    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (error: unknown) {
    console.error('[API:PATCH /shipments/[id]/reconciliation] Error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve discrepancies' },
      { status: 500 }
    );
  }
});
