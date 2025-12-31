import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/stats
 * Returns aggregated statistics for the shipments dashboard
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Get total count and status breakdown
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('id, status, workflow_state, workflow_phase, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff');

    if (error) {
      console.error('[API:GET /shipments/stats] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = new Date();
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Helper functions
    const isOverdue = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date < now;
    };

    const isApproaching = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date >= now && date <= next7Days;
    };

    // Status counts
    const statusCounts: Record<string, number> = {};
    const workflowStateCounts: Record<string, number> = {};
    const workflowPhaseCounts: Record<string, number> = {};

    let overdue = 0;
    let approaching = 0;
    let cutoffsThisWeek = 0;

    for (const s of shipments || []) {
      // Count by status
      statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;

      // Count by workflow state
      if (s.workflow_state) {
        workflowStateCounts[s.workflow_state] = (workflowStateCounts[s.workflow_state] || 0) + 1;
      }

      // Count by workflow phase
      if (s.workflow_phase) {
        workflowPhaseCounts[s.workflow_phase] = (workflowPhaseCounts[s.workflow_phase] || 0) + 1;
      }

      // Check overdue
      if (isOverdue(s.etd) || isOverdue(s.eta) || isOverdue(s.si_cutoff) ||
          isOverdue(s.vgm_cutoff) || isOverdue(s.cargo_cutoff) || isOverdue(s.gate_cutoff)) {
        overdue++;
      }

      // Check approaching
      if (isApproaching(s.etd) || isApproaching(s.eta) || isApproaching(s.si_cutoff) ||
          isApproaching(s.vgm_cutoff) || isApproaching(s.cargo_cutoff) || isApproaching(s.gate_cutoff)) {
        approaching++;
      }

      // Check cutoffs this week
      const cutoffs = [s.si_cutoff, s.vgm_cutoff, s.cargo_cutoff, s.gate_cutoff].filter(Boolean);
      if (cutoffs.some(c => isApproaching(c))) {
        cutoffsThisWeek++;
      }
    }

    return NextResponse.json({
      total: shipments?.length || 0,
      byStatus: statusCounts,
      byWorkflowState: workflowStateCounts,
      byWorkflowPhase: workflowPhaseCounts,
      overdue,
      approaching,
      cutoffsThisWeek,
    });
  } catch (error) {
    console.error('[API:GET /shipments/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
