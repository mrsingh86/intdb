import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { StakeholderRepository } from '@/lib/repositories/stakeholder-repository';
import { StakeholderAnalyticsService } from '@/lib/services/stakeholder-analytics-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/stakeholders/dashboard
 *
 * Get stakeholder dashboard data including:
 * - Statistics by type
 * - Top customers
 * - At-risk relationships
 * - Performance overview
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new StakeholderRepository(supabase);
    const analyticsService = new StakeholderAnalyticsService(supabase);

    // Get statistics and dashboard data in parallel
    const [statistics, dashboardData] = await Promise.all([
      repository.getStatistics(),
      analyticsService.getDashboardData(),
    ]);

    return NextResponse.json({
      statistics,
      ...dashboardData,
    });
  } catch (error) {
    console.error('[API:GET /stakeholders/dashboard] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
