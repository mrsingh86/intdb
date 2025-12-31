/**
 * Insights API
 *
 * GET: Fetch insights for a shipment or task
 * POST: Generate new insights for a shipment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { InsightRepository } from '@/lib/repositories/insight-repository';
import { createInsightEngine } from '@/lib/services/insight-engine';

// ============================================================================
// GET: Fetch Insights
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const shipmentId = searchParams.get('shipmentId');
    const taskId = searchParams.get('taskId');
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    if (!shipmentId && !taskId) {
      return NextResponse.json(
        { error: 'shipmentId or taskId required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const repository = new InsightRepository(supabase);

    let insights: Awaited<ReturnType<typeof repository.findByShipmentId>> = [];
    if (shipmentId) {
      insights = await repository.findByShipmentId(shipmentId, activeOnly);
    } else if (taskId) {
      insights = await repository.findByTaskId(taskId, activeOnly);
    }

    // Calculate summary
    const summary = {
      total: insights?.length || 0,
      bySeverity: {
        critical: insights?.filter(i => i.severity === 'critical').length || 0,
        high: insights?.filter(i => i.severity === 'high').length || 0,
        medium: insights?.filter(i => i.severity === 'medium').length || 0,
        low: insights?.filter(i => i.severity === 'low').length || 0,
      },
      totalBoost: insights?.reduce((sum, i) => sum + (i.priority_boost || 0), 0) || 0,
    };

    return NextResponse.json({
      insights: insights || [],
      summary,
    });
  } catch (error) {
    console.error('[API:GET /insights] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST: Generate Insights
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shipmentId, forceRefresh = false, includeAI = false } = body;

    if (!shipmentId) {
      return NextResponse.json(
        { error: 'shipmentId required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const anthropicApiKey = includeAI ? process.env.ANTHROPIC_API_KEY : undefined;
    const engine = createInsightEngine(supabase, anthropicApiKey);

    const result = await engine.generateInsights(shipmentId, {
      forceRefresh,
      skipAI: !includeAI,
    });

    return NextResponse.json({
      success: true,
      insights: result.insights,
      priorityBoost: result.priority_boost,
      boostReasons: result.priority_boost_reasons,
      stats: result.generation_stats,
    });
  } catch (error) {
    console.error('[API:POST /insights] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
