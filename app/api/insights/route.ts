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
    const severity = searchParams.get('severity');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '50');
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // If shipmentId or taskId provided, use repository
    if (shipmentId || taskId) {
      const repository = new InsightRepository(supabase);
      let insights: Awaited<ReturnType<typeof repository.findByShipmentId>> = [];

      if (shipmentId) {
        insights = await repository.findByShipmentId(shipmentId, activeOnly);
      } else if (taskId) {
        insights = await repository.findByTaskId(taskId, activeOnly);
      }

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

      return NextResponse.json({ insights: insights || [], summary });
    }

    // Dashboard view: fetch all insights with shipment details
    let query = supabase
      .from('shipment_insights')
      .select(`
        *,
        shipments (
          id,
          booking_number,
          bl_number,
          vessel_name,
          etd,
          eta,
          status,
          workflow_state,
          port_of_loading,
          port_of_discharge
        )
      `)
      .order('generated_at', { ascending: false })
      .limit(limit);

    // Apply severity filter
    if (severity) {
      const severities = severity.split(',');
      query = query.in('severity', severities);
    }

    // Apply status filter
    if (status && status !== 'all') {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }

    const { data: insights, error } = await query;

    if (error) {
      throw error;
    }

    // Get statistics for dashboard
    const { data: stats } = await supabase
      .from('shipment_insights')
      .select('severity, status')
      .eq('status', 'active');

    const statistics = {
      total: stats?.length || 0,
      bySeverity: {
        critical: stats?.filter(s => s.severity === 'critical').length || 0,
        high: stats?.filter(s => s.severity === 'high').length || 0,
        medium: stats?.filter(s => s.severity === 'medium').length || 0,
        low: stats?.filter(s => s.severity === 'low').length || 0,
      },
    };

    return NextResponse.json({
      insights: insights || [],
      statistics,
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
