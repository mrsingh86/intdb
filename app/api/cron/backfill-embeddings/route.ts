/**
 * Cron Job: Backfill Embeddings
 *
 * Generates vector embeddings for chronicle records that don't have them.
 * Uses Supabase's built-in gte-small model (384 dimensions).
 *
 * Schedule: Every 10 minutes via Vercel cron (or call manually)
 * Config: 100 records per run (safe batch size)
 *
 * Principles:
 * - Cron job < 50 lines (orchestrates deep service)
 * - Idempotent (only processes records without embeddings)
 * - Fail Gracefully (continue on individual failures)
 * - Cost: $0 (uses Supabase built-in AI)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createEmbeddingService } from '@/lib/chronicle';

// Configuration
const BATCH_SIZE = 100;  // Records per run (safe for Edge Function)

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const embeddingService = createEmbeddingService(supabase, {
      supabaseUrl,
      supabaseAnonKey: supabaseKey,
    });

    // Get current stats
    const unembeddedCount = await embeddingService.getUnembeddedCount();

    if (unembeddedCount === 0) {
      return NextResponse.json({
        success: true,
        duration_ms: Date.now() - startTime,
        stats: { remaining: 0, processed: 0, errors: 0, message: 'All records have embeddings' },
      });
    }

    // Backfill a batch
    const result = await embeddingService.backfillEmbeddings(BATCH_SIZE);

    console.log(`[Cron:Embeddings] Processed ${result.processed}, errors: ${result.errors}, remaining: ${unembeddedCount - result.processed}`);

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats: {
        remaining: unembeddedCount - result.processed,
        processed: result.processed,
        errors: result.errors,
        batch_size: BATCH_SIZE,
      },
    });
  } catch (error) {
    console.error('[Cron:Embeddings] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300;
