/**
 * Cron Job: Process Emails (Chronicle Pipeline)
 *
 * Main email processing cron using Chronicle Intelligence System:
 * 1. Fetch emails from Gmail (hybrid: historyId + timestamp fallback)
 * 2. AI-powered extraction with THREAD CONTEXT (4-point routing, cutoffs, identifiers)
 * 3. Store in chronicle table (with logging to chronicle_runs)
 * 4. Auto-link to shipments
 * 5. Track stage progression
 *
 * Schedule: Every 5 minutes via Vercel cron
 * Config: Hybrid sync, 200 emails max, 5x parallel processing
 *
 * Principles:
 * - Cron job < 50 lines (orchestrates deep services)
 * - Idempotent (gmail_message_id deduplication)
 * - Fail Gracefully (continue on individual failures)
 * - Logged (chronicle_runs table for monitoring)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  ChronicleService,
  ChronicleLogger,
  ChronicleRepository,
  createChronicleGmailService,
} from '@/lib/chronicle';

// Configuration (env vars with sensible defaults)
const HOURS_TO_FETCH = parseInt(process.env.CHRONICLE_HOURS_TO_FETCH || '6', 10);
const MAX_EMAILS_PER_RUN = parseInt(process.env.CHRONICLE_MAX_EMAILS_PER_RUN || '200', 10);
const CONCURRENCY = parseInt(process.env.CHRONICLE_CONCURRENCY || '5', 10);
const USE_HYBRID_SYNC = true;

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
    const gmailService = createChronicleGmailService();
    const logger = new ChronicleLogger(supabase);
    const repository = new ChronicleRepository(supabase);
    const chronicleService = new ChronicleService(supabase, gmailService, logger);

    let result;
    let syncMode = 'timestamp';

    if (USE_HYBRID_SYNC) {
      // Hybrid mode: Use historyId for efficiency, fallback to timestamp
      const syncState = await repository.getSyncState();
      const syncResult = await gmailService.fetchEmailsHybrid({
        syncState,
        maxResults: MAX_EMAILS_PER_RUN,
        lookbackHours: HOURS_TO_FETCH,
      });

      syncMode = syncResult.syncMode;
      console.log(`[Cron:Chronicle] ${syncMode} sync found ${syncResult.messageIds.length} emails`);

      if (syncResult.messageIds.length === 0) {
        // Update sync state even with no new emails
        await repository.updateSyncState(syncResult.historyId, syncMode === 'weekly_full', 0);

        return NextResponse.json({
          success: true,
          duration_ms: Date.now() - startTime,
          stats: { sync_mode: syncMode, emails_fetched: 0, emails_processed: 0 },
        });
      }

      // Fetch full email content for each message
      const emails = await gmailService.fetchEmailsByTimestamp({
        after: new Date(Date.now() - HOURS_TO_FETCH * 60 * 60 * 1000),
        maxResults: MAX_EMAILS_PER_RUN,
      });

      // Process the batch
      result = await chronicleService.processBatch(emails, undefined, MAX_EMAILS_PER_RUN, CONCURRENCY);

      // Update sync state
      await repository.updateSyncState(syncResult.historyId, syncMode === 'weekly_full', result.succeeded);
    } else {
      // Legacy mode: Pure timestamp-based sync
      const after = new Date(Date.now() - HOURS_TO_FETCH * 60 * 60 * 1000);
      console.log(`[Cron:Chronicle] Fetching emails since ${after.toISOString()}`);

      result = await chronicleService.fetchAndProcess({
        after,
        maxResults: MAX_EMAILS_PER_RUN,
        concurrency: CONCURRENCY,
      });
    }

    console.log(`[Cron:Chronicle] Completed in ${result.totalTimeMs}ms:`, {
      syncMode,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      linked: result.linked,
    });

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats: {
        sync_mode: syncMode,
        emails_fetched: result.processed,
        emails_processed: result.succeeded,
        shipments_linked: result.linked,
        errors: result.failed,
      },
    });
  } catch (error) {
    console.error('[Cron:Chronicle] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300;
