/**
 * Chronicle Reanalysis Cron Job
 *
 * Reprocesses historical chronicles with thread context.
 * Run this after enabling thread context to upgrade existing data.
 *
 * Usage:
 *   curl -X POST http://localhost:3000/api/cron/reanalyze-chronicles
 *   curl -X POST http://localhost:3000/api/cron/reanalyze-chronicles?batchSize=100
 *
 * Estimated: ~$50-80 API cost for 14,872 emails at ~50/batch
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createReanalysisService } from '@/lib/chronicle';

// ============================================================================
// CONFIG
// ============================================================================

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // Parse batch size from query params
    const { searchParams } = new URL(request.url);
    const batchSize = Math.min(
      parseInt(searchParams.get('batchSize') || String(DEFAULT_BATCH_SIZE)),
      MAX_BATCH_SIZE
    );

    // Initialize services
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const reanalysisService = createReanalysisService(supabase);

    // Get counts before processing
    const remainingBefore = await reanalysisService.getRemainingCount();
    console.log(`[Reanalysis] Starting batch of ${batchSize}. Remaining: ${remainingBefore}`);

    if (remainingBefore === 0) {
      return NextResponse.json({
        success: true,
        message: 'No chronicles need reanalysis',
        remaining: 0,
      });
    }

    // Run reanalysis batch
    const result = await reanalysisService.reanalyzeBatch(batchSize);

    // Get counts after processing
    const remainingAfter = await reanalysisService.getRemainingCount();

    // Estimate cost (rough: ~$0.003 per chronicle for Claude Haiku)
    const estimatedCost = result.succeeded * 0.003;

    console.log(`[Reanalysis] Completed: ${result.succeeded}/${result.total} succeeded`);
    console.log(`[Reanalysis] With thread context: ${result.withThreadContext}`);
    console.log(`[Reanalysis] Remaining: ${remainingAfter}`);

    return NextResponse.json({
      success: true,
      result: {
        processed: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        withThreadContext: result.withThreadContext,
        timeMs: result.timeMs,
      },
      progress: {
        before: remainingBefore,
        after: remainingAfter,
        completed: remainingBefore - remainingAfter,
        percentComplete: Math.round((1 - remainingAfter / (remainingBefore + result.succeeded)) * 100),
      },
      estimate: {
        batchCost: `$${estimatedCost.toFixed(2)}`,
        remainingCost: `$${(remainingAfter * 0.003).toFixed(2)}`,
        batchesRemaining: Math.ceil(remainingAfter / batchSize),
      },
      totalTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[Reanalysis] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        totalTimeMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// GET endpoint for status check
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const reanalysisService = createReanalysisService(supabase);

    const remaining = await reanalysisService.getRemainingCount();

    // Get stats on already reanalyzed
    const { count: reanalyzedCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('needs_reanalysis', false)
      .not('reanalyzed_at', 'is', null);

    const { count: withContextCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('thread_context_used', true);

    return NextResponse.json({
      status: remaining === 0 ? 'complete' : 'in_progress',
      remaining,
      reanalyzed: reanalyzedCount || 0,
      withThreadContext: withContextCount || 0,
      estimatedCostRemaining: `$${(remaining * 0.003).toFixed(2)}`,
      estimatedBatches: Math.ceil(remaining / DEFAULT_BATCH_SIZE),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
