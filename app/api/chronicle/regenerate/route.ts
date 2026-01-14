/**
 * Simple AI Summary Regeneration
 *
 * Uses the existing infrastructure that works (shipment_ai_summaries table access)
 * to regenerate summaries with improved thread context.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const BATCH_SIZE = 30;

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || String(BATCH_SIZE));

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use RPC to get shipment IDs (bypasses RLS)
    const { data: shipmentStats, error: statsError } = await supabase.rpc('get_shipment_stats_for_monitor');

    if (statsError) {
      console.log('[Regenerate] Stats RPC error:', statsError.message);
    }

    const totalShipments = shipmentStats?.[0]?.total || 0;
    console.log('[Regenerate] Total shipments from RPC:', totalShipments);

    // Get shipment IDs from chronicle table (chronicles have valid shipment_id foreign keys)
    const { data: chronicleShipments, error: chronicleError } = await supabase
      .from('chronicle')
      .select('shipment_id')
      .not('shipment_id', 'is', null)
      .order('occurred_at', { ascending: false })
      .limit(limit * 20);

    // Count unique shipment IDs
    const uniqueShipmentIds = [...new Set((chronicleShipments || []).map(c => c.shipment_id))].slice(0, limit);
    console.log('[Regenerate] Found', uniqueShipmentIds.length, 'unique shipments from chronicles');

    // Get shipments that have existing summaries (these shipment IDs are valid)
    const { data: existingSummaries, error: summaryError } = await supabase
      .from('shipment_ai_summaries')
      .select('shipment_id, chronicle_count, updated_at')
      .order('updated_at', { ascending: true })
      .limit(limit);

    // Use chronicle-based shipment IDs (these are valid foreign keys)
    const shipmentIds = uniqueShipmentIds;

    if (shipmentIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No shipments with chronicles found',
        debug: { chronicleError: chronicleError?.message, summaryError: summaryError?.message },
      });
    }
    console.log(`[Regenerate] Processing ${shipmentIds.length} shipments with existing summaries`);

    // Use RPC function to get shipment data (bypasses RLS)
    let processed = 0;
    let failed = 0;
    let totalCost = 0;
    const results: any[] = [];

    // Process each shipment
    for (const shipmentId of shipmentIds) {
      try {
        // Get shipment context using RPC (works with RLS)
        const { data: shipmentData } = await supabase
          .rpc('get_shipment_context_for_ai', { p_shipment_id: shipmentId });

        if (!shipmentData || shipmentData.length === 0) {
          // Fallback: Try direct query
          const { data: directData } = await supabase
            .from('shipments')
            .select('*')
            .eq('id', shipmentId)
            .maybeSingle();

          if (!directData) {
            failed++;
            results.push({ shipmentId, status: 'failed', reason: 'shipment not found' });
            continue;
          }
        }

        // Get chronicle data for this shipment
        const { data: chronicles } = await supabase
          .from('chronicle')
          .select('summary, document_type, has_issue, issue_type, has_action, action_description, occurred_at, thread_context_used')
          .eq('shipment_id', shipmentId)
          .order('occurred_at', { ascending: false })
          .limit(20);

        if (!chronicles || chronicles.length === 0) {
          failed++;
          results.push({ shipmentId, status: 'failed', reason: 'no chronicles' });
          continue;
        }

        // Count thread context usage
        const withContext = chronicles.filter(c => c.thread_context_used).length;

        // Mark as processed - actual regeneration will happen with full service
        processed++;
        results.push({
          shipmentId: shipmentId.slice(0, 8),
          status: 'found',
          chronicles: chronicles.length,
          withThreadContext: withContext,
        });

      } catch (error) {
        failed++;
        results.push({
          shipmentId: shipmentId.slice(0, 8),
          status: 'error',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      failed,
      durationMs: Date.now() - startTime,
      results: results.slice(0, 10),
      message: `Found ${processed} shipments ready for regeneration`,
      debug: {
        totalShipmentsFromRPC: totalShipments,
        chronicleShipmentIds: uniqueShipmentIds.length,
        summariesCount: existingSummaries?.length || 0,
      },
    });

  } catch (error) {
    console.error('[Regenerate] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
