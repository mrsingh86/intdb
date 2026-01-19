/**
 * Precise Action Backfill Job
 *
 * Applies PreciseActionService recommendations to existing chronicles.
 * Uses the REAL service code - same logic as live email processing.
 *
 * Features:
 * - Batch processing with configurable size
 * - Checkpointing (can resume from where it left off)
 * - Uses actual PreciseActionService (not SQL recreation)
 * - Respects template priority over fallback
 * - Detailed progress reporting
 *
 * Usage:
 * - GET /api/cron/precise-action-backfill?batch_size=500&dry_run=true
 * - GET /api/cron/precise-action-backfill?batch_size=500
 * - GET /api/cron/precise-action-backfill?reset=true  (clear checkpoint, start fresh)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPreciseActionService, PreciseActionRecommendation } from '@/lib/chronicle';

// Configuration
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 2000;
const CHECKPOINT_KEY = 'precise_action_backfill';

interface BackfillResult {
  success: boolean;
  batchNumber: number;
  processed: number;
  templateMatches: number;
  fallbackApplied: number;
  skipped: number;
  errors: number;
  nextStartFrom: string | null;
  hasMore: boolean;
  durationMs: number;
  summary?: BackfillSummary;
}

interface BackfillSummary {
  totalProcessed: number;
  byActionType: Record<string, number>;
  byOwner: Record<string, number>;
  byPriority: Record<string, number>;
  withDeadlines: number;
  withAutoResolve: number;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const searchParams = request.nextUrl.searchParams;
    const batchSize = Math.min(
      parseInt(searchParams.get('batch_size') || String(DEFAULT_BATCH_SIZE)),
      MAX_BATCH_SIZE
    );
    const dryRun = searchParams.get('dry_run') === 'true';
    const reset = searchParams.get('reset') === 'true';
    const startFrom = searchParams.get('start_from');

    // Auth check for cron
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Initialize the REAL PreciseActionService
    const preciseActionService = createPreciseActionService(supabase);

    // Handle reset
    if (reset) {
      await clearCheckpoint(supabase);
      return NextResponse.json({
        success: true,
        message: 'Checkpoint cleared. Next run will start from beginning.',
      });
    }

    // Get checkpoint
    const checkpoint = await getCheckpoint(supabase);
    const batchNumber = checkpoint ? checkpoint.batch_number + 1 : 1;
    const effectiveStartFrom = startFrom || checkpoint?.last_chronicle_id;

    console.log(`\n[PreciseActionBackfill] Starting batch ${batchNumber}`);
    console.log(`[PreciseActionBackfill] Batch size: ${batchSize}, Dry run: ${dryRun}`);
    if (effectiveStartFrom) {
      console.log(`[PreciseActionBackfill] Resuming from: ${effectiveStartFrom}`);
    }

    // Fetch records that need processing (no action_source yet OR need refresh)
    let query = supabase
      .from('chronicle')
      .select(`
        id,
        document_type,
        from_party,
        subject,
        body_preview,
        occurred_at,
        shipment_id,
        action_source
      `)
      .order('occurred_at', { ascending: true })
      .limit(batchSize);

    // Resume from checkpoint
    if (effectiveStartFrom) {
      const { data: startRecord } = await supabase
        .from('chronicle')
        .select('occurred_at')
        .eq('id', effectiveStartFrom)
        .single();

      if (startRecord) {
        query = query.gt('occurred_at', startRecord.occurred_at);
      }
    }

    const { data: records, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch records: ${fetchError.message}`);
    }

    if (!records || records.length === 0) {
      // Generate final summary
      const summary = await generateSummary(supabase);
      return NextResponse.json({
        success: true,
        message: 'Backfill complete! No more records to process.',
        batchNumber,
        processed: 0,
        hasMore: false,
        durationMs: Date.now() - startTime,
        summary,
      });
    }

    console.log(`[PreciseActionBackfill] Fetched ${records.length} records`);

    // Process each record using the REAL service
    let processed = 0;
    let templateMatches = 0;
    let fallbackApplied = 0;
    let skipped = 0;
    let errors = 0;
    let lastProcessedId = '';

    for (const record of records) {
      try {
        // Use the REAL PreciseActionService
        const recommendation = await preciseActionService.getRecommendation(
          record.document_type || 'unknown',
          record.from_party || 'unknown',
          record.subject || '',
          record.body_preview || '',
          new Date(record.occurred_at),
          record.shipment_id ? await getShipmentContext(supabase, record.shipment_id) : undefined
        );

        if (recommendation.source === 'template') {
          templateMatches++;
        } else {
          fallbackApplied++;
        }

        // Update the chronicle with precise action data
        if (!dryRun) {
          const { error: updateError } = await supabase
            .from('chronicle')
            .update({
              action_type: recommendation.actionType,
              action_verb: recommendation.actionVerb,
              action_description: recommendation.actionDescription,
              action_owner: recommendation.owner,
              action_priority: recommendation.priorityLabel,
              action_priority_score: recommendation.priority,
              action_deadline: recommendation.deadline?.toISOString() || null,
              action_deadline_source: recommendation.deadlineSource,
              action_auto_resolve_on: recommendation.autoResolveOn,
              action_auto_resolve_keywords: recommendation.autoResolveKeywords,
              action_confidence: recommendation.confidence,
              action_source: recommendation.source,
              has_action: recommendation.hasAction,
            })
            .eq('id', record.id);

          if (updateError) {
            console.error(`[PreciseActionBackfill] Update error for ${record.id}:`, updateError.message);
            errors++;
            continue;
          }
        }

        processed++;
        lastProcessedId = record.id;
      } catch (err) {
        console.error(`[PreciseActionBackfill] Error processing ${record.id}:`, err);
        errors++;
      }
    }

    // Save checkpoint
    if (!dryRun && lastProcessedId) {
      await saveCheckpoint(supabase, {
        batch_number: batchNumber,
        last_chronicle_id: lastProcessedId,
        processed_count: processed,
        template_matches: templateMatches,
        fallback_count: fallbackApplied,
        error_count: errors,
      });
    }

    // Check if there are more records
    const { count: remainingCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gt('occurred_at', records[records.length - 1].occurred_at);

    const hasMore = (remainingCount || 0) > 0;

    const result: BackfillResult = {
      success: true,
      batchNumber,
      processed,
      templateMatches,
      fallbackApplied,
      skipped,
      errors,
      nextStartFrom: hasMore ? lastProcessedId : null,
      hasMore,
      durationMs: Date.now() - startTime,
    };

    // If this is the last batch, include summary
    if (!hasMore) {
      result.summary = await generateSummary(supabase);
    }

    console.log(`[PreciseActionBackfill] Batch ${batchNumber} complete:`, {
      processed,
      templateMatches,
      fallbackApplied,
      errors,
      hasMore,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[PreciseActionBackfill] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// Helper: Get shipment context for deadline calculation
async function getShipmentContext(supabase: any, shipmentId: string) {
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, stage, customer_name, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, eta')
    .eq('id', shipmentId)
    .single();

  if (!shipment) return undefined;

  return {
    shipmentId: shipment.id,
    stage: shipment.stage,
    customerName: shipment.customer_name,
    bookingNumber: shipment.booking_number,
    siCutoff: shipment.si_cutoff ? new Date(shipment.si_cutoff) : null,
    vgmCutoff: shipment.vgm_cutoff ? new Date(shipment.vgm_cutoff) : null,
    cargoCutoff: shipment.cargo_cutoff ? new Date(shipment.cargo_cutoff) : null,
    eta: shipment.eta ? new Date(shipment.eta) : null,
  };
}

// Helper: Generate summary statistics
async function generateSummary(supabase: any): Promise<BackfillSummary> {
  // Count by action type
  const { data: byType } = await supabase
    .from('chronicle')
    .select('action_type')
    .not('action_type', 'is', null);

  const byActionType: Record<string, number> = {};
  for (const r of byType || []) {
    byActionType[r.action_type] = (byActionType[r.action_type] || 0) + 1;
  }

  // Count by owner
  const { data: byOwnerData } = await supabase
    .from('chronicle')
    .select('action_owner')
    .not('action_owner', 'is', null);

  const byOwner: Record<string, number> = {};
  for (const r of byOwnerData || []) {
    byOwner[r.action_owner] = (byOwner[r.action_owner] || 0) + 1;
  }

  // Count by priority
  const { data: byPriorityData } = await supabase
    .from('chronicle')
    .select('action_priority')
    .not('action_priority', 'is', null);

  const byPriority: Record<string, number> = {};
  for (const r of byPriorityData || []) {
    byPriority[r.action_priority] = (byPriority[r.action_priority] || 0) + 1;
  }

  // Count with deadlines
  const { count: withDeadlines } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .not('action_deadline', 'is', null);

  // Count with auto-resolve
  const { count: withAutoResolve } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .not('action_auto_resolve_on', 'eq', '{}');

  const { count: totalProcessed } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact', head: true })
    .not('action_source', 'is', null);

  return {
    totalProcessed: totalProcessed || 0,
    byActionType,
    byOwner,
    byPriority,
    withDeadlines: withDeadlines || 0,
    withAutoResolve: withAutoResolve || 0,
  };
}

// Checkpoint functions
async function getCheckpoint(supabase: any): Promise<any | null> {
  try {
    const { data } = await supabase
      .from('chronicle_backfill_checkpoints')
      .select('*')
      .eq('checkpoint_key', CHECKPOINT_KEY)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return data;
  } catch {
    return null;
  }
}

async function saveCheckpoint(
  supabase: any,
  checkpoint: {
    batch_number: number;
    last_chronicle_id: string;
    processed_count: number;
    template_matches: number;
    fallback_count: number;
    error_count: number;
  }
): Promise<void> {
  try {
    await supabase.from('chronicle_backfill_checkpoints').insert({
      checkpoint_key: CHECKPOINT_KEY,
      ...checkpoint,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[PreciseActionBackfill] Failed to save checkpoint:', error);
  }
}

async function clearCheckpoint(supabase: any): Promise<void> {
  try {
    await supabase
      .from('chronicle_backfill_checkpoints')
      .delete()
      .eq('checkpoint_key', CHECKPOINT_KEY);
  } catch (error) {
    console.error('[PreciseActionBackfill] Failed to clear checkpoint:', error);
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
