/**
 * Cron Job: Process Emails
 *
 * Automated email processing pipeline:
 * 1. Fetch pending emails from raw_emails
 * 2. Classify document type
 * 3. Extract entities
 * 4. Link to shipments (create from direct carrier BCs only)
 * 5. Track document lifecycle
 *
 * Schedule: Every 5 minutes (via Vercel cron or external scheduler)
 *
 * Principles:
 * - Cron job < 50 lines (orchestrates deep services)
 * - Idempotent (safe to run multiple times)
 * - Fail Gracefully (continue on individual failures)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '@/lib/services/email-processing-orchestrator';

// Configuration
const MAX_EMAILS_PER_RUN = 50;
const BATCH_SIZE = 10;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const stats = {
    emails_found: 0,
    emails_processed: 0,
    shipments_created: 0,
    shipments_linked: 0,
    errors: 0,
  };

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey || !anthropicKey) {
      return NextResponse.json(
        { error: 'Missing environment configuration' },
        { status: 500 }
      );
    }

    // Initialize orchestrator
    const orchestrator = new EmailProcessingOrchestrator(
      supabaseUrl,
      supabaseKey,
      anthropicKey
    );
    await orchestrator.initialize();

    // Get emails needing processing
    const emailIds = await orchestrator.getEmailsNeedingProcessing(MAX_EMAILS_PER_RUN);
    stats.emails_found = emailIds.length;

    if (emailIds.length === 0) {
      console.log('[Cron:ProcessEmails] No emails need processing');
      return NextResponse.json({
        success: true,
        message: 'No emails need processing',
        duration_ms: Date.now() - startTime,
        stats,
      });
    }

    console.log(`[Cron:ProcessEmails] Processing ${emailIds.length} emails...`);

    // Process in batches to avoid timeout
    for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
      const batch = emailIds.slice(i, i + BATCH_SIZE);
      const results = await orchestrator.processBatch(batch);

      for (const result of results) {
        if (result.success) {
          stats.emails_processed++;
          if (result.shipmentId) {
            stats.shipments_linked++;
          }
        } else {
          stats.errors++;
          console.error(`[Cron:ProcessEmails] Error for ${result.emailId}:`, result.error);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Cron:ProcessEmails] Completed in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      stats,
    });
  } catch (error) {
    console.error('[Cron:ProcessEmails] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats,
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
