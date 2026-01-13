import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { StakeholderAnalysisService } from '@/lib/chronicle-v2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/chronicle-v2/shipments/[id]/stakeholders
 *
 * Returns stakeholder interaction summaries for a shipment.
 * Optional query params:
 * - needsFollowup: 'true' to only return stakeholders needing follow-up
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const needsFollowup = searchParams.get('needsFollowup') === 'true';

    const stakeholderService = new StakeholderAnalysisService(supabase);

    let stakeholders;
    if (needsFollowup) {
      stakeholders = await stakeholderService.getStakeholdersNeedingFollowup(id);
    } else {
      stakeholders = await stakeholderService.getStakeholderSummaries(id);
    }

    return NextResponse.json({
      stakeholders,
      count: stakeholders.length,
    });
  } catch (error) {
    console.error('[Stakeholders API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stakeholders' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chronicle-v2/shipments/[id]/stakeholders
 *
 * Computes/refreshes stakeholder summaries from chronicle data.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const stakeholderService = new StakeholderAnalysisService(supabase);
    const stakeholders = await stakeholderService.computeStakeholderSummaries(id);

    return NextResponse.json({
      stakeholders,
      count: stakeholders.length,
      message: 'Stakeholder summaries computed successfully',
    });
  } catch (error) {
    console.error('[Stakeholders API] Error computing:', error);
    return NextResponse.json(
      { error: 'Failed to compute stakeholders' },
      { status: 500 }
    );
  }
}
