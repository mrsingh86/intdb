import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const supabase = getSupabase();

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'active';
    const severity = searchParams.get('severity');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = supabase
      .from('shipment_blockers')
      .select(`
        id,
        shipment_id,
        blocker_type,
        blocker_description,
        severity,
        blocked_since,
        blocks_workflow_state,
        blocks_milestone,
        blocks_document_type,
        is_resolved,
        resolved_at,
        created_at,
        shipments:shipment_id (
          id,
          booking_number,
          bl_number,
          vessel_name,
          etd,
          status,
          workflow_state
        )
      `)
      .order('blocked_since', { ascending: false })
      .limit(limit);

    if (status === 'active') {
      query = query.eq('is_resolved', false);
    } else if (status === 'resolved') {
      query = query.eq('is_resolved', true);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    const { data: blockers, error } = await query;

    if (error) {
      console.error('Error fetching blockers:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate summary
    const summary = {
      total: blockers?.length || 0,
      bySeverity: {
        critical: blockers?.filter(b => b.severity === 'critical').length || 0,
        high: blockers?.filter(b => b.severity === 'high').length || 0,
        medium: blockers?.filter(b => b.severity === 'medium').length || 0,
        low: blockers?.filter(b => b.severity === 'low').length || 0,
      },
      byType: blockers?.reduce((acc, b) => {
        acc[b.blocker_type] = (acc[b.blocker_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {},
    };

    return NextResponse.json({
      blockers: blockers || [],
      summary,
    });
  } catch (error) {
    console.error('Blockers API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blockers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = getSupabase();

  try {
    const body = await request.json();
    const { blockerId, action, notes } = body;

    if (!blockerId || !action) {
      return NextResponse.json(
        { error: 'blockerId and action required' },
        { status: 400 }
      );
    }

    if (action === 'resolve') {
      const { error } = await supabase
        .from('shipment_blockers')
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          resolution_notes: notes || 'Manually resolved',
        })
        .eq('id', blockerId);

      if (error) throw error;
      return NextResponse.json({ success: true, action: 'resolved' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Blocker action error:', error);
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    );
  }
}
