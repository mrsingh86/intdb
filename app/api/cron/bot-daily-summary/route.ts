/**
 * Cron Job: Bot Daily Summary
 *
 * Sends a daily summary to the ops team WhatsApp group via Clawdbot.
 * Includes: pending actions, overdue items, today's schedule, mismatches.
 *
 * Schedule: Every day at 8:00 AM IST (2:30 AM UTC)
 * Vercel Cron: 30 2 * * *
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUnifiedIntelligenceService } from '@/lib/unified-intelligence';
import { getBotNotificationService } from '@/lib/unified-intelligence';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CRON_SECRET = process.env.CRON_SECRET;

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// =============================================================================
// HANDLER
// =============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabase = getSupabaseClient();
    const service = getUnifiedIntelligenceService(supabase);
    const notifier = getBotNotificationService();

    // Gather stats
    const [pendingResponse, urgentResponse, scheduleResponse, mismatchResponse] = await Promise.all([
      service.getAllPendingActions(),
      service.getUrgentItems(),
      service.getTodaySchedule(),
      service.getMismatchedShipments(),
    ]);

    // Calculate stats
    const pendingActions = pendingResponse.data?.length || 0;
    const overdueActions = urgentResponse.data?.overdueCount || 0;
    const arrivingToday = scheduleResponse.data?.arrivals.length || 0;
    const departingToday = scheduleResponse.data?.departures.length || 0;
    const dataMismatches = mismatchResponse.data?.length || 0;

    // Send daily summary
    const result = await notifier.sendDailySummary({
      pendingActions,
      overdueActions,
      arrivingToday,
      departingToday,
      dataMismatches,
    });

    // Log the notification
    await supabase.from('bot_notification_logs').insert({
      alert_type: 'daily_summary',
      message_preview: `Overdue: ${overdueActions}, Pending: ${pendingActions}, Arriving: ${arrivingToday}`,
      channel: 'whatsapp',
      success: result.success,
      error_message: result.error || null,
    });

    const processingTime = Date.now() - startTime;

    return NextResponse.json({
      success: result.success,
      stats: {
        pendingActions,
        overdueActions,
        arrivingToday,
        departingToday,
        dataMismatches,
      },
      processingTimeMs: processingTime,
      error: result.error,
    });
  } catch (error) {
    console.error('[Cron:BotDailySummary] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export { GET as POST };
