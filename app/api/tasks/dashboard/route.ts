import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { TaskRepository } from '@/lib/repositories/task-repository';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/tasks/dashboard
 *
 * Get task dashboard data including statistics and priority queue.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new TaskRepository(supabase);

    const dashboardData = await repository.getDashboardData();

    return NextResponse.json(dashboardData);
  } catch (error) {
    console.error('[API:GET /tasks/dashboard] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
