/**
 * Insight Feedback API
 *
 * POST: Submit feedback for an insight
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { InsightRepository } from '@/lib/repositories/insight-repository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { insightId, feedbackType, value, notes } = body;

    if (!insightId || !feedbackType) {
      return NextResponse.json(
        { error: 'insightId and feedbackType required' },
        { status: 400 }
      );
    }

    const validTypes = ['helpful', 'not_helpful', 'false_positive', 'saved_money', 'saved_time', 'prevented_issue'];
    if (!validTypes.includes(feedbackType)) {
      return NextResponse.json(
        { error: `Invalid feedbackType. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const repository = new InsightRepository(supabase);
    await repository.createFeedback(insightId, feedbackType, value, notes);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API:POST /insights/feedback] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
