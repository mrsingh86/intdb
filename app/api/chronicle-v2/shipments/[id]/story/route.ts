import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  ShipmentStoryService,
  NarrativeChainService,
  StakeholderAnalysisService,
  type ShipmentStory,
} from '@/lib/chronicle-v2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/chronicle-v2/shipments/[id]/story
 *
 * Returns the complete shipment story with:
 * - Narrative chains (cause-effect relationships)
 * - Stakeholder summaries (party behavior)
 * - Timeline events with importance markers
 * - Smart recommendations with chain-of-thought reasoning
 * - Draft reply context
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const storyService = new ShipmentStoryService(supabase);
    const story = await storyService.getShipmentStory(id);

    if (!story) {
      return NextResponse.json(
        { error: 'Shipment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ story });
  } catch (error) {
    console.error('[Story API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shipment story' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chronicle-v2/shipments/[id]/story
 *
 * Refreshes the shipment story by re-detecting chains and recomputing summaries.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const storyService = new ShipmentStoryService(supabase);
    const story = await storyService.refreshShipmentStory(id);

    if (!story) {
      return NextResponse.json(
        { error: 'Shipment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      story,
      message: 'Story refreshed successfully',
    });
  } catch (error) {
    console.error('[Story API] Error refreshing:', error);
    return NextResponse.json(
      { error: 'Failed to refresh shipment story' },
      { status: 500 }
    );
  }
}
