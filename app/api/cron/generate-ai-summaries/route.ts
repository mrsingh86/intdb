/**
 * Cron Job: Generate AI Summaries (Haiku-powered)
 *
 * Generates intelligent shipment summaries using Claude Haiku:
 * 1. Find shipments with recent activity needing summary updates
 * 2. Analyze chronicle data with AI
 * 3. Store actionable summaries in shipment_ai_summaries table
 *
 * Schedule: Every 6 hours (or on-demand via API call)
 * Cost: ~$0.0006 per shipment = ~$0.06/day for 100 shipments
 *
 * Principles:
 * - Cron job < 50 lines (orchestrates deep services)
 * - Idempotent (upsert pattern)
 * - Fail Gracefully (continue on individual failures)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { HaikuSummaryService } from '@/lib/chronicle-v2';

// Configuration
const MAX_SHIPMENTS_PER_RUN = 100;
const PRIORITY_HIGH_ATTENTION = true; // Process high-attention shipments first

export async function GET(request: Request) {
  // Auth check
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
    const summaryService = new HaikuSummaryService(supabase);

    // Step 1: Get shipments needing summaries
    console.log('[AI-Summary Cron] Finding shipments needing summaries...');
    const shipmentIds = await summaryService.getShipmentsNeedingSummary(MAX_SHIPMENTS_PER_RUN);

    if (shipmentIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No shipments need summary updates',
        processed: 0,
        failed: 0,
        totalCost: 0,
        durationMs: Date.now() - startTime,
      });
    }

    console.log(`[AI-Summary Cron] Processing ${shipmentIds.length} shipments...`);

    // Step 2: Process shipments
    const result = await summaryService.processShipments(shipmentIds, (processed, total) => {
      if (processed % 10 === 0) {
        console.log(`[AI-Summary Cron] Progress: ${processed}/${total}`);
      }
    });

    const durationMs = Date.now() - startTime;

    console.log(
      `[AI-Summary Cron] Complete: ${result.processed} processed, ${result.failed} failed, $${result.totalCost.toFixed(4)} cost, ${durationMs}ms`
    );

    return NextResponse.json({
      success: true,
      processed: result.processed,
      failed: result.failed,
      totalCost: result.totalCost,
      durationMs,
    });
  } catch (error) {
    console.error('[AI-Summary Cron] Critical error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate summaries',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
