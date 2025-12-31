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

    // Get progress summary
    const progress = await milestoneService.getMilestoneProgress(id);

    // Fetch milestones and definitions separately (no FK join needed)
    const [milestonesResult, definitionsResult] = await Promise.all([
      supabase
        .from('shipment_milestones')
        .select('id, milestone_code, milestone_status, expected_date, achieved_date, metadata, notes')
        .eq('shipment_id', id),
      supabase
        .from('milestone_definitions')
        .select('milestone_code, milestone_name, milestone_phase, is_critical, milestone_order')
        .order('milestone_order', { ascending: true }),
    ]);

    const milestones = milestonesResult.data || [];
    const definitions = definitionsResult.data || [];

    // Create lookup map for definitions
    const defMap = new Map(definitions.map(d => [d.milestone_code, d]));

    // Transform to match component interface
    const formattedMilestones = milestones.map(m => {
      const def = defMap.get(m.milestone_code);
      return {
        id: m.id,
        milestone_code: m.milestone_code,
        milestone_status: m.milestone_status,
        expected_date: m.expected_date,
        actual_date: m.achieved_date,
        metadata: m.metadata,
        milestone_definition: def ? {
          milestone_name: def.milestone_name,
          milestone_phase: def.milestone_phase,
          is_critical: def.is_critical,
        } : undefined,
        _order: def?.milestone_order ?? 999,
      };
    });

    // Sort by milestone_order
    formattedMilestones.sort((a, b) => a._order - b._order);

    // Remove _order from response
    const cleanedMilestones = formattedMilestones.map(({ _order, ...rest }) => rest);

    return NextResponse.json({
      ...progress,
      milestones: cleanedMilestones,
    });
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
