/**
 * Insight Drafts API
 *
 * POST: Generate an email draft from an insight action
 * GET: Get pending drafts for a shipment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { InsightActionExecutor } from '@/lib/services/insight-action-executor';
import { InsightAction } from '@/types/insight';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================================
// POST: Generate Draft
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { insightId, shipmentId, action, title, description, overrideRecipient } = body;

    if (!insightId || !shipmentId || !action) {
      return NextResponse.json(
        { error: 'insightId, shipmentId, and action are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const executor = new InsightActionExecutor(supabase);

    const draft = await executor.generateDraft({
      insightId,
      shipmentId,
      action: action as InsightAction,
      insightTitle: title || 'Action Required',
      insightDescription: description || '',
      overrideRecipient,
    });

    return NextResponse.json({
      success: true,
      draft,
    });
  } catch (error) {
    console.error('[API:POST /insights/drafts] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET: Get Pending Drafts
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const shipmentId = searchParams.get('shipmentId');

    if (!shipmentId) {
      return NextResponse.json(
        { error: 'shipmentId required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const executor = new InsightActionExecutor(supabase);
    const drafts = await executor.getPendingDrafts(shipmentId);

    return NextResponse.json({
      drafts,
      count: drafts.length,
    });
  } catch (error) {
    console.error('[API:GET /insights/drafts] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
