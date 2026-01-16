/**
 * Reclassification Catchup Job
 *
 * Safe, incremental reclassification of chronicle records.
 *
 * Features:
 * - Batch processing with configurable size
 * - Checkpointing (can resume from where it left off)
 * - Detailed logging and error tracking
 * - Pattern matching first, AI fallback
 * - Respects rate limits
 *
 * Usage:
 * - GET /api/cron/reclassification-catchup?batch_size=100&dry_run=true
 * - GET /api/cron/reclassification-catchup?batch_size=100&start_from=<chronicle_id>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPatternMatcherService } from '@/lib/chronicle';
import { AiAnalyzer } from '@/lib/chronicle/ai-analyzer';
import {
  ReclassificationLogger,
  createReclassificationLogger,
  ReclassificationReport,
} from '@/lib/chronicle/reclassification-logger';

// Configuration
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const AI_RATE_LIMIT_DELAY = 100; // ms between AI calls
const CHECKPOINT_TABLE = 'reclassification_checkpoints';

interface CatchupResult {
  success: boolean;
  batchNumber: number;
  processed: number;
  changed: number;
  errors: number;
  patternMatches: number;
  aiClassifications: number;
  nextStartFrom: string | null;
  hasMore: boolean;
  durationMs: number;
  report?: ReclassificationReport;
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
    const startFrom = searchParams.get('start_from');
    const confidenceThreshold = parseInt(searchParams.get('confidence') || '85');
    const skipAi = searchParams.get('skip_ai') === 'true';

    // Auth check for cron
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow without auth in development
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Initialize services
    const patternMatcher = createPatternMatcherService(supabase);
    const aiAnalyzer = new AiAnalyzer();
    const logger = createReclassificationLogger({ logToConsole: true });

    // Get or create checkpoint
    let checkpoint = await getCheckpoint(supabase);
    const batchNumber = checkpoint ? checkpoint.batch_number + 1 : 1;
    const effectiveStartFrom = startFrom || checkpoint?.last_chronicle_id;

    console.log(`\n[Catchup] Starting batch ${batchNumber}`);
    console.log(`[Catchup] Batch size: ${batchSize}, Dry run: ${dryRun}, Skip AI: ${skipAi}`);
    if (effectiveStartFrom) {
      console.log(`[Catchup] Resuming from: ${effectiveStartFrom}`);
    }

    // Fetch records to process
    let query = supabase
      .from('chronicle')
      .select('id, gmail_message_id, subject, body_preview, from_address, attachments, document_type, occurred_at')
      .order('occurred_at', { ascending: true })
      .limit(batchSize);

    if (effectiveStartFrom) {
      // Get the occurred_at of the start point
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
      return NextResponse.json({
        success: true,
        message: 'No more records to process',
        batchNumber,
        processed: 0,
        hasMore: false,
        durationMs: Date.now() - startTime,
      });
    }

    console.log(`[Catchup] Fetched ${records.length} records`);

    // Start batch processing
    logger.startBatch(batchNumber);

    let processed = 0;
    let changed = 0;
    let patternMatches = 0;
    let aiClassifications = 0;
    let lastProcessedId = '';

    // Disable trigger for bulk update
    if (!dryRun) {
      try {
        await supabase.rpc('disable_chronicle_trigger');
      } catch {
        // Ignore if RPC doesn't exist, we'll handle individually
      }
    }

    for (const record of records) {
      try {
        // Pattern matching first - build input directly from chronicle record
        const patternInput = {
          subject: record.subject || '',
          senderEmail: record.from_address || '',
          bodyText: record.body_preview || '',
          hasAttachment: Array.isArray(record.attachments) && record.attachments.length > 0,
          threadPosition: 1,
        };

        const patternResult = await patternMatcher.match(patternInput);

        let newType: string;
        let method: 'pattern' | 'ai';
        let confidence: number;
        let patternMatched: string | undefined;

        if (patternResult.matched && patternResult.confidence >= confidenceThreshold) {
          newType = patternResult.documentType!;
          method = 'pattern';
          confidence = patternResult.confidence;
          patternMatched = patternResult.matchedPattern ?? undefined;
          patternMatches++;
        } else if (skipAi) {
          // Skip AI, keep original
          newType = record.document_type;
          method = 'pattern';
          confidence = 0;
        } else {
          // AI classification with rate limiting
          await sleep(AI_RATE_LIMIT_DELAY);

          const attachmentText = (record.attachments || [])
            .filter((a: any) => a.extractedText)
            .map((a: any) => a.extractedText?.substring(0, 2000))
            .join('\n');

          try {
            const analysis = await aiAnalyzer.analyze(
              {
                gmailMessageId: record.gmail_message_id,
                threadId: '',
                subject: record.subject || '',
                bodyText: record.body_preview || '',
                senderEmail: record.from_address || '',
                senderName: '',
                recipientEmails: [],
                receivedAt: new Date(record.occurred_at),
                direction: 'inbound',
                snippet: '',
                attachments: [],
              },
              attachmentText
            );

            newType = analysis.document_type;
            method = 'ai';
            confidence = 75;
            aiClassifications++;
          } catch (aiError) {
            // AI failed, keep original
            logger.recordError(record.id, record.subject, aiError as Error);
            newType = record.document_type;
            method = 'pattern';
            confidence = 0;
          }
        }

        // Record the change
        logger.recordChange({
          chronicleId: record.id,
          subject: record.subject || '',
          oldType: record.document_type,
          newType,
          method,
          confidence,
          patternMatched,
        });

        // Update if changed and not dry run
        if (record.document_type !== newType) {
          changed++;

          if (!dryRun) {
            const { error: updateError } = await supabase
              .from('chronicle')
              .update({
                document_type: newType,
                reanalyzed_at: new Date().toISOString(),
              })
              .eq('id', record.id);

            if (updateError) {
              logger.recordError(record.id, record.subject, updateError.message);
            }
          }
        }

        processed++;
        lastProcessedId = record.id;
      } catch (err) {
        logger.recordError(record.id, record.subject, err as Error);
      }
    }

    // Re-enable trigger
    if (!dryRun) {
      try {
        await supabase.rpc('enable_chronicle_trigger');
      } catch {
        // Ignore if RPC doesn't exist
      }
    }

    // End batch and get summary
    const batchSummary = logger.endBatch();

    // Save checkpoint
    if (!dryRun && lastProcessedId) {
      await saveCheckpoint(supabase, {
        batch_number: batchNumber,
        last_chronicle_id: lastProcessedId,
        processed_count: processed,
        changed_count: changed,
        error_count: batchSummary.errors,
      });
    }

    // Check if there are more records
    const { count: remainingCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gt('occurred_at', records[records.length - 1].occurred_at);

    const hasMore = (remainingCount || 0) > 0;

    const result: CatchupResult = {
      success: true,
      batchNumber,
      processed,
      changed,
      errors: batchSummary.errors,
      patternMatches,
      aiClassifications,
      nextStartFrom: hasMore ? lastProcessedId : null,
      hasMore,
      durationMs: Date.now() - startTime,
    };

    // If this is the last batch, include full report
    if (!hasMore) {
      result.report = logger.finalize();
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Catchup] Fatal error:', error);
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

// Helper functions
async function getCheckpoint(supabase: any): Promise<any | null> {
  try {
    const { data } = await supabase
      .from(CHECKPOINT_TABLE)
      .select('*')
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
    changed_count: number;
    error_count: number;
  }
): Promise<void> {
  try {
    await supabase.from(CHECKPOINT_TABLE).insert({
      ...checkpoint,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Catchup] Failed to save checkpoint:', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
