import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { MilestoneTrackingService } from '@/lib/services/milestone-tracking-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/milestones
 *
 * Get milestone progress and alerts for a shipment.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const milestoneService = new MilestoneTrackingService(supabase);

    const progress = await milestoneService.getMilestoneProgress(id);

    return NextResponse.json(progress);
  } catch (error: unknown) {
    console.error('[API:GET /shipments/[id]/milestones] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch milestone progress' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/shipments/[id]/milestones
 *
 * Record a milestone achievement.
 * Requires authentication.
 *
 * Body:
 * - milestone_code: string (required)
 * - achieved_date?: string (ISO date)
 * - triggered_by_email_id?: string
 * - metadata?: object
 * - notes?: string
 */
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const milestoneService = new MilestoneTrackingService(supabase);

    const body = await request.json();
    const { milestone_code, achieved_date, triggered_by_email_id, metadata, notes } = body;

    if (!milestone_code) {
      return NextResponse.json(
        { error: 'milestone_code is required' },
        { status: 400 }
      );
    }

    const milestone = await milestoneService.recordMilestone(id, milestone_code, {
      achieved_date,
      triggered_by_email_id,
      metadata,
      notes,
    });

    return NextResponse.json(milestone);
  } catch (error: unknown) {
    console.error('[API:POST /shipments/[id]/milestones] Error:', error);
    return NextResponse.json(
      { error: 'Failed to record milestone' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/shipments/[id]/milestones
 *
 * Skip a milestone.
 * Requires authentication.
 *
 * Body:
 * - milestone_code: string (required)
 * - reason: string (required)
 */
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const milestoneService = new MilestoneTrackingService(supabase);

    const body = await request.json();
    const { milestone_code, reason } = body;

    if (!milestone_code || !reason) {
      return NextResponse.json(
        { error: 'milestone_code and reason are required' },
        { status: 400 }
      );
    }

    await milestoneService.skipMilestone(id, milestone_code, reason);

    // Return updated progress
    const progress = await milestoneService.getMilestoneProgress(id);

    return NextResponse.json({
      success: true,
      ...progress,
    });
  } catch (error: unknown) {
    console.error('[API:PATCH /shipments/[id]/milestones] Error:', error);
    return NextResponse.json(
      { error: 'Failed to skip milestone' },
      { status: 500 }
    );
  }
});
