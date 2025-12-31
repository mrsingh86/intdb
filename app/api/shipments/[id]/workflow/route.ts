import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { WorkflowStateService } from '@/lib/services/workflow-state-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/workflow
 *
 * Get workflow status for a shipment.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const workflowService = new WorkflowStateService(supabase);

    const status = await workflowService.getShipmentWorkflowStatus(id);
    const history = await workflowService.getWorkflowHistory(id);

    return NextResponse.json({
      status,
      history,
    });
  } catch (error: unknown) {
    console.error('[API:GET /shipments/[id]/workflow] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workflow status' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/shipments/[id]/workflow
 *
 * Transition shipment to a new workflow state.
 * Requires authentication.
 *
 * Body:
 * - to_state: string (required)
 * - triggered_by_email_id?: string
 * - triggered_by_document_type?: string
 * - notes?: string
 */
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const workflowService = new WorkflowStateService(supabase);

    const body = await request.json();
    const { to_state, triggered_by_email_id, triggered_by_document_type, notes } = body;

    if (!to_state) {
      return NextResponse.json(
        { error: 'to_state is required' },
        { status: 400 }
      );
    }

    const result = await workflowService.transitionTo(id, to_state, {
      triggered_by_email_id,
      triggered_by_document_type,
      notes,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, from_state: result.from_state, to_state: result.to_state },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[API:POST /shipments/[id]/workflow] Error:', error);
    return NextResponse.json(
      { error: 'Failed to transition workflow state' },
      { status: 500 }
    );
  }
});
