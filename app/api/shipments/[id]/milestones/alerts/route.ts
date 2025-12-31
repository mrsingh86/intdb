import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { MilestoneTrackingService } from '@/lib/services/milestone-tracking-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/milestones/alerts
 *
 * Get active milestone alerts for a shipment.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const milestoneService = new MilestoneTrackingService(supabase);

    const alerts = await milestoneService.getActiveAlerts(id);

    return NextResponse.json({ alerts });
  } catch (error: unknown) {
    console.error('[API:GET /shipments/[id]/milestones/alerts] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch milestone alerts' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/shipments/[id]/milestones/alerts
 *
 * Check for missed milestones and create alerts.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const milestoneService = new MilestoneTrackingService(supabase);

    const createdAlerts = await milestoneService.checkMissedMilestones(id);

    return NextResponse.json({
      checked: true,
      new_alerts: createdAlerts.length,
      alerts: createdAlerts,
    });
  } catch (error: unknown) {
    console.error('[API:POST /shipments/[id]/milestones/alerts] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check milestones' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/shipments/[id]/milestones/alerts
 *
 * Acknowledge an alert.
 * Requires authentication.
 *
 * Body:
 * - alert_id: string (required)
 * - acknowledged_by: string (required)
 */
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const milestoneService = new MilestoneTrackingService(supabase);

    const body = await request.json();
    const { alert_id, acknowledged_by } = body;

    if (!alert_id || !acknowledged_by) {
      return NextResponse.json(
        { error: 'alert_id and acknowledged_by are required' },
        { status: 400 }
      );
    }

    await milestoneService.acknowledgeAlert(alert_id, acknowledged_by);

    // Return remaining alerts
    const alerts = await milestoneService.getActiveAlerts(id);

    return NextResponse.json({
      success: true,
      remaining_alerts: alerts.length,
      alerts,
    });
  } catch (error: unknown) {
    console.error('[API:PATCH /shipments/[id]/milestones/alerts] Error:', error);
    return NextResponse.json(
      { error: 'Failed to acknowledge alert' },
      { status: 500 }
    );
  }
});
