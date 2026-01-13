import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NarrativeChainService } from '@/lib/chronicle-v2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/chronicle-v2/shipments/[id]/chains
 *
 * Returns narrative chains for a shipment.
 * Optional query params:
 * - status: 'active' | 'resolved' | 'all' (default: 'all')
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';

    const chainService = new NarrativeChainService(supabase);

    let chains;
    if (status === 'active') {
      chains = await chainService.getActiveChains(id);
    } else {
      chains = await chainService.getAllChains(id);
      if (status === 'resolved') {
        chains = chains.filter((c) => c.chainStatus === 'resolved');
      }
    }

    return NextResponse.json({
      chains,
      count: chains.length,
    });
  } catch (error) {
    console.error('[Chains API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chains' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chronicle-v2/shipments/[id]/chains
 *
 * Detects and creates new chains from chronicle data.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const chainService = new NarrativeChainService(supabase);
    const chains = await chainService.detectChainsForShipment(id);

    return NextResponse.json({
      chains,
      count: chains.length,
      message: 'Chains detected successfully',
    });
  } catch (error) {
    console.error('[Chains API] Error detecting:', error);
    return NextResponse.json(
      { error: 'Failed to detect chains' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/chronicle-v2/shipments/[id]/chains
 *
 * Update chain status.
 * Body: { chainId: string, status: 'resolved' | 'stale', resolutionSummary?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { chainId, status, resolutionSummary } = body;

    if (!chainId || !status) {
      return NextResponse.json(
        { error: 'chainId and status are required' },
        { status: 400 }
      );
    }

    if (!['resolved', 'stale', 'active'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    const chainService = new NarrativeChainService(supabase);
    await chainService.updateChainStatus(chainId, status, resolutionSummary);

    return NextResponse.json({
      success: true,
      message: `Chain status updated to ${status}`,
    });
  } catch (error) {
    console.error('[Chains API] Error updating:', error);
    return NextResponse.json(
      { error: 'Failed to update chain' },
      { status: 500 }
    );
  }
}
