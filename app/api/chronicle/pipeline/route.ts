/**
 * Chronicle Pipeline X-Ray API
 *
 * Comprehensive system scan of the entire intelligence pipeline:
 * Email Ingestion → Threads → Chronicle → Linking → Shipments → AI Summaries
 *
 * Usage:
 *   GET /api/chronicle/pipeline             - Full X-Ray (JSON)
 *   GET /api/chronicle/pipeline?format=text - Terminal-friendly output
 *
 * @deprecated This is a V1 endpoint. Consider using V2 endpoints for new integrations.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPipelineMonitor } from '@/lib/chronicle/pipeline-monitor';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const monitor = createPipelineMonitor(supabase);

    const xray = await monitor.getXRay();

    if (format === 'text') {
      return new NextResponse(monitor.formatXRay(xray), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json(xray);
  } catch (error) {
    console.error('[Chronicle Pipeline] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
