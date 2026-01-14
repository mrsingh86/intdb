/**
 * Force Regenerate AI Summaries
 *
 * Regenerates AI summaries for ALL shipments, ignoring the 12-hour cache.
 * Use after reanalysis completes to benefit from improved chronicle data.
 *
 * Usage:
 *   GET /api/cron/regenerate-ai-summaries?limit=50
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { HaikuSummaryService } from '@/lib/chronicle-v2';

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get('limit') || String(DEFAULT_BATCH_SIZE)),
      MAX_BATCH_SIZE
    );
    const force = searchParams.get('force') === 'true';
    const offsetParam = parseInt(searchParams.get('offset') || '0');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const summaryService = new HaikuSummaryService(supabase);

    // Get total counts
    const { count: totalShipments } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true });

    const { count: totalSummaries } = await supabase
      .from('shipment_ai_summaries')
      .select('shipment_id', { count: 'exact', head: true });

    // Use RPC function to get shipments (bypasses RLS with SECURITY DEFINER)
    // Request more to account for offset and filtering
    const { data: shipmentData, error: rpcError } = await supabase
      .rpc('get_shipments_for_ai_summary', { limit_count: offsetParam + limit + 100 });

    if (rpcError) {
      console.log('[Regenerate] RPC error:', rpcError.message);
      return NextResponse.json({
        success: false,
        error: 'Failed to get shipments via RPC',
        details: rpcError.message,
      }, { status: 500 });
    }

    let filteredData = shipmentData || [];

    // If not force mode, filter out recently processed shipments
    if (!force) {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: recentlyUpdated } = await supabase
        .from('shipment_ai_summaries')
        .select('shipment_id')
        .gte('updated_at', thirtyMinutesAgo);

      const recentIds = new Set((recentlyUpdated || []).map(r => r.shipment_id));
      console.log(`[Regenerate] Excluding ${recentIds.size} recently regenerated shipments`);
      filteredData = filteredData.filter((s: any) => !recentIds.has(s.shipment_id));
    }

    // Apply offset for pagination in force mode
    if (offsetParam > 0) {
      filteredData = filteredData.slice(offsetParam);
    }

    const shipmentIds = filteredData.slice(0, limit).map((s: any) => s.shipment_id);
    console.log(`[Regenerate] Found ${shipmentIds.length} shipments to process${force ? ' (FORCE mode)' : ''} at offset ${offsetParam}. Top: ${filteredData.slice(0, 3).map((s: any) => `${s.shipment_id.slice(0, 8)}...(${s.chronicle_count})`).join(', ')}`);

    if (shipmentIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No shipments to process',
        processed: 0,
        failed: 0,
        totalCost: 0,
        durationMs: Date.now() - startTime,
      });
    }

    console.log(`[Regenerate] Processing ${shipmentIds.length} shipments: ${shipmentIds.slice(0, 3).join(', ')}...`);

    // Process shipments one by one with detailed error logging
    let processed = 0;
    let failed = 0;
    let totalCost = 0;
    const errors: string[] = [];

    // Create a map of shipment data from RPC for logging
    const shipmentMap = new Map<string, any>();
    for (const s of filteredData || []) {
      shipmentMap.set(s.shipment_id, s);
    }

    for (const shipmentId of shipmentIds) {
      try {
        // Shipment ID already validated by RPC function - no need to re-check
        const result = await summaryService.processShipment(shipmentId);
        if (result) {
          processed++;
          totalCost += result.cost;
        } else {
          failed++;
          const meta = shipmentMap.get(shipmentId);
          errors.push(`${shipmentId}: ProcessShipment returned null (booking: ${meta?.booking_number || 'N/A'})`);
        }
      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${shipmentId}: ${msg}`);
        console.error(`[Regenerate] Error processing ${shipmentId}:`, msg);
      }
    }

    const result = { processed, failed, totalCost };
    console.log(`[Regenerate] Errors:`, errors.slice(0, 5));

    const durationMs = Date.now() - startTime;

    console.log(
      `[Regenerate] Complete: ${result.processed} processed, ${result.failed} failed, $${result.totalCost.toFixed(4)}`
    );

    return NextResponse.json({
      success: true,
      processed: result.processed,
      failed: result.failed,
      totalCost: result.totalCost,
      durationMs,
      progress: {
        batchSize: shipmentIds.length,
        totalShipments: totalShipments || 0,
        totalSummaries: totalSummaries || 0,
      },
      errors: errors.slice(0, 5),
    });
  } catch (error) {
    console.error('[Regenerate] Critical error:', error);
    return NextResponse.json(
      {
        error: 'Failed to regenerate summaries',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
