/**
 * Learning Dashboard Pending Patterns API
 *
 * GET /api/learning/patterns/pending - List auto-discovered patterns awaiting approval
 * POST /api/learning/patterns/pending - Approve or reject a pending pattern
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const searchParams = request.nextUrl.searchParams;

    const status = searchParams.get('status') || 'pending';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const offset = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('pending_patterns')
      .select('*', { count: 'exact' })
      .eq('status', status)
      .order('discovered_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      patterns: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Learning Pending Patterns] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await request.json();

    const { id, action, reason } = body;
    if (!id || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: id, action (approve/reject)' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // Get pending pattern
    const { data: pendingPattern, error: fetchError } = await supabase
      .from('pending_patterns')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !pendingPattern) {
      return NextResponse.json({ error: 'Pending pattern not found' }, { status: 404 });
    }

    if (pendingPattern.status !== 'pending') {
      return NextResponse.json({ error: 'Pattern already reviewed' }, { status: 400 });
    }

    if (action === 'approve') {
      // Create detection pattern from pending
      const { data: newPattern, error: insertError } = await supabase
        .from('detection_patterns')
        .insert({
          carrier_id: pendingPattern.carrier_id,
          pattern_type: pendingPattern.pattern_type,
          document_type: pendingPattern.document_type,
          pattern: pendingPattern.pattern,
          pattern_flags: pendingPattern.pattern_flags || 'i',
          priority: 50,
          confidence_base: Math.round(pendingPattern.accuracy_rate * 100),
          enabled: true,
          source: 'auto_discovery',
          notes: `Auto-discovered from ${pendingPattern.sample_count} classifications`,
        })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      // Update pending pattern
      await supabase
        .from('pending_patterns')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          approved_pattern_id: newPattern.id,
        })
        .eq('id', id);

      // Record in audit
      await supabase.from('pattern_audit').insert({
        action: 'approved',
        pattern_id: newPattern.id,
        pattern_template: pendingPattern.pattern,
        document_type: pendingPattern.document_type,
        carrier_id: pendingPattern.carrier_id,
        sample_count: pendingPattern.sample_count,
        accuracy_after: pendingPattern.accuracy_rate,
        reason: reason || 'Approved by user',
        source: 'manual',
      });

      return NextResponse.json({
        success: true,
        action: 'approved',
        pattern: newPattern,
      });
    } else {
      // Reject the pattern
      await supabase
        .from('pending_patterns')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason || 'Rejected by user',
        })
        .eq('id', id);

      // Record in audit
      await supabase.from('pattern_audit').insert({
        action: 'rejected',
        pattern_template: pendingPattern.pattern,
        document_type: pendingPattern.document_type,
        carrier_id: pendingPattern.carrier_id,
        sample_count: pendingPattern.sample_count,
        reason: reason || 'Rejected by user',
        source: 'manual',
      });

      return NextResponse.json({
        success: true,
        action: 'rejected',
      });
    }
  } catch (error) {
    console.error('[Learning Pending Patterns] Action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
