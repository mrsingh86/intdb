/**
 * Cron Job: Generate Insights
 *
 * Proactively generates insights for active shipments.
 * Runs every 4 hours to discover patterns before users ask.
 *
 * Strategy:
 * 1. Get all active shipments with tasks
 * 2. Run quick (rules-only) insights for bulk
 * 3. If critical patterns found, run full AI analysis
 * 4. Update task priorities if boost > 10
 *
 * Principles:
 * - Cron job < 50 lines (orchestrates deep services)
 * - Idempotent (safe to run multiple times)
 * - Cost Conscious (AI only when valuable)
 * - Fail Gracefully (continue on individual failures)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createInsightEngine } from '@/lib/services/insight-engine';

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_SHIPMENTS_PER_RUN = 50;
const AI_TRIGGER_THRESHOLD = 1; // Run AI if >= 1 critical pattern detected
const PRIORITY_UPDATE_THRESHOLD = 10; // Update priority if boost >= 10

// ============================================================================
// CRON HANDLER
// ============================================================================

export async function GET(request: Request) {
  // Verify cron secret (optional - for Vercel cron jobs)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const stats = {
    shipments_processed: 0,
    insights_generated: 0,
    ai_runs: 0,
    priorities_updated: 0,
    errors: 0,
  };

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const engine = createInsightEngine(supabase, anthropicApiKey);

    // Get active shipments (those with active status, near deadlines)
    const activeShipments = await getActiveShipments(supabase);

    console.log(`[Cron:Insights] Processing ${activeShipments.length} shipments`);

    for (const shipment of activeShipments) {
      try {
        // Stage 1: Run quick (rules-only) insights
        const quickResult = await engine.generateQuickInsights(shipment.id);
        stats.insights_generated += quickResult.insights.length;

        // Stage 2: If critical patterns found, run full AI analysis
        const hasCritical = quickResult.insights.filter(
          (i) => i.severity === 'critical'
        ).length >= AI_TRIGGER_THRESHOLD;

        if (hasCritical && anthropicApiKey) {
          const fullResult = await engine.generateInsights(shipment.id, {
            forceRefresh: true, // Refresh with AI insights
          });
          stats.ai_runs++;
          stats.insights_generated += fullResult.generation_stats.ai_insights;
        }

        // Stage 3: Update task priority if significant boost
        if (quickResult.priority_boost >= PRIORITY_UPDATE_THRESHOLD && shipment.task_id) {
          await updateTaskPriority(supabase, shipment.task_id, quickResult.priority_boost);
          stats.priorities_updated++;
        }

        stats.shipments_processed++;
      } catch (error) {
        console.error(`[Cron:Insights] Error for shipment ${shipment.id}:`, error);
        stats.errors++;
        // Continue with next shipment
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Cron:Insights] Completed in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      stats,
    });
  } catch (error) {
    console.error('[Cron:Insights] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats,
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface ActiveShipment {
  id: string;
  booking_number: string | null;
  task_id: string | null;
}

async function getActiveShipments(supabase: any): Promise<ActiveShipment[]> {
  // Get shipments that are active (not yet delivered)
  // Status values: draft, booked, in_transit, arrived, delivered
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      action_tasks!inner(id)
    `)
    .in('status', ['booked', 'in_transit', 'arrived'])
    .order('etd', { ascending: true, nullsFirst: false })
    .limit(MAX_SHIPMENTS_PER_RUN);

  if (error) {
    console.error('[Cron:Insights] Error fetching shipments:', error);
    throw error;
  }

  return (shipments || []).map((s: any) => ({
    id: s.id,
    booking_number: s.booking_number,
    task_id: s.action_tasks?.[0]?.id || null,
  }));
}

async function updateTaskPriority(
  supabase: any,
  taskId: string,
  boost: number
): Promise<void> {
  // Get current priority and add boost
  const { data: task, error: fetchError } = await supabase
    .from('action_tasks')
    .select('priority_score')
    .eq('id', taskId)
    .single();

  if (fetchError || !task) {
    console.warn(`[Cron:Insights] Could not fetch task ${taskId}`);
    return;
  }

  const newScore = Math.min((task.priority_score || 0) + boost, 100);

  const { error: updateError } = await supabase
    .from('action_tasks')
    .update({
      priority_score: newScore,
      insight_boost: boost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (updateError) {
    console.warn(`[Cron:Insights] Could not update task ${taskId}:`, updateError);
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
