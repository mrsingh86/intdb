/**
 * Chronicle Health API
 *
 * Quick health check or full system scan ("CT Scan")
 *
 * Usage:
 *   GET /api/chronicle/health         - Quick health check (JSON)
 *   GET /api/chronicle/health?full=1  - Full system scan (JSON)
 *   GET /api/chronicle/health?format=text - Terminal-friendly output
 *
 * @deprecated This is a V1 endpoint. Consider using V2 endpoints for new integrations.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createChronicleMonitor } from '@/lib/chronicle/chronicle-monitor';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const full = searchParams.get('full') === '1' || searchParams.get('full') === 'true';
    const format = searchParams.get('format') || 'json';

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const monitor = createChronicleMonitor(supabase);

    if (full) {
      const scan = await monitor.fullScan();

      if (format === 'text') {
        return new NextResponse(monitor.formatFullScan(scan), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      return NextResponse.json(scan);
    } else {
      const health = await monitor.getHealth();

      if (format === 'text') {
        return new NextResponse(monitor.formatHealthReport(health), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      return NextResponse.json({
        status: health.overall.status,
        score: health.overall.score,
        summary: health.overall.summary,
        ...health,
      });
    }
  } catch (error) {
    console.error('[Chronicle Health] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
