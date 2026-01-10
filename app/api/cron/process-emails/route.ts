/**
 * Cron Job: Process Emails (Chronicle Pipeline)
 *
 * Automated email processing using Chronicle Intelligence System:
 * 1. Fetch emails from Gmail (last 24 hours)
 * 2. AI-powered extraction (4-point routing, cutoffs, identifiers)
 * 3. Store in chronicle table
 * 4. Auto-link to shipments
 *
 * Schedule: Every 5 minutes (via Vercel cron or external scheduler)
 *
 * Principles:
 * - Cron job < 50 lines (orchestrates deep services)
 * - Idempotent (gmail_message_id deduplication)
 * - Fail Gracefully (continue on individual failures)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  ChronicleService,
  createChronicleGmailService,
} from '@/lib/chronicle';

// Configuration
// BACKFILL MODE: Temporarily increased to process historical emails (Dec 1 - Jan 10)
// TODO: Revert to 24 hours and 100 emails after backfill complete
const HOURS_TO_FETCH = 1000;  // ~42 days (Dec 1 to Jan 10)
const MAX_EMAILS_PER_RUN = 2000;

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
    const chronicleService = new ChronicleService(supabase, gmailService);

    const after = new Date(Date.now() - HOURS_TO_FETCH * 60 * 60 * 1000);
    const result = await chronicleService.fetchAndProcess({
      after,
      maxResults: MAX_EMAILS_PER_RUN,
    });

    console.log(`[Cron:Chronicle] Completed in ${result.totalTimeMs}ms:`, {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      linked: result.linked,
    });

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats: {
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
