/**
 * Single Insight API
 *
 * PATCH: Update insight status (acknowledge, resolve, dismiss)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { InsightRepository } from '@/lib/repositories/insight-repository';

interface RouteParams {
  params: Promise<{ insightId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { insightId } = await params;
    const body = await request.json();
    const { action } = body;

    if (!insightId) {
      return NextResponse.json(
        { error: 'insightId required' },
        { status: 400 }
      );
    }

    const validActions = ['acknowledge', 'resolve', 'dismiss'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const repository = new InsightRepository(supabase);

    let insight;
    if (action === 'acknowledge') {
      insight = await repository.updateStatus(insightId, 'acknowledged');
    } else if (action === 'resolve') {
      insight = await repository.updateStatus(insightId, 'resolved');
    } else if (action === 'dismiss') {
      insight = await repository.updateStatus(insightId, 'dismissed');
    }

    return NextResponse.json({
      success: true,
      insight,
    });
  } catch (error) {
    console.error('[API:PATCH /insights/:id] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
