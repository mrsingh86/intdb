/**
 * Parallel Chronicle Reanalysis Cron Job
 *
 * Runs multiple workers in parallel for faster reanalysis.
 * Safe: Different threads run in parallel, same-thread emails run sequentially.
 *
 * Usage:
 *   # Default: 5 workers x 20 threads each = 100 threads/batch
 *   curl -X POST http://localhost:3000/api/cron/reanalyze-chronicles-parallel
 *
 *   # Custom: 10 workers x 30 threads = 300 threads/batch
 *   curl -X POST "http://localhost:3000/api/cron/reanalyze-chronicles-parallel?workers=10&threadsPerWorker=30"
 *
 * Estimated: 5-10x faster than sequential processing
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createParallelReanalysisService } from '@/lib/chronicle/parallel-reanalysis-service';

// ============================================================================
// CONFIG
// ============================================================================

const DEFAULT_WORKERS = 5;
const DEFAULT_THREADS_PER_WORKER = 20;
const MAX_WORKERS = 15;
const MAX_THREADS_PER_WORKER = 50;

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const workers = Math.min(
      parseInt(searchParams.get('workers') || String(DEFAULT_WORKERS)),
      MAX_WORKERS
    );
    const threadsPerWorker = Math.min(
      parseInt(searchParams.get('threadsPerWorker') || String(DEFAULT_THREADS_PER_WORKER)),
      MAX_THREADS_PER_WORKER
    );

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const service = createParallelReanalysisService(supabase);

    // Get status before
    const statusBefore = await service.getStatus();
    console.log(`[ParallelReanalysis] Starting with ${workers} workers x ${threadsPerWorker} threads`);
    console.log(`[ParallelReanalysis] Remaining: ${statusBefore.remaining} emails in ${statusBefore.threadsRemaining} threads`);

    if (statusBefore.remaining === 0) {
      return NextResponse.json({
        success: true,
        message: 'No chronicles need reanalysis - all done!',
        status: statusBefore,
      });
    }

    // Run parallel reanalysis
    const result = await service.runParallel({ workers, threadsPerWorker });

    // Get status after
    const statusAfter = await service.getStatus();

    // Calculate metrics
    const emailsPerSecond = result.succeeded / (result.timeMs / 1000);
    const estimatedCost = result.succeeded * 0.003;
    const remainingCost = statusAfter.remaining * 0.003;
    const estimatedTimeRemaining = statusAfter.remaining / emailsPerSecond;

    console.log(`[ParallelReanalysis] Completed: ${result.succeeded}/${result.totalEmails} emails`);
    console.log(`[ParallelReanalysis] Speed: ${emailsPerSecond.toFixed(1)} emails/sec`);
    console.log(`[ParallelReanalysis] Remaining: ${statusAfter.remaining} emails`);

    return NextResponse.json({
      success: true,
      result: {
        threads: result.totalThreads,
        emails: result.totalEmails,
        succeeded: result.succeeded,
        failed: result.failed,
        withThreadContext: result.withThreadContext,
        timeMs: result.timeMs,
        emailsPerSecond: Math.round(emailsPerSecond * 10) / 10,
      },
      workers: result.workerStats.map(w => ({
        id: w.workerId,
        threads: w.threads,
        emails: w.emails,
        succeeded: w.succeeded,
        timeMs: w.timeMs,
      })),
      progress: {
        before: statusBefore.remaining,
        after: statusAfter.remaining,
        completed: statusBefore.remaining - statusAfter.remaining,
        totalCompleted: statusAfter.completed,
        percentComplete: Math.round((statusAfter.completed / (statusAfter.completed + statusAfter.remaining)) * 100),
      },
      estimate: {
        batchCost: `$${estimatedCost.toFixed(2)}`,
        remainingCost: `$${remainingCost.toFixed(2)}`,
        remainingTimeMinutes: Math.round(estimatedTimeRemaining / 60),
        batchesRemaining: Math.ceil(statusAfter.remaining / (workers * threadsPerWorker * 3)), // ~3 emails per thread avg
      },
    });
  } catch (error) {
    console.error('[ParallelReanalysis] Error:', error);
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

// GET endpoint for status
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const service = createParallelReanalysisService(supabase);
    const status = await service.getStatus();

    const total = status.completed + status.remaining;
    const percentComplete = total > 0 ? Math.round((status.completed / total) * 100) : 100;

    return NextResponse.json({
      status: status.remaining === 0 ? 'complete' : 'in_progress',
      remaining: status.remaining,
      completed: status.completed,
      withThreadContext: status.withContext,
      percentComplete,
      estimatedCostRemaining: `$${(status.remaining * 0.003).toFixed(2)}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
